// scripts/backfill-session-status.ts
// Run: npm run db:backfill-status
//
// Enriches committee_session with metadata from the Knesset OData API:
//   1. Session status (active/cancelled), type (open/closed), sequential number
//   2. Committee entities table (committee as a first-class node)
//   3. All document types per session → session_document table (not just protocols)
//   4. Session→bill links for ALL sessions → session_bill table
//   5. Joint session detection → session_committee bridge table
//   6. Computes no_protocol_reason for sessions without protocols
//
// Resume-safe: already-enriched sessions are skipped per field.

import Database from 'better-sqlite3';
import path from 'path';

const ODATA_API = 'https://knesset.gov.il/OdataV4/ParliamentInfo';
const DB_PATH = path.join(process.cwd(), 'knesset.db');
const PAGE_DELAY_MS = 150;

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function fetchAll(url: string, label: string): Promise<any[]> {
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
      process.stdout.write(`\r    ${label}: ${results.length.toLocaleString()} records...`);
    }
    if (next) await new Promise(r => setTimeout(r, PAGE_DELAY_MS));
  }
  return results;
}

// ── Migrations ────────────────────────────────────────────────────────────────

function migrate(db: Database.Database) {
  const sessionCols = (db.prepare('PRAGMA table_info(committee_session)').all() as any[]).map((c: any) => c.name);

  const addIfMissing = (col: string, def: string) => {
    if (!sessionCols.includes(col)) {
      db.exec(`ALTER TABLE committee_session ADD COLUMN ${col} ${def}`);
      console.log(`  Added ${col} to committee_session.`);
    }
  };

  addIfMissing('knesset_num', 'INTEGER DEFAULT 25');
  addIfMissing('status_id', 'INTEGER');
  addIfMissing('status_desc', 'TEXT');
  addIfMissing('type_id', 'INTEGER');
  addIfMissing('type_desc', 'TEXT');
  addIfMissing('session_number', 'INTEGER');
  addIfMissing('protocol_number', 'INTEGER');
  addIfMissing('session_term', 'INTEGER');
  addIfMissing('start_time', 'TEXT');
  addIfMissing('end_time', 'TEXT');
  addIfMissing('attendance_disclaimer', 'INTEGER DEFAULT 0');
  addIfMissing('no_protocol_reason', 'TEXT');
  addIfMissing('is_revision', 'INTEGER DEFAULT 0');
  addIfMissing('is_joint', 'INTEGER DEFAULT 0');

  db.exec(`
    CREATE TABLE IF NOT EXISTS committee (
      id          INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      type_id     INTEGER,
      type_desc   TEXT,
      knesset_num INTEGER DEFAULT 25
    );

    CREATE TABLE IF NOT EXISTS session_document (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id       INTEGER NOT NULL,
      group_type_id    INTEGER,
      group_type_desc  TEXT,
      document_name    TEXT,
      file_path        TEXT,
      application_desc TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_doc_session ON session_document (session_id);

    CREATE TABLE IF NOT EXISTS session_committee (
      session_id   INTEGER NOT NULL,
      committee_id INTEGER NOT NULL,
      is_primary   INTEGER DEFAULT 1,
      PRIMARY KEY (session_id, committee_id)
    );

    CREATE TABLE IF NOT EXISTS faction (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      knesset_num INTEGER DEFAULT 25
    );

    CREATE TABLE IF NOT EXISTS mk_faction_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      mk_id      INTEGER NOT NULL,
      faction_id INTEGER NOT NULL,
      from_date  TEXT NOT NULL,
      to_date    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_faction_mk ON mk_faction_history (mk_id);

    CREATE TABLE IF NOT EXISTS mk_minister_role (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      mk_id           INTEGER NOT NULL,
      ministry_name   TEXT NOT NULL,
      organization_id INTEGER,
      from_date       TEXT,
      to_date         TEXT
    );

    CREATE TABLE IF NOT EXISTS organization (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      name     TEXT NOT NULL UNIQUE,
      org_type TEXT
    );

    CREATE TABLE IF NOT EXISTS person (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      organization_id INTEGER,
      role            TEXT,
      lobbyist_id     INTEGER
    );

    CREATE TABLE IF NOT EXISTS session_bill (
      session_id INTEGER NOT NULL,
      bill_id    INTEGER NOT NULL,
      PRIMARY KEY (session_id, bill_id)
    );
    CREATE INDEX IF NOT EXISTS idx_session_bill_bill ON session_bill (bill_id);
  `);
}

// ── Step 1: Committee entities ────────────────────────────────────────────────

