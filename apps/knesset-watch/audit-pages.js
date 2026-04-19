const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(process.cwd(), 'knesset.db'));

// Get the 5 sample MKs
const mks = db.prepare(`
  SELECT DISTINCT person_id, first_name, last_name, faction_name
  FROM mk_person 
  WHERE person_id IS NOT NULL
  ORDER BY RANDOM() LIMIT 5
`).all();

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║  PAGE DATA VALIDATION — Expected DB Values               ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// MK audit data
console.log('📋 MK PROFILE PAGES — 5 Samples\n');
console.log('Expected values to see on each MK profile page:\n');

mks.forEach((mk, idx) => {
  const voteStats = db.prepare(`
    SELECT 
      COUNT(DISTINCT vote_id) as voteCount,
      SUM(CASE WHEN result_code = 7 THEN 1 ELSE 0 END) as forCount,
      SUM(CASE WHEN result_code = 8 THEN 1 ELSE 0 END) as againstCount,
      SUM(CASE WHEN result_code = 9 THEN 1 ELSE 0 END) as abstainCount
    FROM mk_vote_result 
    WHERE mk_id = ?
  `).get(mk.person_id);

  const absenceStats = db.prepare(`
    SELECT 
      COUNT(*) as totalVotes,
      COUNT(DISTINCT v.id) as voteCount
    FROM plenary_vote v
    WHERE date >= (SELECT COALESCE(MIN(start_date), '2022-11-15') FROM mk_position WHERE mk_id = ?)
      AND date <= (SELECT COALESCE(MAX(finish_date), '2025-12-31') FROM mk_position WHERE mk_id = ?)
  `).get(mk.person_id, mk.person_id);

  const tenure = db.prepare(`
    SELECT 
      MIN(start_date) as startDate,
      MAX(finish_date) as endDate
    FROM mk_position WHERE mk_id = ?
  `).get(mk.person_id);

  const queryCount = db.prepare(`
    SELECT COUNT(*) as queryCount FROM mk_query WHERE mk_id = ?
  `).get(mk.person_id);

  const billCount = db.prepare(`
    SELECT COUNT(DISTINCT bill_id) as billCount FROM bill_initiator WHERE mk_id = ?
  `).get(mk.person_id);

  const posCount = db.prepare(`
    SELECT COUNT(DISTINCT id) as posCount FROM mk_position WHERE mk_id = ?
  `).get(mk.person_id);

  console.log(`${idx + 1}. /mk/${mk.person_id} — ${mk.first_name} ${mk.last_name}`);
  console.log(`   Faction: ${mk.faction_name || '—'}`);
  console.log(`   Total Votes: ${voteStats.voteCount} (For: ${voteStats.forCount}, Against: ${voteStats.againstCount}, Abstain: ${voteStats.abstainCount})`);
  console.log(`   Tenure: ${tenure.startDate?.substring(0, 10) || '—'} to ${tenure.endDate?.substring(0, 10) || 'ongoing'}`);
  console.log(`   Absence Count: ${Math.max(0, absenceStats.totalVotes - voteStats.voteCount)}`);
  console.log(`   Queries: ${queryCount.queryCount}`);
  console.log(`   Bills: ${billCount.billCount}`);
  console.log(`   Positions: ${posCount.posCount}`);
  console.log();
});

// VOTES audit data
console.log('\n🗳️  VOTE DETAIL PAGES — 5 Samples\n');
console.log('Expected values to see on each vote page:\n');

const votes = db.prepare(`
  SELECT id, title, date, is_passed
  FROM plenary_vote 
  ORDER BY RANDOM() LIMIT 5
`).all();

votes.forEach((vote, idx) => {
  const stats = db.prepare(`
    SELECT 
      SUM(CASE WHEN result_code = 7 THEN 1 ELSE 0 END) as forCount,
      SUM(CASE WHEN result_code = 8 THEN 1 ELSE 0 END) as againstCount,
      SUM(CASE WHEN result_code = 9 THEN 1 ELSE 0 END) as abstainCount
    FROM mk_vote_result WHERE vote_id = ?
  `).get(vote.id);

  console.log(`${idx + 1}. /vote/${vote.id}`);
  console.log(`   Title: "${vote.title.substring(0, 60)}"`);
  console.log(`   Date: ${vote.date?.substring(0, 10) || '—'}`);
  console.log(`   Passed: ${vote.is_passed ? 'Yes' : 'No'}`);
  console.log(`   For: ${stats.forCount}, Against: ${stats.againstCount}, Abstain: ${stats.abstainCount}`);
  console.log();
});

// COMMITTEES audit data
console.log('\n🏛️  COMMITTEE DETAIL PAGES — 5 Samples\n');

const committees = db.prepare(`
  SELECT DISTINCT committee
  FROM mk_position 
  WHERE committee IS NOT NULL 
  ORDER BY RANDOM() LIMIT 5
`).all();

