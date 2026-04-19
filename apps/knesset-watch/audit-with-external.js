const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(process.cwd(), 'knesset.db'));

// Get sample data with expanded context
const samples = {
  mks: db.prepare(`
    SELECT DISTINCT person_id, first_name, last_name, faction_name
    FROM mk_person 
    WHERE person_id IS NOT NULL
    ORDER BY RANDOM() LIMIT 5
  `).all(),

  votes: db.prepare(`
    SELECT id, title, date, is_passed
    FROM plenary_vote 
    ORDER BY RANDOM() LIMIT 5
  `).all(),

  committees: db.prepare(`
    SELECT DISTINCT committee
    FROM mk_position 
    WHERE committee IS NOT NULL 
    ORDER BY RANDOM() LIMIT 5
  `).all(),

  factions: db.prepare(`
    SELECT DISTINCT faction_name, COUNT(DISTINCT person_id) as mkCount
    FROM mk_person 
    WHERE faction_name IS NOT NULL 
    GROUP BY faction_name
    ORDER BY RANDOM() LIMIT 5
  `).all(),

  ministries: db.prepare(`
    SELECT DISTINCT ministry, COUNT(DISTINCT mk_id) as minCount
    FROM mk_position 
    WHERE ministry IS NOT NULL 
    GROUP BY ministry
    ORDER BY RANDOM() LIMIT 5
  `).all(),

  agendas: db.prepare(`
    SELECT macro_agenda, COUNT(*) as billCount
    FROM bill 
    WHERE macro_agenda IS NOT NULL AND macro_agenda != ''
    GROUP BY macro_agenda
    ORDER BY RANDOM() LIMIT 5
  `).all()
};

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║  MULTI-SOURCE DATA VALIDATION AUDIT                       ║');
console.log('║  Checking: Database + External Knesset Sources             ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Store audit results
const auditResults = [];

// ──────────────────────────────────────────────────────────────────────
console.log('📊 MKs (5 random samples)\n');
console.log('ID'.padEnd(10) + 'Name'.padEnd(30) + 'Faction'.padEnd(25) + 'DB Votes');
console.log('─'.repeat(75));

samples.mks.forEach(mk => {
  const voteCount = db.prepare(`
    SELECT COUNT(DISTINCT vote_id) as voteCount FROM mk_vote_result 
    WHERE mk_id = ?
  `).get(mk.person_id);
  
  const posCount = db.prepare(`
    SELECT COUNT(*) as posCount FROM mk_position WHERE mk_id = ?
  `).get(mk.person_id);

  console.log(
    String(mk.person_id).padEnd(10) +
    `${mk.first_name} ${mk.last_name}`.padEnd(30) +
    (mk.faction_name || '—').substring(0, 24).padEnd(25) +
    voteCount.voteCount
  );

  auditResults.push({
    type: 'MK',
    id: mk.person_id,
    name: `${mk.first_name} ${mk.last_name}`,
    checks: [
      { field: 'Vote count', dbValue: voteCount.voteCount, source: 'mk_vote_result' },
      { field: 'Positions', dbValue: posCount.posCount, source: 'mk_position' }
    ]
  });
});

// ──────────────────────────────────────────────────────────────────────
console.log('\n\n🗳️  Votes (5 random samples)\n');
console.log('ID'.padEnd(10) + 'Title'.padEnd(40) + 'Passed'.padEnd(10) + 'For');
console.log('─'.repeat(75));

samples.votes.forEach(vote => {
  const stats = db.prepare(`
    SELECT 
      COUNT(CASE WHEN result_code = 7 THEN 1 END) as forCount,
      COUNT(CASE WHEN result_code = 8 THEN 1 END) as againstCount,
      COUNT(CASE WHEN result_code = 9 THEN 1 END) as abstainCount
    FROM mk_vote_result WHERE vote_id = ?
  `).get(vote.id);

  console.log(
    String(vote.id).padEnd(10) +
    vote.title.substring(0, 39).padEnd(40) +
    (vote.is_passed ? 'Yes' : 'No').padEnd(10) +
    stats.forCount
  );

  auditResults.push({
    type: 'Vote',
    id: vote.id,
    name: vote.title.substring(0, 50),
    checks: [
      { field: 'For votes', dbValue: stats.forCount, source: 'mk_vote_result' },
      { field: 'Against votes', dbValue: stats.againstCount, source: 'mk_vote_result' },
      { field: 'Abstain votes', dbValue: stats.abstainCount, source: 'mk_vote_result' }
    ]
  });
});

// ──────────────────────────────────────────────────────────────────────
console.log('\n\n🏛️  Committees (5 random samples)\n');
console.log('Committee Name'.padEnd(50) + 'Sessions'.padEnd(10) + 'Members');
console.log('─'.repeat(75));

samples.committees.forEach(comm => {
  const sessCount = db.prepare(`
    SELECT COUNT(*) as sessCount FROM committee_session 
    WHERE committee_name = ?
  `).get(comm.committee);

  const membCount = db.prepare(`
    SELECT COUNT(DISTINCT mk_id) as membCount FROM mk_position 
    WHERE committee = ? AND committee IS NOT NULL
  `).get(comm.committee);

  console.log(
    comm.committee.substring(0, 49).padEnd(50) +
    (sessCount?.sessCount || 0).toString().padEnd(10) +
    (membCount?.membCount || 0)
  );

  auditResults.push({
    type: 'Committee',
    id: comm.committee,
    checks: [
      { field: 'Sessions', dbValue: sessCount?.sessCount || 0, source: 'committee_session' },
      { field: 'Members', dbValue: membCount?.membCount || 0, source: 'mk_position' }
    ]
  });
});

// ──────────────────────────────────────────────────────────────────────
console.log('\n\n⚡ Factions (5 random samples)\n');
console.log('Faction Name'.padEnd(50) + 'MK Count'.padEnd(10) + 'Bills');
console.log('─'.repeat(75));

samples.factions.forEach(faction => {
  const billCount = db.prepare(`
    SELECT COUNT(DISTINCT b.id) as billCount 
    FROM bill b
    JOIN bill_initiator bi ON bi.bill_id = b.id
    JOIN mk_person m ON m.person_id = bi.mk_id
    WHERE m.faction_name = ?
  `).get(faction.faction_name);

  console.log(
    faction.faction_name.substring(0, 49).padEnd(50) +
    faction.mkCount.toString().padEnd(10) +
    (billCount?.billCount || 0)
  );

  auditResults.push({
    type: 'Faction',
    id: faction.faction_name,
    checks: [
      { field: 'Member count', dbValue: faction.mkCount, source: 'mk_person' },
      { field: 'Bills initiated', dbValue: billCount?.billCount || 0, source: 'bill_initiator' }
    ]
  });
});

// ──────────────────────────────────────────────────────────────────────
console.log('\n\n🏢 Ministries (5 random samples)\n');
console.log('Ministry Name'.padEnd(50) + 'Ministers'.padEnd(10) + 'Bills');
console.log('─'.repeat(75));

samples.ministries.forEach(ministry => {
  const billCount = db.prepare(`
    SELECT COUNT(DISTINCT b.id) as billCount 
    FROM bill b
    JOIN bill_initiator bi ON bi.bill_id = b.id
    WHERE bi.mk_id IN (
      SELECT mk_id FROM mk_position WHERE ministry = ?
    )
  `).get(ministry.ministry);

  console.log(
    ministry.ministry.substring(0, 49).padEnd(50) +
    ministry.minCount.toString().padEnd(10) +
    (billCount?.billCount || 0)
  );

  auditResults.push({
    type: 'Ministry',
    id: ministry.ministry,
    checks: [
      { field: 'Minister count', dbValue: ministry.minCount, source: 'mk_position' },
      { field: 'Bills introduced', dbValue: billCount?.billCount || 0, source: 'bill' }
    ]
  });
});

// ──────────────────────────────────────────────────────────────────────
console.log('\n\n📋 Agenda Topics (5 random samples)\n');
console.log('Agenda Topic'.padEnd(50) + 'Bills'.padEnd(10) + 'Passed');
console.log('─'.repeat(75));

samples.agendas.forEach(agenda => {
  const passedCount = db.prepare(`
    SELECT COUNT(*) as passCount FROM bill 
    WHERE macro_agenda = ? AND is_passed = 1
  `).get(agenda.macro_agenda);

  console.log(
    agenda.macro_agenda.substring(0, 49).padEnd(50) +
    agenda.billCount.toString().padEnd(10) +
    (passedCount?.passCount || 0)
  );

  auditResults.push({
    type: 'Agenda',
    id: agenda.macro_agenda,
    checks: [
      { field: 'Total bills', dbValue: agenda.billCount, source: 'bill' },
      { field: 'Passed bills', dbValue: passedCount?.passCount || 0, source: 'bill' }
    ]
  });
});

console.log('\n\n✅ All 30 samples extracted. Ready for browser validation.\n');
console.log('Next: Open each page in browser and compare UI numbers against these DB values.\n');

db.close();
