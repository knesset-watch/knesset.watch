/**
 * ONE-TIME seed script — run this locally to build knesset.db from scratch.
 *
 * Usage:
 *   cd apps/knesset-watch
 *   npm run db:seed
 *
 * Takes ~15-20 minutes (downloads all K25 vote, bill, query, and position data).
 * The resulting knesset.db file is committed to git and deployed with the app.
 */

import Database from 'better-sqlite3';
import path from 'path';

const K25_START = '2022-11-15T00:00:00+02:00';
const API = 'https://knesset.gov.il/OdataV4/ParliamentInfo';
const DB_PATH = path.join(process.cwd(), 'knesset.db');

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchPage(url: string): Promise<{ value: any[]; next: string | null }> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`Knesset API ${res.status} — ${url.slice(0, 120)}`);
  const json = await res.json();
  return { value: json.value ?? [], next: json['@odata.nextLink'] ?? null };
}

// Retry once on failure (Knesset API is occasionally flaky)
async function fetchWithRetry(url: string) {
  try {
    return await fetchPage(url);
  } catch {
    await new Promise(r => setTimeout(r, 2000));
    return await fetchPage(url);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function seed() {
  console.log(`Creating ${DB_PATH} …\n`);
  const db = new Database(DB_PATH);

  // ── Schema ──────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS plenary_vote (
      id    INTEGER PRIMARY KEY,
      title TEXT    NOT NULL,
      date  TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mk_vote_result (
      vote_id     INTEGER NOT NULL,
      mk_id       INTEGER NOT NULL,
      result_code INTEGER NOT NULL,
      PRIMARY KEY (vote_id, mk_id)
    );

    CREATE TABLE IF NOT EXISTS bill (
      id        INTEGER PRIMARY KEY,
      title     TEXT    NOT NULL,
      subtype   TEXT    NOT NULL,  -- פרטית / ממשלתית / ועדה
      status_id INTEGER NOT NULL,
      is_passed INTEGER NOT NULL DEFAULT 0  -- 1 if StatusID is a "passed" code
    );

    CREATE TABLE IF NOT EXISTS bill_initiator (
      bill_id INTEGER NOT NULL,
      mk_id   INTEGER NOT NULL,
      PRIMARY KEY (bill_id, mk_id)
    );

    CREATE TABLE IF NOT EXISTS mk_query (
      id          INTEGER PRIMARY KEY,
      mk_id       INTEGER NOT NULL,
      title       TEXT    NOT NULL,
      submit_date TEXT    NOT NULL
    );

    -- Positions: ministerial roles AND committee memberships (from KNS_PersonToPosition)
    CREATE TABLE IF NOT EXISTS mk_position (
      id           INTEGER PRIMARY KEY,
      mk_id        INTEGER NOT NULL,
      duty_desc    TEXT,             -- e.g. "שר האוצר", "יו"ר ועדה", null for plain MK
      committee_id INTEGER,
      committee    TEXT,             -- committee name if applicable
      ministry_id  INTEGER,
      ministry     TEXT,             -- ministry name if applicable
      start_date   TEXT    NOT NULL,
      finish_date  TEXT,             -- null = ongoing
      is_current   INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_result_mk    ON mk_vote_result (mk_id);
    CREATE INDEX IF NOT EXISTS idx_result_vote  ON mk_vote_result (vote_id);
    CREATE INDEX IF NOT EXISTS idx_vote_date    ON plenary_vote   (date);
    CREATE INDEX IF NOT EXISTS idx_bill_mk      ON bill_initiator (mk_id);
    CREATE INDEX IF NOT EXISTS idx_bill_passed  ON bill           (is_passed);
    CREATE INDEX IF NOT EXISTS idx_query_mk     ON mk_query       (mk_id);
    CREATE INDEX IF NOT EXISTS idx_position_mk  ON mk_position    (mk_id);
  `);

  // ── Step 1: votes ────────────────────────────────────────────────────────
  console.log('Step 1/3 — downloading plenary votes …');

  const insertVote = db.prepare(
    'INSERT OR REPLACE INTO plenary_vote (id, title, date) VALUES (?, ?, ?)',
  );
  const insertVotesBatch = db.transaction((rows: any[]) => {
    for (const r of rows) insertVote.run(r.Id, r.VoteTitle ?? '', r.VoteDateTime ?? '');
  });

  let voteCount = 0;
  let url: string | null =
    `${API}/KNS_PlenumVote` +
    `?$filter=${encodeURIComponent(`VoteDateTime ge ${K25_START}`)}` +
    `&$select=Id,VoteTitle,VoteDateTime`;

  while (url) {
    const { value, next } = await fetchWithRetry(url);
    insertVotesBatch(value);
    voteCount += value.length;
    process.stdout.write(`\r  ${voteCount} votes`);
    url = next;
  }
  console.log(`\n  ✓ ${voteCount} votes\n`);

  // ── Step 2: vote results (bulk — all MKs, all votes) ─────────────────────
  console.log('Step 2/3 — downloading vote results (this takes a few minutes) …');

  const insertResult = db.prepare(
    'INSERT OR REPLACE INTO mk_vote_result (vote_id, mk_id, result_code) VALUES (?, ?, ?)',
  );
  const insertResultsBatch = db.transaction((rows: any[]) => {
    for (const r of rows) insertResult.run(r.VoteID, r.MkId, r.ResultCode);
  });

  let resultCount = 0;
  url =
    `${API}/KNS_PlenumVoteResult` +
    `?$filter=${encodeURIComponent(`VoteDate ge ${K25_START}`)}` +
    `&$select=VoteID,MkId,ResultCode`;

  while (url) {
    const { value, next } = await fetchWithRetry(url);
    insertResultsBatch(value);
    resultCount += value.length;
    process.stdout.write(`\r  ${resultCount.toLocaleString()} results`);
    url = next;
  }
  console.log(`\n  ✓ ${resultCount.toLocaleString()} vote results\n`);

  // ── Step 3: bills + initiators (K25) ─────────────────────────────────────
  console.log('Step 3/5 — downloading K25 bills and initiators …');

  const PASSED_STATUS_IDS = new Set([118, 119, 6020, 6030, 6040]);
  const seenStatusIds = new Map<number, number>();

  const insertBill = db.prepare(
    'INSERT OR REPLACE INTO bill (id, title, subtype, status_id, is_passed) VALUES (?, ?, ?, ?, ?)',
  );
  const insertInitiator = db.prepare(
    'INSERT OR REPLACE INTO bill_initiator (bill_id, mk_id) VALUES (?, ?)',
  );
  const insertBillsBatch = db.transaction((rows: any[]) => {
    for (const r of rows) {
      const statusId = r.StatusID ?? 0;
      seenStatusIds.set(statusId, (seenStatusIds.get(statusId) ?? 0) + 1);
      insertBill.run(
        r.Id,
        r.Name ?? '',
        r.SubTypeDesc ?? '',
        statusId,
        PASSED_STATUS_IDS.has(statusId) ? 1 : 0,
      );
      for (const init of r.KNS_BillInitiator ?? []) {
        if (init.PersonID) insertInitiator.run(r.Id, init.PersonID);
      }
    }
  });

  let billCount = 0;
  url =
    `${API}/KNS_Bill` +
    `?$filter=${encodeURIComponent('KnessetNum eq 25')}` +
    `&$expand=KNS_BillInitiator($select=PersonID)` +
    `&$select=Id,Name,SubTypeDesc,StatusID`;

  while (url) {
    const { value, next } = await fetchWithRetry(url);
    insertBillsBatch(value);
    billCount += value.length;
    process.stdout.write(`\r  ${billCount.toLocaleString()} bills`);
    url = next;
  }
  console.log(`\n  ✓ ${billCount.toLocaleString()} bills\n`);

  // Warn about unknown bill status codes
  const unknownStatuses = Array.from(seenStatusIds.entries())
    .filter(([id]) => !PASSED_STATUS_IDS.has(id))
    .sort((a, b) => b[1] - a[1]);
  if (unknownStatuses.length > 0) {
    console.log('  ⚠️  WARNING: Unknown bill status codes encountered:');
    unknownStatuses.forEach(([id, count]) => {
      console.log(`      StatusID ${id}: ${count.toLocaleString()} bills (treated as NOT PASSED)`);
    });
    console.log('  These bills may be miscategorized. See scripts/seed.ts to update PASSED_STATUS_IDS.\n');
  }

  // ── Step 4: parliamentary queries (שאילתות) ───────────────────────────────
  console.log('Step 4/5 — downloading K25 parliamentary queries …');

  const insertQuery = db.prepare(
    'INSERT OR REPLACE INTO mk_query (id, mk_id, title, submit_date) VALUES (?, ?, ?, ?)',
  );
  const insertQueriesBatch = db.transaction((rows: any[]) => {
    for (const r of rows) {
      if (r.PersonID) insertQuery.run(r.Id, r.PersonID, r.Name ?? '', r.SubmitDate ?? '');
    }
  });

  let queryCount = 0;
  url =
    `${API}/KNS_Query` +
    `?$filter=${encodeURIComponent('KnessetNum eq 25')}` +
    `&$select=Id,PersonID,Name,SubmitDate`;

  while (url) {
    const { value, next } = await fetchWithRetry(url);
    insertQueriesBatch(value);
    queryCount += value.length;
    process.stdout.write(`\r  ${queryCount.toLocaleString()} queries`);
    url = next;
  }
  console.log(`\n  ✓ ${queryCount.toLocaleString()} queries\n`);

  // ── Step 5: positions + committee memberships ─────────────────────────────
  console.log('Step 5/5 — downloading K25 positions and committee memberships …');

  const insertPosition = db.prepare(
    `INSERT OR REPLACE INTO mk_position
       (id, mk_id, duty_desc, committee_id, committee, ministry_id, ministry, start_date, finish_date, is_current)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertPositionsBatch = db.transaction((rows: any[]) => {
    for (const r of rows) {
      insertPosition.run(
        r.Id,
        r.PersonID,
        r.DutyDesc ?? null,
        r.CommitteeID ?? null,
        r.CommitteeName ?? null,
        r.GovMinistryID ?? null,
        r.GovMinistryName ?? null,
        r.StartDate ?? '',
        r.FinishDate ?? null,
        r.IsCurrent ? 1 : 0,
      );
    }
  });

  let positionCount = 0;
  url =
    `${API}/KNS_PersonToPosition` +
    `?$filter=${encodeURIComponent('KnessetNum eq 25')}` +
    `&$select=Id,PersonID,DutyDesc,CommitteeID,CommitteeName,GovMinistryID,GovMinistryName,StartDate,FinishDate,IsCurrent`;

  while (url) {
    const { value, next } = await fetchWithRetry(url);
    insertPositionsBatch(value);
    positionCount += value.length;
    process.stdout.write(`\r  ${positionCount.toLocaleString()} positions`);
    url = next;
  }
  console.log(`\n  ✓ ${positionCount.toLocaleString()} positions\n`);

  db.close();
  console.log('Done! knesset.db is ready. Commit it and push to deploy.\n');
}

seed().catch(err => {
  console.error('\nSeed failed:', err.message);
  process.exit(1);
});