async function backfillCommittees(db: Database.Database) {
  const existing = (db.prepare('SELECT COUNT(*) as cnt FROM committee').get() as { cnt: number }).cnt;
  if (existing > 0) {
    console.log(`  Committees: ${existing} already loaded, skipping.`);
    return;
  }

  console.log('  Fetching committee metadata from OData...');
  const rows = await fetchAll(
    `${ODATA_API}/KNS_Committee?$select=Id,Name`,
    'committees'
  );
  console.log(`\n    ${rows.length} committees found.`);

  const insert = db.prepare(
    'INSERT OR REPLACE INTO committee (id, name, type_id, type_desc, knesset_num) VALUES (?, ?, ?, ?, ?)'
  );
  db.transaction(() => {
    for (const r of rows) {
      insert.run(r.Id, r.Name, null, null, 25);
    }
  })();
  console.log(`  Committees done: ${rows.length} loaded.`);
}

// ── Step 2: Session status/type/number backfill ───────────────────────────────

async function backfillSessionStatus(db: Database.Database) {
  const remaining = (db.prepare(
    "SELECT COUNT(*) as cnt FROM committee_session WHERE status_id IS NULL"
  ).get() as { cnt: number }).cnt;

  if (remaining === 0) {
    console.log('  Session status: already complete.');
    return;
  }

  console.log(`  Fetching session status for ${remaining} sessions...`);
  const rows = await fetchAll(
    `${ODATA_API}/KNS_CommitteeSession?$filter=KnessetNum eq 25&$select=Id,StatusID,StatusDesc,TypeID,TypeDesc,Number,KnessetNum`,
    'sessions'
  );
  console.log(`\n    ${rows.length} session records from OData.`);

  const update = db.prepare(`
    UPDATE committee_session
    SET status_id = ?, status_desc = ?, type_id = ?, type_desc = ?, session_number = ?, knesset_num = ?
    WHERE id = ?
  `);

  let updated = 0;
  db.transaction(() => {
    for (const r of rows) {
      const result = update.run(r.StatusID, r.StatusDesc, r.TypeID, r.TypeDesc, r.Number, r.KnessetNum ?? 25, r.Id);
      if (result.changes > 0) updated++;
    }
  })();
  console.log(`  Session status done: ${updated} sessions updated.`);
}

// ── Step 3: All session documents (not just protocols) ────────────────────────

async function backfillSessionDocuments(db: Database.Database) {
  const existing = (db.prepare('SELECT COUNT(*) as cnt FROM session_document').get() as { cnt: number }).cnt;
  if (existing > 0) {
    console.log(`  Session documents: ${existing} already loaded, skipping.`);
    return;
  }

  const { minId, maxId } = db.prepare(
    'SELECT MIN(id) as minId, MAX(id) as maxId FROM committee_session'
  ).get() as { minId: number; maxId: number };

  console.log('  Fetching all session documents from OData (all GroupTypeIDs)...');
  const rows = await fetchAll(
    `${ODATA_API}/KNS_DocumentCommitteeSession?$filter=CommitteeSessionID ge ${minId} and CommitteeSessionID le ${maxId}&$select=CommitteeSessionID,GroupTypeID,GroupTypeDesc,DocumentName,FilePath,ApplicationDesc`,
    'documents'
  );
  console.log(`\n    ${rows.length} documents found across all types.`);

  // Count by type
  const typeCounts = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.GroupTypeID}: ${r.GroupTypeDesc}`;
    typeCounts.set(key, (typeCounts.get(key) ?? 0) + 1);
  }
  console.log('  Document types:');
  [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`    ${v.toLocaleString()}x ${k}`);
  });

  // Only insert for sessions we have in our DB
  const ourIds = new Set(
    (db.prepare('SELECT id FROM committee_session').all() as { id: number }[]).map(r => r.id)
  );

  const insert = db.prepare(`
    INSERT INTO session_document (session_id, group_type_id, group_type_desc, document_name, file_path, application_desc)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  db.transaction(() => {
    for (const r of rows) {
      if (ourIds.has(r.CommitteeSessionID)) {
        insert.run(r.CommitteeSessionID, r.GroupTypeID, r.GroupTypeDesc, r.DocumentName, r.FilePath, r.ApplicationDesc);
        inserted++;
      }
    }
  })();
  console.log(`  Session documents done: ${inserted} document records inserted.`);
}

// ── Step 4: Session→bill links for all sessions ───────────────────────────────

