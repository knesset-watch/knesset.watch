const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(process.cwd(), 'knesset.db'));

const mkId = 30682; // מיכאל מרדכי ביטון

// Query what getMkBills would return
const bills = db.prepare(`
  SELECT COUNT(*) as cnt FROM bill b
  JOIN bill_initiator i ON i.bill_id = b.id
  WHERE i.mk_id = ?
`).get(mkId);

// Query what getMkQueries would return
const queries = db.prepare(`
  SELECT COUNT(*) as cnt FROM mk_query
  WHERE mk_id = ?
`).get(mkId);

// Query what getMkPositions would return
const positions = db.prepare(`
  SELECT COUNT(*) as cnt FROM mk_position
  WHERE mk_id = ? AND (committee_id IS NOT NULL OR ministry_id IS NOT NULL OR duty_desc IS NOT NULL)
`).get(mkId);

console.log(`\nID 30682 — מיכאל מרדכי ביטון\n`);
console.log(`Bills (from bill_initiator): ${bills.cnt}`);
console.log(`Queries (from mk_query): ${queries.cnt}`);
console.log(`Positions (filtered): ${positions.cnt}`);

// Now let's check what data we have for this MK in different tables
const billCheck = db.prepare(`
  SELECT COUNT(DISTINCT b.id) as cnt FROM bill b
  JOIN bill_initiator bi ON bi.bill_id = b.id
  WHERE bi.mk_id = ?
`).get(mkId);

const queryCheck = db.prepare(`
  SELECT COUNT(*) as cnt FROM mk_query WHERE mk_id = ?
`).get(mkId);

const posCheck = db.prepare(`
  SELECT COUNT(*) as cnt FROM mk_position WHERE mk_id = ?
`).get(mkId);

const posCheckFiltered = db.prepare(`
  SELECT COUNT(*) as cnt FROM mk_position
  WHERE mk_id = ? AND (committee_id IS NOT NULL OR ministry_id IS NOT NULL OR duty_desc IS NOT NULL)
`).get(mkId);

console.log(`\nVerification queries:\n`);
console.log(`Distinct Bills initiated: ${billCheck.cnt}`);
console.log(`Total Queries: ${queryCheck.cnt}`);
console.log(`Total Positions (all): ${posCheck.cnt}`);
console.log(`Positions (filtered): ${posCheckFiltered.cnt}`);

db.close();
