const Database = require('better-sqlite3');
const db = new Database('knesset.db');

// Helper: get MK stats
function getMkExpectedStats(mkId) {
  const mkVotes = db.prepare('SELECT COUNT(*) as cnt FROM mk_vote_result WHERE mk_id = ?').get(mkId).cnt;
  const tenure = db.prepare(
    `SELECT MIN(start_date) as startDate, MAX(COALESCE(finish_date, datetime('now'))) as endDate
     FROM mk_position WHERE mk_id = ?`
  ).get(mkId);
  
  const startDate = tenure?.startDate ?? '2022-11-15';
  const endDate = tenure?.endDate ?? '9999-12-31';
  
  const totalVotesInWindow = db.prepare(
    `SELECT COUNT(*) as cnt FROM plenary_vote WHERE date >= ? AND date <= ?`
  ).get(startDate, endDate).cnt;
  
  const bills = db.prepare(
    `SELECT COUNT(DISTINCT b.id) as cnt FROM bill b 
     JOIN bill_initiator i ON i.bill_id = b.id WHERE i.mk_id = ?`
  ).get(mkId).cnt;
  
  const queries = db.prepare(
    `SELECT COUNT(*) as cnt FROM mk_query WHERE mk_id = ?`
  ).get(mkId).cnt;
  
  const positions = db.prepare(
    `SELECT COUNT(*) as cnt FROM mk_position 
     WHERE mk_id = ? AND (committee_id IS NOT NULL OR ministry_id IS NOT NULL OR duty_desc IS NOT NULL)`
  ).get(mkId).cnt;
  
  return {
    votes: mkVotes,
    absence: Math.max(0, totalVotesInWindow - mkVotes),
    bills,
    queries,
    positions
  };
}

// Generate random MK IDs for samples
function getRandomMks(count = 5) {
  const mks = db.prepare('SELECT DISTINCT mk_id FROM mk_vote_result ORDER BY RANDOM() LIMIT ?').all(count);
  return mks.map(r => r.mk_id);
}

// Generate full audit data
console.log('📊 FULL AUDIT DATA GENERATION\n');
console.log('MK SAMPLES (5 random):');
const mkSamples = getRandomMks(5);
mkSamples.forEach(mkId => {
  const stats = getMkExpectedStats(mkId);
  console.log(`/mk/${mkId}: Bills=${stats.bills}, Queries=${stats.queries}, Positions=${stats.positions}, Votes=${stats.votes}, Absence=${stats.absence}`);
});

console.log('\nVOTE SAMPLES (5 random):');
const votes = db.prepare('SELECT id FROM plenary_vote ORDER BY RANDOM() LIMIT 5').all();
votes.forEach(v => {
  const forCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM mk_vote_result WHERE vote_id = ? AND result_code = 7'
  ).get(v.id).cnt;
  const againstCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM mk_vote_result WHERE vote_id = ? AND result_code = 8'
  ).get(v.id).cnt;
  const abstainCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM mk_vote_result WHERE vote_id = ? AND result_code = 9'
  ).get(v.id).cnt;
  console.log(`/vote/${v.id}: For=${forCount}, Against=${againstCount}, Abstain=${abstainCount}`);
});

console.log('\nCOMMITTEE SAMPLES (5 random):');
const committees = db.prepare(
  'SELECT DISTINCT committee FROM mk_position WHERE committee IS NOT NULL ORDER BY RANDOM() LIMIT 5'
).all();
committees.forEach(c => {
  const members = db.prepare(
    'SELECT COUNT(DISTINCT mk_id) as cnt FROM mk_position WHERE committee = ?'
  ).get(c.committee).cnt;
  const sessions = db.prepare(
    'SELECT COUNT(*) as cnt FROM committee_session WHERE committee_name = ?'
  ).get(c.committee).cnt || 0;
  console.log(`/committee/${encodeURIComponent(c.committee)}: Members=${members}, Sessions=${sessions}`);
});

console.log('\nFACTION SAMPLES (5 random):');
const factions = db.prepare(
  'SELECT DISTINCT faction_name FROM faction_coalition_history WHERE faction_name IS NOT NULL ORDER BY RANDOM() LIMIT 5'
).all();
factions.forEach(f => {
  const mkCount = db.prepare(
    'SELECT COUNT(DISTINCT mk_id) as cnt FROM mk_person WHERE faction_name = ?'
  ).get(f.faction_name).cnt;
  console.log(`/faction/${encodeURIComponent(f.faction_name)}: MKs=${mkCount}`);
});

console.log('\nMINISTRY SAMPLES (5 random):');
const ministries = db.prepare(
  'SELECT DISTINCT ministry FROM mk_position WHERE ministry IS NOT NULL ORDER BY RANDOM() LIMIT 5'
).all();
ministries.forEach(m => {
  const bills = db.prepare(
    'SELECT COUNT(DISTINCT b.id) as cnt FROM bill b JOIN bill_initiator i ON i.bill_id = b.id '
    + 'JOIN mk_person p ON p.person_id = i.mk_id WHERE p.ministry = ?'
  ).get(m.ministry).cnt;
  console.log(`/ministry/${encodeURIComponent(m.ministry)}: Bills=${bills}`);
});

console.log('\nMINISTERS PAGE: Count ministers in government');
const ministers = db.prepare(
  `SELECT COUNT(DISTINCT mk_id) as cnt FROM mk_position 
   WHERE ministry_id IS NOT NULL AND is_current = 1`
).get().cnt;
console.log(`/ministers: Active=${ministers} (baseline from DB: 33+ expected from Knesset gov)`);

db.close();
