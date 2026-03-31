// scripts/download-protocols.ts
// Run: npm run db:download-protocols
//
// Phase 1 of 2: Downloads all K25 committee protocol DOCX files.
//   - Saves each file to protocols/{sessionId}.docx
//   - Extracts raw text with mammoth and stores in committee_session.protocol_text
//   - No parsing of attendance/guests/votes — that's done separately by parse-attendance.ts
//
// Resume-safe: sessions with protocol_text already set are skipped.
// Run this once. After it finishes, all data is local — no re-downloading needed.

import Database from 'better-sqlite3';
import mammoth from 'mammoth';
import path from 'path';
import fs from 'fs';

const ODATA_API = 'https://knesset.gov.il/OdataV4/ParliamentInfo';
const DB_PATH = path.join(process.cwd(), 'knesset.db');
const PROTOCOLS_DIR = path.join(process.cwd(), 'protocols');

const CONCURRENCY = 5;
const PAGE_DELAY_MS = 100;
const BATCH_DELAY_MS = 250;

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function fetchAll(url: string): Promise<any[]> {
  const results: any[] = [];
  let next: string | null = url;
  while (next) {
    let json: any;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        json = await fetchJson(next);
        break;
      } catch (err) {
        if (attempt === 3) throw err;
        process.stdout.write(`\n    Retry ${attempt}/3...`);
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
    results.push(...(json.value ?? []));
    next = json['@odata.nextLink'] ?? null;
    if (results.length % 5000 === 0 && results.length > 0) {
      process.stdout.write(`\r    ${results.length.toLocaleString()} records...`);
    }
    if (next) await new Promise(r => setTimeout(r, PAGE_DELAY_MS));
  }
  return results;
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── Migrations ────────────────────────────────────────────────────────────────

function migrate(db: Database.Database) {
  const cols = (db.prepare('PRAGMA table_info(committee_session)').all() as any[]).map((c: any) => c.name);

  if (!cols.includes('protocol_url')) {
    db.exec('ALTER TABLE committee_session ADD COLUMN protocol_url TEXT');
    console.log('  Added protocol_url.');
  }
  if (!cols.includes('protocol_text')) {
    db.exec('ALTER TABLE committee_session ADD COLUMN protocol_text TEXT');
    console.log('  Added protocol_text.');
  }
  if (!cols.includes('session_url')) {
    db.exec(`ALTER TABLE committee_session ADD COLUMN session_url TEXT`);
    db.exec(`UPDATE committee_session SET session_url = 'https://main.knesset.gov.il/Activity/committees/Pages/AllCommitteeAgenda.aspx?ItemID=' || id`);
    console.log('  Added session_url (backfilled for all sessions).');
  }

  fs.mkdirSync(PROTOCOLS_DIR, { recursive: true });
}

// ── Phase 1: Bulk-fetch protocol URLs ────────────────────────────────────────

async function fetchProtocolUrls(db: Database.Database) {
  const remaining = (db.prepare(
    "SELECT COUNT(*) as cnt FROM committee_session WHERE protocol_url IS NULL"
  ).get() as { cnt: number }).cnt;

  if (remaining === 0) {
    console.log('  Protocol URLs: already complete.');
    return;
  }

  const alreadyDone = (db.prepare(
    "SELECT COUNT(*) as cnt FROM committee_session WHERE protocol_url IS NOT NULL"
  ).get() as { cnt: number }).cnt;

  console.log(`  Fetching protocol URLs from OData (${alreadyDone} already done, ${remaining} remaining)...`);

  const { minId, maxId } = db.prepare(
    'SELECT MIN(id) as minId, MAX(id) as maxId FROM committee_session'
  ).get() as { minId: number; maxId: number };

  const docs = await fetchAll(
    `${ODATA_API}/KNS_DocumentCommitteeSession?$filter=GroupTypeID eq 23 and CommitteeSessionID ge ${minId} and CommitteeSessionID le ${maxId}&$select=CommitteeSessionID,FilePath`
  );
  console.log(`\n    ${docs.length.toLocaleString()} protocol documents found in OData.`);

  const urlMap = new Map<number, string>();
  for (const d of docs) {
    if (d.CommitteeSessionID && d.FilePath && !urlMap.has(d.CommitteeSessionID)) {
      urlMap.set(d.CommitteeSessionID, d.FilePath);
    }
  }

  const sessions = db.prepare(
    "SELECT id FROM committee_session WHERE protocol_url IS NULL"
  ).all() as { id: number }[];

  const updateUrl = db.prepare('UPDATE committee_session SET protocol_url = ? WHERE id = ?');
  let found = 0;
  db.transaction(() => {
    for (const s of sessions) {
      const url = urlMap.get(s.id) ?? '';
      updateUrl.run(url, s.id);
      if (url) found++;
    }
  })();

  console.log(`  URLs done: ${found} protocols found, ${sessions.length - found} sessions without protocol.`);
}

// ── Phase 2: Download DOCXs and save raw text ─────────────────────────────────

async function downloadSession(
  session: { id: number; protocol_url: string },
  saveText: Database.Statement,
  db: Database.Database,
): Promise<'ok' | 'skip' | 'error'> {
  const filePath = path.join(PROTOCOLS_DIR, `${session.id}.docx`);

  try {
    // Download
    const buf = await downloadBuffer(session.protocol_url);

    // Save raw file
    fs.writeFileSync(filePath, buf);

    // Extract text
    const result = await mammoth.extractRawText({ buffer: buf });
    const text = result.value.trim();

    // Save text to DB (empty string marks "downloaded but empty" — still won't re-download)
    saveText.run(text || '', session.id);
    return 'ok';
  } catch {
    return 'error';
  }
}

async function downloadProtocols(db: Database.Database) {
  const sessions = db.prepare(`
    SELECT id, protocol_url
    FROM committee_session
    WHERE protocol_url IS NOT NULL AND protocol_url != ''
      AND protocol_text IS NULL
    ORDER BY id ASC
  `).all() as { id: number; protocol_url: string }[];

  if (sessions.length === 0) {
    console.log('  Download: all protocols already downloaded.');
    return;
  }

  console.log(`  Downloading ${sessions.length} protocol files...`);

  const saveText = db.prepare(
    'UPDATE committee_session SET protocol_text = ? WHERE id = ?'
  );

  let done = 0;
  let errors = 0;

  for (let i = 0; i < sessions.length; i += CONCURRENCY) {
    const batch = sessions.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(s => downloadSession(s, saveText, db))
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value === 'error') errors++;
    }
    done += batch.length;
    if (done % 200 === 0 || done === sessions.length) {
      console.log(`    ${done}/${sessions.length} downloaded (${errors} errors)`);
    }
    await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
  }

  console.log(`\n  Download complete: ${done - errors} files saved to protocols/, ${errors} failed.`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  console.log('Download Protocols');
  console.log('  Migrations...');
  migrate(db);

  await fetchProtocolUrls(db);
  await downloadProtocols(db);

  db.close();

  const count = fs.readdirSync(PROTOCOLS_DIR).length;
  console.log(`\nDone. ${count} files in protocols/`);
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