async function backfillSessionBills(db: Database.Database) {
  const existing = (db.prepare('SELECT COUNT(*) as cnt FROM session_bill').get() as { cnt: number }).cnt;
  if (existing > 0) {
    console.log(`  Session bills: ${existing} already loaded, skipping.`);
    return;
  }

  const { minId, maxId } = db.prepare(
    'SELECT MIN(id) as minId, MAX(id) as maxId FROM committee_session'
  ).get() as { minId: number; maxId: number };

  console.log('  Fetching session→bill links for all sessions...');
  let rows: any[] = [];
  try {
    rows = await fetchAll(
      `${ODATA_API}/KNS_CmtSessionItem?$filter=CommitteeSessionID ge ${minId} and CommitteeSessionID le ${maxId}&$select=CommitteeSessionID,ItemID`,
      'session-bills'
    );
  } catch (err) {
    console.log(`  Warning: session→bill fetch failed (${(err as Error).message}). Skipping.`);
    return;
  }
  console.log(`\n    ${rows.length} session→bill links found.`);

  const ourIds = new Set(
    (db.prepare('SELECT id FROM committee_session').all() as { id: number }[]).map(r => r.id)
  );

  const insert = db.prepare('INSERT OR IGNORE INTO session_bill (session_id, bill_id) VALUES (?, ?)');
  let inserted = 0;
  db.transaction(() => {
    for (const r of rows) {
      if (ourIds.has(r.CommitteeSessionID) && r.ItemID) {
        insert.run(r.CommitteeSessionID, r.ItemID);
        inserted++;
      }
    }
  })();
  console.log(`  Session bills done: ${inserted} links inserted.`);
}

// ── Step 5: Joint session detection via session_committee bridge ───────────────

async function backfillJointSessions(db: Database.Database) {
  const existing = (db.prepare('SELECT COUNT(*) as cnt FROM session_committee').get() as { cnt: number }).cnt;
  if (existing > 0) {
    console.log(`  Joint sessions: ${existing} records already loaded, skipping.`);
    return;
  }

  // Populate primary committee for all sessions first
  const sessions = db.prepare('SELECT id, committee_id FROM committee_session').all() as { id: number; committee_id: number }[];
  const insertPrimary = db.prepare(
    'INSERT OR IGNORE INTO session_committee (session_id, committee_id, is_primary) VALUES (?, ?, 1)'
  );
  db.transaction(() => {
    for (const s of sessions) {
      if (s.committee_id) insertPrimary.run(s.id, s.committee_id);
    }
  })();
  console.log(`  session_committee: ${sessions.length} primary entries populated.`);

  // Detect joint sessions from protocol text
  const jointSessions = db.prepare(`
    SELECT id, committee_id, protocol_text
    FROM committee_session
    WHERE protocol_text LIKE '%ישיבה משותפת%'
       OR title LIKE '%משותפת%'
  `).all() as { id: number; committee_id: number; protocol_text: string }[];

  if (jointSessions.length > 0) {
    db.prepare(`UPDATE committee_session SET is_joint = 1 WHERE id IN (
      SELECT id FROM committee_session WHERE protocol_text LIKE '%ישיבה משותפת%' OR title LIKE '%משותפת%'
    )`).run();
    console.log(`  Flagged ${jointSessions.length} sessions as joint (is_joint=1). Manual review needed to add secondary committee links.`);
  }
}

// ── Step 6: Compute no_protocol_reason ───────────────────────────────────────

function computeNoProtocolReasons(db: Database.Database) {
  // Sessions with no protocol URL
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // 60 days ago

  db.exec(`
    UPDATE committee_session
    SET no_protocol_reason = CASE
      WHEN status_desc = 'מבוטלת' THEN 'cancelled'
      WHEN type_desc LIKE '%סגור%' OR type_desc LIKE '%חסוי%' THEN 'closed_session'
      WHEN date > '${cutoff}' THEN 'not_yet_published'
      ELSE 'unpublished'
    END
    WHERE (protocol_url IS NULL OR protocol_url = '')
      AND no_protocol_reason IS NULL
  `);

  const counts = db.prepare(`
    SELECT no_protocol_reason, COUNT(*) as cnt
    FROM committee_session
    WHERE protocol_url IS NULL OR protocol_url = ''
    GROUP BY no_protocol_reason
  `).all() as { no_protocol_reason: string; cnt: number }[];

  console.log('  No-protocol reason breakdown:');
  counts.forEach(r => console.log(`    ${r.cnt}x ${r.no_protocol_reason}`));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  console.log('Backfill Session Status & Metadata');
  console.log('  Migrations...');
  migrate(db);
  console.log('');

  await backfillCommittees(db);
  console.log('');
  await backfillSessionStatus(db);
  console.log('');
  await backfillSessionDocuments(db);
  console.log('');
  await backfillSessionBills(db);
  console.log('');
  await backfillJointSessions(db);
  console.log('');
  computeNoProtocolReasons(db);

  db.close();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
