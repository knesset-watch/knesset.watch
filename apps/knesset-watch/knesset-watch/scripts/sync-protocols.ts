// scripts/sync-protocols.ts
// Run: npm run db:sync-protocols
// Incremental: fetches protocol documents for sessions not yet in protocols.db.
// Safe to re-run — skips sessions already present.

import Database from 'better-sqlite3';
import mammoth from 'mammoth';
import path from 'path';

const API = 'https://knesset.gov.il/OdataV4/ParliamentInfo';
const KNESSET_DB = path.join(process.cwd(), 'knesset.db');
const PROTOCOLS_DB = path.join(process.cwd(), 'protocols.db');

// Confirmed by probe: GroupTypeID=23 = "פרוטוקול ועדה", AppID=1 (DOC/DOCX)
const PROTOCOL_GROUP_TYPE_ID = 23;

const CHUNK_SIZE = 3000;
const CHUNK_OVERLAP = 300;

const SPEAKER_RE = /^(היו"ר|ח"כ|מר|גב'|ד"ר|פרופ'|שר|סגן שר)\s+([^\n:：]{2,40})[:：]/mu;
const SPEAKER_LINE_RE = /^([^\n:：]{2,40})[:：]\s*$/mu;

function extractSpeaker(line: string): string | null {
  const m = line.match(SPEAKER_RE);
  if (m) return `${m[1]} ${m[2]}`.trim();
  const m2 = line.match(SPEAKER_LINE_RE);
  if (m2) return m2[1].trim();
  return null;
}

function chunkText(text: string): Array<{ text: string; speaker: string | null }> {
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

  const chunks: Array<{ text: string; speaker: string | null }> = [];
  for (const turn of turns) {
    if (turn.text.length <= CHUNK_SIZE) {
      chunks.push(turn);
    } else {
      let i = 0;
      while (i < turn.text.length) {
        chunks.push({ text: turn.text.slice(i, i + CHUNK_SIZE), speaker: turn.speaker });
        i += CHUNK_SIZE - CHUNK_OVERLAP;
      }
    }
  }
  return chunks;
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function sync() {
  const knessetDb = new Database(KNESSET_DB, { readonly: true });
  const db = new Database(PROTOCOLS_DB);

  const done = new Set(
    (db.prepare('SELECT session_id FROM session_protocol').all() as any[]).map((r: any) => r.session_id),
  );

  const newSessions = (knessetDb.prepare(`
    SELECT cs.id, cs.committee_id, cs.date, cs.title,
           b.committee_name
    FROM committee_session cs
    LEFT JOIN (
      SELECT DISTINCT committee_id, committee_name FROM bill
      WHERE committee_id != -1 AND committee_name IS NOT NULL
    ) b ON b.committee_id = cs.committee_id
    ORDER BY cs.id ASC
  `).all() as any[]).filter((s: any) => !done.has(s.id));

  if (newSessions.length === 0) {
    console.log('No new sessions to sync.');
    knessetDb.close(); db.close(); return;
  }

  console.log(`Syncing ${newSessions.length} new sessions...`);

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

  let withProtocol = 0;
  let errors = 0;
  const CONCURRENCY = 5;

  for (let i = 0; i < newSessions.length; i += CONCURRENCY) {
    const batch = newSessions.slice(i, i + CONCURRENCY);
    await Promise.allSettled(batch.map(async (s: any) => {
      try {
        const json = await fetchJson(
          `${API}/KNS_DocumentCommitteeSession?$filter=CommitteeSessionID eq ${s.id} and GroupTypeID eq ${PROTOCOL_GROUP_TYPE_ID}&$select=ApplicationID,FilePath`,
        );
        const docs: any[] = json.value ?? [];
        const doc = docs.find((d: any) => d.FilePath);
        if (!doc) return;

        const bufRes = await fetch(doc.FilePath, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!bufRes.ok) return;
        const buf = Buffer.from(await bufRes.arrayBuffer());
        const { value: text } = await mammoth.extractRawText({ buffer: buf });
        if (text.trim().length < 100) return;

        const chunks = chunkText(text.trim());
        if (!chunks.length) return;

        db.transaction(() => {
          insertSession.run(s.id, s.committee_id, s.committee_name, s.date, s.title, doc.FilePath, chunks.length);
          for (let ci = 0; ci < chunks.length; ci++) {
            const r = insertChunk.run(s.id, ci, chunks[ci].text, chunks[ci].speaker ?? null);
            insertFts.run(chunks[ci].text, r.lastInsertRowid, s.id, s.committee_name ?? '', s.date, chunks[ci].speaker ?? '');
          }
        })();
        withProtocol++;
      } catch {
        errors++;
      }
    }));
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`Done. ${withProtocol}/${newSessions.length} sessions had protocols. ${errors} errors.`);
  knessetDb.close();
  db.close();
}

sync().catch(err => {
  console.error(err.message);
  process.exit(1);
});
