const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(process.cwd(), 'knesset.db'));

// Get 5 NEW random MKs (different from the ones I audited before)
const newMks = db.prepare(`
  SELECT person_id, first_name, last_name, faction_name
  FROM mk_person 
  WHERE person_id NOT IN (30811, 30681, 30807, 30695, 30693, 30682, 30846, 23558, 30871)
  ORDER BY RANDOM() LIMIT 5
`).all();

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║  PROPER AUDIT PROTOCOL — 5 New Random MK Samples         ║');
console.log('║  Expected values to verify against UI display             ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

newMks.forEach((mk, idx) => {
  // Bills
  const bills = db.prepare(`
    SELECT COUNT(DISTINCT b.id) as cnt FROM bill b
    JOIN bill_initiator bi ON bi.bill_id = b.id
    WHERE bi.mk_id = ?
  `).get(mk.person_id);

  // Queries
  const queries = db.prepare(`
    SELECT COUNT(*) as cnt FROM mk_query
    WHERE mk_id = ?
  `).get(mk.person_id);

  // Positions (filtered)
  const positionsFiltered = db.prepare(`
    SELECT COUNT(*) as cnt FROM mk_position
    WHERE mk_id = ? AND (committee_id IS NOT NULL OR ministry_id IS NOT NULL OR duty_desc IS NOT NULL)
  `).get(mk.person_id);

  // Votes
  const votes = db.prepare(`
    SELECT COUNT(DISTINCT vote_id) as cnt FROM mk_vote_result
    WHERE mk_id = ?
  `).get(mk.person_id);

  // Absence (using tenure filter)
  const tenure = db.prepare(`
    SELECT MIN(start_date) as start, COALESCE(MAX(finish_date), '2999-12-31') as end
    FROM mk_position WHERE mk_id = ?
  `).get(mk.person_id);

  const start = tenure?.start || '2022-11-15';
  const end = tenure?.end || '9999-12-31';

  const totalPossibleVotes = db.prepare(`
    SELECT COUNT(*) as cnt FROM plenary_vote
    WHERE date >= ? AND date <= ?
  `).get(start, end);

  const absenceCount = Math.max(0, totalPossibleVotes.cnt - votes.cnt);

  console.log(`${idx + 1}. /mk/${mk.person_id} — ${mk.first_name} ${mk.last_name}`);
  console.log(`   Faction: ${mk.faction_name || '—'}`);
  console.log(`   ✓ Bills: ${bills.cnt}`);
  console.log(`   ✓ Queries: ${queries.cnt}`);
  console.log(`   ✓ Positions (filtered): ${positionsFiltered.cnt}`);
  console.log(`   ✓ Votes: ${votes.cnt}`);
  console.log(`   ✓ Absence Count: ${absenceCount}`);
  console.log(`   Check on page: http://localhost:3001/mk/${mk.person_id}\n`);
});

// Get 5 new VOTES
console.log('\n═══════════════════════════════════════════════════════════\n');
console.log('🗳️  5 New Random Votes\n');

const newVotes = db.prepare(`
  SELECT id, title, date FROM plenary_vote 
  ORDER BY RANDOM() LIMIT 5
`).all();

newVotes.forEach((vote, idx) => {
  const stats = db.prepare(`
    SELECT 
      SUM(CASE WHEN result_code = 7 THEN 1 ELSE 0 END) as forCount,
      SUM(CASE WHEN result_code = 8 THEN 1 ELSE 0 END) as againstCount,
      SUM(CASE WHEN result_code = 9 THEN 1 ELSE 0 END) as abstainCount
    FROM mk_vote_result WHERE vote_id = ?
  `).get(vote.id);

  console.log(`${idx + 1}. /vote/${vote.id}`);
  console.log(`   Title: "${vote.title.substring(0, 50)}..."`);
  console.log(`   Date: ${vote.date.substring(0, 10)}`);
  console.log(`   ✓ For: ${stats.forCount}, Against: ${stats.againstCount}, Abstain: ${stats.abstainCount}`);
  console.log(`   Check on page: http://localhost:3001/vote/${vote.id}\n`);
});

// Get 5 new COMMITTEES
console.log('\n═══════════════════════════════════════════════════════════\n');
console.log('🏛️  5 New Random Committees\n');

const newComms = db.prepare(`
  SELECT DISTINCT committee FROM mk_position
  WHERE committee IS NOT NULL
  ORDER BY RANDOM() LIMIT 5
`).all();

newComms.forEach((comm, idx) => {
  const sessCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM committee_session 
    WHERE committee_name = ?
  `).get(comm.committee);

  const membCount = db.prepare(`
    SELECT COUNT(DISTINCT mk_id) as cnt FROM mk_position
    WHERE committee = ?
  `).get(comm.committee);

  console.log(`${idx + 1}. /committee/${encodeURIComponent(comm.committee)}`);
  console.log(`   ✓ Sessions: ${sessCount.cnt}, Members: ${membCount.cnt}`);
  console.log();
});

// Get 5 new FACTIONS
console.log('═══════════════════════════════════════════════════════════\n');
console.log('⚡ 5 New Random Factions\n');

const newFactions = db.prepare(`
  SELECT DISTINCT faction_name FROM mk_person
  WHERE faction_name IS NOT NULL
  ORDER BY RANDOM() LIMIT 5
`).all();

newFactions.forEach((fac, idx) => {
  const mkCount = db.prepare(`
    SELECT COUNT(DISTINCT person_id) as cnt FROM mk_person
    WHERE faction_name = ?
  `).get(fac.faction_name);

  const billCount = db.prepare(`
    SELECT COUNT(DISTINCT b.id) as cnt FROM bill b
    JOIN bill_initiator bi ON bi.bill_id = b.id
    JOIN mk_person m ON m.person_id = bi.mk_id
    WHERE m.faction_name = ?
  `).get(fac.faction_name);

  console.log(`${idx + 1}. /faction/${encodeURIComponent(fac.faction_name)}`);
  console.log(`   ✓ MKs: ${mkCount.cnt}, Bills: ${billCount.cnt}`);
  console.log();
});

// Get 5 new MINISTRIES
console.log('═══════════════════════════════════════════════════════════\n');
console.log('🏢 5 New Random Ministries\n');

const newMinistries = db.prepare(`
  SELECT DISTINCT ministry FROM mk_position
  WHERE ministry IS NOT NULL
  ORDER BY RANDOM() LIMIT 5
`).all();

newMinistries.forEach((min, idx) => {
  const minCount = db.prepare(`
    SELECT COUNT(DISTINCT mk_id) as cnt FROM mk_position
    WHERE ministry = ?
  `).get(min.ministry);

  const billCount = db.prepare(`
    SELECT COUNT(DISTINCT b.id) as cnt FROM bill b
    JOIN bill_initiator bi ON bi.bill_id = b.id
    WHERE bi.mk_id IN (SELECT mk_id FROM mk_position WHERE ministry = ?)
  `).get(min.ministry);

  console.log(`${idx + 1}. /ministry/${encodeURIComponent(min.ministry)}`);
  console.log(`   ✓ Ministers: ${minCount.cnt}, Bills: ${billCount.cnt}`);
  console.log();
});

// Get 5 new AGENDA TOPICS
console.log('═══════════════════════════════════════════════════════════\n');
console.log('📋 5 New Random Agenda Topics\n');

const newAgendas = db.prepare(`
  SELECT DISTINCT macro_agenda FROM bill
  WHERE macro_agenda IS NOT NULL AND macro_agenda != ''
  ORDER BY RANDOM() LIMIT 5
`).all();

newAgendas.forEach((agenda, idx) => {
  const billCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM bill
    WHERE macro_agenda = ?
  `).get(agenda.macro_agenda);

  const passedCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM bill
    WHERE macro_agenda = ? AND is_passed = 1
  `).get(agenda.macro_agenda);

  console.log(`${idx + 1}. /agenda/${encodeURIComponent(agenda.macro_agenda)}`);
  console.log(`   ✓ Bills: ${billCount.cnt}, Passed: ${passedCount.cnt}`);
  console.log();
});

console.log('\n✅ Ready for browser verification on 30 new pages\n');

db.close();
