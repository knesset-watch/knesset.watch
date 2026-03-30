/**
 * Adds the bills, queries, and positions tables to an existing knesset.db.
 * Run this after the initial seed is complete if those tables are missing.
 *
 * Usage:
 *   cd apps/knesset-watch
 *   npx tsx scripts/seed-extra.ts
 */

import Database from 'better-sqlite3';
import path from 'path';

const API = 'https://knesset.gov.il/OdataV4/ParliamentInfo';
const DB_PATH = path.join(process.cwd(), 'knesset.db');
const PASSED_STATUS_IDS = new Set([118, 119, 6020, 6030, 6040]);

async function fetchPage(url: string): Promise<{ value: any[]; next: string | null }> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`Knesset API ${res.status} — ${url.slice(0, 120)}`);
  const json = await res.json();
  return { value: json.value ?? [], next: json['@odata.nextLink'] ?? null };
}

async function fetchWithRetry(url: string) {
  try {
    return await fetchPage(url);
  } catch {
    await new Promise(r => setTimeout(r, 2000));
    return await fetchPage(url);
  }
}

async function seedExtra() {
  const db = new Database(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS mk_person (
      person_id   INTEGER PRIMARY KEY,
      first_name  TEXT    NOT NULL DEFAULT '',
      last_name   TEXT    NOT NULL DEFAULT '',
      faction_id  INTEGER,
      faction_name TEXT,
      slug        TEXT
    );

    CREATE TABLE IF NOT EXISTS bill (
      id             INTEGER PRIMARY KEY,
      title          TEXT    NOT NULL,
      subtype        TEXT    NOT NULL,
      status_id      INTEGER NOT NULL,
      is_passed      INTEGER NOT NULL DEFAULT 0,
      committee_id   INTEGER,
      committee_name TEXT,
      summary        TEXT,
      doc_url        TEXT
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

    CREATE TABLE IF NOT EXISTS mk_position (
      id           INTEGER PRIMARY KEY,
      mk_id        INTEGER NOT NULL,
      duty_desc    TEXT,
      committee_id INTEGER,
      committee    TEXT,
      ministry_id  INTEGER,
      ministry     TEXT,
      start_date   TEXT    NOT NULL,
      finish_date  TEXT,
      is_current   INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_bill_mk      ON bill_initiator (mk_id);
    CREATE INDEX IF NOT EXISTS idx_bill_passed  ON bill           (is_passed);
    CREATE INDEX IF NOT EXISTS idx_query_mk     ON mk_query       (mk_id);
    CREATE INDEX IF NOT EXISTS idx_position_mk  ON mk_position    (mk_id);
  `);

  // ── MK person identity ────────────────────────────────────────────────────
  console.log('Step 0/3 — downloading K25 MK identities …');

  function mkSlug(first: string, last: string, id: number): string {
    const f = (first ?? '').trim();
    const l = (last  ?? '').trim();
    if (f || l) return `${f}-${l}`.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
    return String(id);
  }

  const insertPerson = db.prepare(
    `INSERT OR REPLACE INTO mk_person (person_id, first_name, last_name, faction_id, faction_name, slug)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  // Fetch persons and factions in two separate requests (API doesn't support multi-expand
  // or $select on the outer entity when using $expand with $select)
  let personUrl: string | null =
    `${API}/KNS_PersonToPosition` +
    `?$filter=${encodeURIComponent('KnessetNum eq 25 and PositionID eq 54')}` +
    `&$expand=KNS_Person($select=Id,FirstName,LastName)` +
    `&$orderby=IsCurrent desc,StartDate desc`;

  // Fetch all factions for name lookup
  const factionRes = await fetchWithRetry(`${API}/KNS_Faction?$filter=${encodeURIComponent('KnessetNum eq 25')}`);
  const factionMap = new Map<number, string>();
  for (const f of factionRes.value) {
    if (f.Id != null && f.Name) factionMap.set(f.Id, f.Name);
  }
  // Paginate through factions
  let facNext = factionRes.next;
  while (facNext) {
    const { value, next } = await fetchWithRetry(facNext);
    for (const f of value) {
      if (f.Id != null && f.Name) factionMap.set(f.Id, f.Name);
    }
    facNext = next;
  }

  // Collect latest record per person (first occurrence = highest priority after orderby)
  const seen = new Set<number>();
  let personCount = 0;
  const insertPersonsBatch = db.transaction((rows: any[]) => {
    for (const r of rows) {
      const p = r.KNS_Person;
      if (!p || seen.has(p.Id)) continue;
      seen.add(p.Id);
      const factionName = r.FactionID != null ? (factionMap.get(r.FactionID) ?? null) : null;
      const slug = mkSlug('', '', p.Id); // slug based on ID; slug routing uses page.tsx separately
      insertPerson.run(p.Id, p.FirstName ?? '', p.LastName ?? '', r.FactionID ?? null, factionName, slug);
      personCount++;
    }
  });

  while (personUrl) {
    const { value, next } = await fetchWithRetry(personUrl);
    insertPersonsBatch(value);
    process.stdout.write(`\r  ${personCount} persons`);
    personUrl = next;
  }
  console.log(`\n  ✓ ${personCount} persons\n`);

  // ── Bills + initiators ────────────────────────────────────────────────────
  console.log('Step 1/3 — downloading K25 bills and initiators …');

  // Fetch committee names for bill tagging
  console.log('Fetching committees for bill tagging…');
  const committeeRes = await fetchWithRetry(`${API}/KNS_Committee?$select=Id,Name`);
  const committeeMap = new Map<number, string>();
  const addCommittees = (rows: any[]) => { for (const r of rows) { if (r.Id != null && r.Name) committeeMap.set(r.Id, r.Name); } };
  addCommittees(committeeRes.value);
  let cNext = committeeRes.next;
  while (cNext) { const { value, next } = await fetchWithRetry(cNext); addCommittees(value); cNext = next; }
  console.log(`  ${committeeMap.size} committees\n`);

  const insertBill = db.prepare(
    'INSERT OR REPLACE INTO bill (id, title, subtype, status_id, is_passed, committee_id, committee_name, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertInitiator = db.prepare(
    'INSERT OR REPLACE INTO bill_initiator (bill_id, mk_id) VALUES (?, ?)',
  );
  const insertBillsBatch = db.transaction((rows: any[]) => {
    for (const r of rows) {
      const committeeName = r.CommitteeID != null ? (committeeMap.get(r.CommitteeID) ?? null) : null;
      insertBill.run(
        r.Id, r.Name ?? '', r.SubTypeDesc ?? '', r.StatusID ?? 0,
        PASSED_STATUS_IDS.has(r.StatusID) ? 1 : 0,
        r.CommitteeID ?? null, committeeName,
        r.SummaryLaw?.trim() ?? null,
      );
      for (const init of r.KNS_BillInitiator ?? []) {
        if (init.PersonID) insertInitiator.run(r.Id, init.PersonID);
      }
    }
  });

  let billCount = 0;
  let url: string | null =
    `${API}/KNS_Bill` +
    `?$filter=${encodeURIComponent('KnessetNum eq 25')}` +
    `&$expand=KNS_BillInitiator($select=PersonID)` +
    `&$select=Id,Name,SubTypeDesc,StatusID,CommitteeID,SummaryLaw`;

  while (url) {
    const { value, next } = await fetchWithRetry(url);
    insertBillsBatch(value);
    billCount += value.length;
    process.stdout.write(`\r  ${billCount.toLocaleString()} bills`);
    url = next;
  }
  console.log(`\n  ✓ ${billCount.toLocaleString()} bills\n`);

  // ── Bill document URLs ─────────────────────────────────────────────────────
  console.log('Fetching bill document links (PDF preferred)…');
  const normPath = (p: string) => p.replace(/\\/g, '/').replace(/\/\//g, '/').replace('https:/', 'https://');
  const docUrlMap = new Map<number, string>();

  // Fetch DOC first, then PDF to overwrite (PDF preferred)
  for (const appId of [1, 4]) {
    let docUrl: string | null =
      `${API}/KNS_DocumentBill?$filter=${encodeURIComponent(`GroupTypeID eq 1 and ApplicationID eq ${appId}`)}&$select=BillID,FilePath`;
    let docCount = 0;
    while (docUrl) {
      const { value, next } = await fetchWithRetry(docUrl);
      for (const r of value) docUrlMap.set(r.BillID, normPath(r.FilePath));
      docCount += value.length;
      docUrl = next;
    }
    console.log(`  ${appId === 1 ? 'DOC' : 'PDF'}: ${docCount.toLocaleString()} records`);
  }

  const updateDocUrl = db.prepare(`UPDATE bill SET doc_url = ? WHERE id = ?`);
  let docUpdated = 0;
  db.transaction(() => {
    for (const [billId, docUrl] of docUrlMap) {
      const changes = updateDocUrl.run(docUrl, billId).changes;
      docUpdated += changes;
    }
  })();
  console.log(`  ✓ ${docUpdated.toLocaleString()} bill doc URLs set\n`);

  // ── Queries ───────────────────────────────────────────────────────────────
  console.log('Step 2/3 — downloading K25 parliamentary queries …');

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

  // ── Positions ─────────────────────────────────────────────────────────────
  console.log('Step 3/3 — downloading K25 positions and committee memberships …');

  const insertPosition = db.prepare(
    `INSERT OR REPLACE INTO mk_position
       (id, mk_id, duty_desc, committee_id, committee, ministry_id, ministry, start_date, finish_date, is_current)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertPositionsBatch = db.transaction((rows: any[]) => {
    for (const r of rows) {
      insertPosition.run(
        r.Id, r.PersonID, r.DutyDesc ?? null,
        r.CommitteeID ?? null, r.CommitteeName ?? null,
        r.GovMinistryID ?? null, r.GovMinistryName ?? null,
        r.StartDate ?? '', r.FinishDate ?? null,
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
  console.log('Done! Extra tables added to knesset.db.\n');
}

seedExtra().catch(err => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
