// scripts/scrape-protocols.ts
// Run: npm run db:scrape-protocols
// One-time full scrape of all K25 committee session protocols.
// Resumable: already-scraped sessions are skipped.
//
// Confirmed from probe: GroupTypeID=23 = "פרוטוקול ועדה", AppID=1 (DOC/DOCX)

import Database from 'better-sqlite3';
import mammoth from 'mammoth';
import path from 'path';

const API = 'https://knesset.gov.il/OdataV4/ParliamentInfo';
const KNESSET_DB = path.join(process.cwd(), 'knesset.db');
const PROTOCOLS_DB = path.join(process.cwd(), 'protocols.db');

const PROTOCOL_GROUP_TYPE_ID = 23; // "פרוטוקול ועדה" — confirmed by probe

const CHUNK_SIZE = 3000;    // characters (~500 Hebrew tokens)
const CHUNK_OVERLAP = 300;  // characters

// Speaker line patterns (Hebrew Knesset protocols)
const SPEAKER_RE = /^(היו"ר|ח"כ|מר|גב'|ד"ר|פרופ'|שר|סגן שר)\s+([^\n:：]{2,40})[:：]/mu;
const SPEAKER_LINE_RE = /^([^\n:：]{2,40})[:：]\s*$/mu;

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`Download HTTP ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function extractSpeaker(line: string): string | null {
  const m = line.match(SPEAKER_RE);
  if (m) return `${m[1]} ${m[2]}`.trim();
  const m2 = line.match(SPEAKER_LINE_RE);
  if (m2) return m2[1].trim();
  return null;
}

function chunkText(text: string): Array<{ text: string; speaker: string | null }> {
  // Split on speaker turns first
  const lines = text.split('\n');
  const turns: Array<{ speaker: string | null; text: string }> = [];
  let currentSpeaker: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const speaker = extractSpeaker(line);
    if (speaker && currentLines.join('\n').length > 50) {
      const t = currentLines.join('\n').trim();
      if (t.length > 20) turns.push({ speaker: currentSpeaker, text: t });
      currentSpeaker = speaker;
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.length) {
    const t = currentLines.join('\n').trim();
    if (t.length > 20) turns.push({ speaker: currentSpeaker, text: t });
  }

  // Split each turn into CHUNK_SIZE chunks if needed
  const chunks: Array<{ text: string; speaker: string | null }> = [];
  for (const turn of turns) {
    if (turn.text.length <= CHUNK_SIZE) {
      chunks.push(turn);
    } else {
      let i = 0;
      while (i < turn.text.length) {
        const slice = turn.text.slice(i, i + CHUNK_SIZE);
        chunks.push({ text: slice, speaker: turn.speaker });
        i += CHUNK_SIZE - CHUNK_OVERLAP;
      }
    }
  }
  return chunks;
}

async function processSession(
  session: { id: number; committee_id: number; committee_name: string | null; date: string; title: string | null },
  db: Database.Database,
  insertSession: Database.Statement,
  insertChunk: Database.Statement,
  insertFts: Database.Statement,
): Promise<boolean> {
  // Fetch available protocol documents for this session
  const json = await fetchJson(
    `${API}/KNS_DocumentCommitteeSession?$filter=CommitteeSessionID eq ${session.id} and GroupTypeID eq ${PROTOCOL_GROUP_TYPE_ID}&$select=ApplicationID,FilePath`,
  );
  const docs: any[] = json.value ?? [];

  if (docs.length === 0) return false; // No protocol for this session

  // Pick first available doc (all AppID=1 in practice)
  const doc = docs.find((d: any) => d.FilePath);
  if (!doc) return false;

  // Download and parse
  const buf = await downloadBuffer(doc.FilePath);
  const result = await mammoth.extractRawText({ buffer: buf });
  const text = result.value.trim();
  if (text.length < 100) return false; // Empty or unreadable

  // Chunk
  const chunks = chunkText(text);
  if (chunks.length === 0) return false;

  // Store — single transaction per session
  db.transaction(() => {
    insertSession.run(
      session.id,
      session.committee_id,
      session.committee_name,
      session.date,
      session.title,
      doc.FilePath,
      chunks.length,
    );
    for (let i = 0; i < chunks.length; i++) {
      const r = insertChunk.run(
        session.id,
        i,
        chunks[i].text,
        chunks[i].speaker ?? null,
      );
      const chunkId = r.lastInsertRowid;
      insertFts.run(
        chunks[i].text,
        chunkId,
        session.id,
        session.committee_name ?? '',
        session.date,
        chunks[i].speaker ?? '',
      );
    }
  })();

  return true;
}

async function scrape() {
  const knessetDb = new Database(KNESSET_DB, { readonly: true });
  const db = new Database(PROTOCOLS_DB);

  // Prepare statements
  const insertSession = db.prepare(`
    INSERT OR REPLACE INTO session_protocol
      (session_id, committee_id, committee_name, date, title, doc_url, chunk_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertChunk = db.prepare(`
    INSERT INTO protocol_chunk (session_id, chunk_index, text, speaker)
    VALUES (?, ?, ?, ?)
  `);
  const insertFts = db.prepare(`
    INSERT INTO protocol_chunk_fts (text, chunk_id, session_id, committee_name, date, speaker)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // Get all K25 sessions, skip already processed
  const alreadyDone = new Set(
    (db.prepare('SELECT session_id FROM session_protocol').all() as any[]).map((r: any) => r.session_id),
  );

  const sessions = knessetDb.prepare(`
    SELECT cs.id, cs.committee_id, cs.date, cs.title,
           b.committee_name
    FROM committee_session cs
    LEFT JOIN (
      SELECT DISTINCT committee_id, committee_name FROM bill
      WHERE committee_id != -1 AND committee_name IS NOT NULL
    ) b ON b.committee_id = cs.committee_id
    ORDER BY cs.id ASC
  `).all() as Array<{
    id: number; committee_id: number; date: string; title: string | null; committee_name: string | null;
  }>;

  const todo = sessions.filter(s => !alreadyDone.has(s.id));
  console.log(`${sessions.length} total sessions, ${alreadyDone.size} already done, ${todo.length} to process`);

  let processed = 0;
  let withProtocol = 0;
  let errors = 0;
  const CONCURRENCY = 5;
  const DELAY_MS = 200;

  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(s => processSession(s, db, insertSession, insertChunk, insertFts)),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        if (r.value) withProtocol++;
      } else {
        errors++;
      }
    }
    processed += batch.length;
    if (processed % 200 === 0 || processed === todo.length) {
      const pct = Math.round((processed / todo.length) * 100);
      console.log(`  ${processed}/${todo.length} (${pct}%) — ${withProtocol} protocols, ${errors} errors`);
    }
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`\nDone. ${withProtocol} protocols scraped, ${errors} errors out of ${processed} sessions.`);
  knessetDb.close();
  db.close();
}

scrape().catch(err => {
  console.error('Scrape failed:', err.message);
  process.exit(1);
});