committees.forEach((comm, idx) => {
  const sessCount = db.prepare(`
    SELECT COUNT(*) as sessCount FROM committee_session 
    WHERE committee_name = ?
  `).get(comm.committee);

  const membCount = db.prepare(`
    SELECT COUNT(DISTINCT mk_id) as membCount FROM mk_position 
    WHERE committee = ? AND committee IS NOT NULL
  `).get(comm.committee);

  console.log(`${idx + 1}. /committee/${encodeURIComponent(comm.committee)}`);
  console.log(`   Name: ${comm.committee.substring(0, 50)}`);
  console.log(`   Sessions: ${sessCount?.sessCount || 0}`);
  console.log(`   Members: ${membCount?.membCount || 0}`);
  console.log();
});

// FACTIONS audit data
console.log('\n⚡ FACTION DETAIL PAGES — 5 Samples\n');

const factions = db.prepare(`
  SELECT DISTINCT faction_name, COUNT(DISTINCT person_id) as mkCount
  FROM mk_person 
  WHERE faction_name IS NOT NULL 
  GROUP BY faction_name
  ORDER BY RANDOM() LIMIT 5
`).all();

factions.forEach((faction, idx) => {
  const billCount = db.prepare(`
    SELECT COUNT(DISTINCT b.id) as billCount 
    FROM bill b
    JOIN bill_initiator bi ON bi.bill_id = b.id
    JOIN mk_person m ON m.person_id = bi.mk_id
    WHERE m.faction_name = ?
  `).get(faction.faction_name);

  const passedCount = db.prepare(`
    SELECT COUNT(DISTINCT b.id) as passedCount 
    FROM bill b
    JOIN bill_initiator bi ON bi.bill_id = b.id
    JOIN mk_person m ON m.person_id = bi.mk_id
    WHERE m.faction_name = ? AND b.is_passed = 1
  `).get(faction.faction_name);

  console.log(`${idx + 1}. /faction/${encodeURIComponent(faction.faction_name)}`);
  console.log(`   Name: ${faction.faction_name}`);
  console.log(`   Members: ${faction.mkCount}`);
  console.log(`   Bills: ${billCount?.billCount || 0} (Passed: ${passedCount?.passedCount || 0})`);
  console.log();
});

// MINISTRIES audit data
console.log('\n🏢 MINISTRY DETAIL PAGES — 5 Samples\n');

const ministries = db.prepare(`
  SELECT DISTINCT ministry, COUNT(DISTINCT mk_id) as minCount
  FROM mk_position 
  WHERE ministry IS NOT NULL 
  GROUP BY ministry
  ORDER BY RANDOM() LIMIT 5
`).all();

ministries.forEach((ministry, idx) => {
  const billCount = db.prepare(`
    SELECT COUNT(DISTINCT b.id) as billCount 
    FROM bill b
    JOIN bill_initiator bi ON bi.bill_id = b.id
    WHERE bi.mk_id IN (
      SELECT mk_id FROM mk_position WHERE ministry = ?
    )
  `).get(ministry.ministry);

  const passedCount = db.prepare(`
    SELECT COUNT(DISTINCT b.id) as passedCount 
    FROM bill b
    JOIN bill_initiator bi ON bi.bill_id = b.id
    WHERE bi.mk_id IN (
      SELECT mk_id FROM mk_position WHERE ministry = ?
    ) AND b.is_passed = 1
  `).get(ministry.ministry);

  console.log(`${idx + 1}. /ministry/${encodeURIComponent(ministry.ministry)}`);
  console.log(`   Name: ${ministry.ministry.substring(0, 45)}`);
  console.log(`   Ministers: ${ministry.minCount}`);
  console.log(`   Bills: ${billCount?.billCount || 0} (Passed: ${passedCount?.passedCount || 0})`);
  console.log();
});

// AGENDA audit data
console.log('\n📋 AGENDA TOPIC PAGES — 5 Samples\n');

const agendas = db.prepare(`
  SELECT macro_agenda, COUNT(*) as billCount
  FROM bill 
  WHERE macro_agenda IS NOT NULL AND macro_agenda != ''
  GROUP BY macro_agenda
  ORDER BY RANDOM() LIMIT 5
`).all();

agendas.forEach((agenda, idx) => {
  const passedCount = db.prepare(`
    SELECT COUNT(*) as passCount FROM bill 
    WHERE macro_agenda = ? AND is_passed = 1
  `).get(agenda.macro_agenda);

  console.log(`${idx + 1}. /agenda/${encodeURIComponent(agenda.macro_agenda)}`);
  console.log(`   Topic: ${agenda.macro_agenda}`);
  console.log(`   Bills: ${agenda.billCount} (Passed: ${passedCount?.passCount || 0})`);
  console.log();
});

console.log('\n✅ Expected values documented. Now validate each page against these values.\n');

db.close();
