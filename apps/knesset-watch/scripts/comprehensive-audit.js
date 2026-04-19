#!/usr/bin/env node
/**
 * COMPREHENSIVE DATA AUDIT SCRIPT
 * Validates 30 random pages (5 from each of 6 types) against database
 * Expected: MK, Vote, Committee, Faction, Ministry, Agenda pages
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const db = new Database('knesset.db');

const AUDIT_LOG = [];
let PASS_COUNT = 0;
let FAIL_COUNT = 0;

function log(msg) {
  console.log(msg);
  AUDIT_LOG.push(msg);
}

function pass(msg) {
  PASS_COUNT++;
  log(`✓ ${msg}`);
}

function fail(msg) {
  FAIL_COUNT++;
  log(`✗ ${msg}`);
}

// ──────────────────────────────────────────────────────────────────────────
// MK PROFILE AUDIT
// ──────────────────────────────────────────────────────────────────────────

log('\n═══════════════════════════════════════════════════════════════');
log('MK PROFILE PAGES (5 random samples)');
log('═══════════════════════════════════════════════════════════════\n');

const mkSamples = db.prepare(
  'SELECT DISTINCT mk_id FROM mk_vote_result ORDER BY RANDOM() LIMIT 5'
).all();

mkSamples.forEach((mkRow, idx) => {
  const mkId = mkRow.mk_id;

  // Get MK name
  const mkPerson = db.prepare(
    'SELECT first_name, last_name FROM mk_person WHERE person_id = ?'
  ).get(mkId);

  const name = mkPerson ? `${mkPerson.first_name} ${mkPerson.last_name}` : 'Unknown';

  // Calculate expected values
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

  const absence = Math.max(0, totalVotesInWindow - mkVotes);

  log(`\n[${idx + 1}/5] MK ID ${mkId} — ${name}`);
  log(`  Expected: Bills=${bills}, Queries=${queries}, Positions=${positions}, Votes=${mkVotes}, Absence=${absence}`);
  log(`  Page URL: /mk/${mkId}`);
  log(`  TEST STATUS: ⏳ Requires Playwright (will validate in browser)`);

  AUDIT_LOG.push(JSON.stringify({
    type: 'mk',
    mkId,
    name,
    expected: { bills, queries, positions, votes: mkVotes, absence },
    url: `/mk/${mkId}`
  }));
});

// ──────────────────────────────────────────────────────────────────────────
// VOTE PAGES AUDIT
// ──────────────────────────────────────────────────────────────────────────

log('\n═══════════════════════════════════════════════════════════════');
log('VOTE DETAIL PAGES (5 random samples)');
log('═══════════════════════════════════════════════════════════════\n');

const voteSamples = db.prepare(
  'SELECT id FROM plenary_vote ORDER BY RANDOM() LIMIT 5'
).all();

voteSamples.forEach((voteRow, idx) => {
  const voteId = voteRow.id;

  const forCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM mk_vote_result WHERE vote_id = ? AND result_code = 7'
  ).get(voteId).cnt;

  const againstCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM mk_vote_result WHERE vote_id = ? AND result_code = 8'
  ).get(voteId).cnt;

  const abstainCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM mk_vote_result WHERE vote_id = ? AND result_code = 9'
  ).get(voteId).cnt;

  const presentCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM mk_vote_result WHERE vote_id = ? AND result_code = 6'
  ).get(voteId).cnt;

  const voteTitle = db.prepare(
    'SELECT title FROM plenary_vote WHERE id = ?'
  ).get(voteId).title;

  log(`\n[${idx + 1}/5] Vote ID ${voteId}`);
  log(`  Title: ${voteTitle}`);
  log(`  Expected: For=${forCount}, Against=${againstCount}, Abstain=${abstainCount}, Present=${presentCount}`);
  log(`  Page URL: /vote/${voteId}`);
  log(`  TEST STATUS: ⏳ Requires Playwright (will validate in browser)`);

  AUDIT_LOG.push(JSON.stringify({
    type: 'vote',
    voteId,
    voteTitle,
    expected: { for: forCount, against: againstCount, abstain: abstainCount, present: presentCount },
    url: `/vote/${voteId}`
  }));
});

// ──────────────────────────────────────────────────────────────────────────
// COMMITTEE PAGES AUDIT
// ──────────────────────────────────────────────────────────────────────────

log('\n═══════════════════════════════════════════════════════════════');
log('COMMITTEE PAGES (5 random samples)');
log('═══════════════════════════════════════════════════════════════\n');

const committeeSamples = db.prepare(
  'SELECT DISTINCT committee FROM mk_position WHERE committee IS NOT NULL ORDER BY RANDOM() LIMIT 5'
).all();

committeeSamples.forEach((committeeRow, idx) => {
  const committeeName = committeeRow.committee;

  const members = db.prepare(
    'SELECT COUNT(DISTINCT mk_id) as cnt FROM mk_position WHERE committee = ?'
  ).get(committeeName).cnt;

  const sessions = db.prepare(
    'SELECT COUNT(*) as cnt FROM committee_session WHERE committee_name = ?'
  ).get(committeeName).cnt || 0;

  const committeeUrl = encodeURIComponent(committeeName);

  log(`\n[${idx + 1}/5] Committee: ${committeeName}`);
  log(`  Expected: Members=${members}, Sessions=${sessions}`);
  log(`  Page URL: /committee/${committeeUrl}`);
  log(`  TEST STATUS: ⏳ Requires Playwright (will validate in browser)`);

  AUDIT_LOG.push(JSON.stringify({
    type: 'committee',
    name: committeeName,
    expected: { members, sessions },
    url: `/committee/${committeeUrl}`
  }));
});

// ──────────────────────────────────────────────────────────────────────────
// FACTION PAGES AUDIT
// ──────────────────────────────────────────────────────────────────────────

log('\n═══════════════════════════════════════════════════════════════');
log('FACTION PAGES (5 random samples)');
log('═══════════════════════════════════════════════════════════════\n');

const factionSamples = db.prepare(
  'SELECT DISTINCT faction_name FROM mk_person WHERE faction_name IS NOT NULL ORDER BY RANDOM() LIMIT 5'
).all();

factionSamples.forEach((factionRow, idx) => {
  const factionName = factionRow.faction_name;

  const mkCount = db.prepare(
    'SELECT COUNT(DISTINCT person_id) as cnt FROM mk_person WHERE faction_name = ?'
  ).get(factionName).cnt;

  const bills = db.prepare(
    `SELECT COUNT(DISTINCT b.id) as cnt FROM bill b
     JOIN bill_initiator i ON i.bill_id = b.id
     JOIN mk_person p ON p.person_id = i.mk_id
     WHERE p.faction_name = ?`
  ).get(factionName).cnt;

  const factionUrl = encodeURIComponent(factionName);

  log(`\n[${idx + 1}/5] Faction: ${factionName}`);
  log(`  Expected: MKs=${mkCount}, Bills=${bills}`);
  log(`  Page URL: /faction/${factionUrl}`);
  log(`  TEST STATUS: ⏳ Requires Playwright (will validate in browser)`);

  AUDIT_LOG.push(JSON.stringify({
    type: 'faction',
    name: factionName,
    expected: { mks: mkCount, bills },
    url: `/faction/${factionUrl}`
  }));
});

// ──────────────────────────────────────────────────────────────────────────
// MINISTRY PAGES AUDIT
// ──────────────────────────────────────────────────────────────────────────

log('\n═══════════════════════════════════════════════════════════════');
log('MINISTRY PAGES (5 random samples)');
log('═══════════════════════════════════════════════════════════════\n');

const ministrySamples = db.prepare(
  'SELECT DISTINCT ministry FROM mk_position WHERE ministry IS NOT NULL ORDER BY RANDOM() LIMIT 5'
).all();

ministrySamples.forEach((ministryRow, idx) => {
  const ministryName = ministryRow.ministry;

  const bills = db.prepare(
    `SELECT COUNT(DISTINCT b.id) as cnt FROM bill b
     JOIN bill_initiator i ON i.bill_id = b.id
     JOIN mk_position mp ON mp.mk_id = i.mk_id
     WHERE mp.ministry = ?`
  ).get(ministryName).cnt;

  const ministryUrl = encodeURIComponent(ministryName);

  log(`\n[${idx + 1}/5] Ministry: ${ministryName}`);
  log(`  Expected: Bills=${bills}`);
  log(`  Page URL: /ministry/${ministryUrl}`);
  log(`  TEST STATUS: ⏳ Requires Playwright (will validate in browser)`);

  AUDIT_LOG.push(JSON.stringify({
    type: 'ministry',
    name: ministryName,
    expected: { bills },
    url: `/ministry/${ministryUrl}`
  }));
});

// ──────────────────────────────────────────────────────────────────────────
// AGENDA PAGES AUDIT
// ──────────────────────────────────────────────────────────────────────────

log('\n═══════════════════════════════════════════════════════════════');
log('AGENDA TOPIC PAGES (5 random samples)');
log('═══════════════════════════════════════════════════════════════\n');

const agendaSamples = db.prepare(
  'SELECT DISTINCT macro_agenda FROM bill WHERE macro_agenda IS NOT NULL ORDER BY RANDOM() LIMIT 5'
).all();

agendaSamples.forEach((agendaRow, idx) => {
  const agenda = agendaRow.macro_agenda;

  const bills = db.prepare(
    'SELECT COUNT(*) as cnt FROM bill WHERE macro_agenda = ?'
  ).get(agenda).cnt;

  const passed = db.prepare(
    'SELECT COUNT(*) as cnt FROM bill WHERE macro_agenda = ? AND is_passed = 1'
  ).get(agenda).cnt;

  const agendaUrl = encodeURIComponent(agenda);

  log(`\n[${idx + 1}/5] Agenda: ${agenda}`);
  log(`  Expected: Bills=${bills}, Passed=${passed}`);
  log(`  Page URL: /agenda/${agendaUrl}`);
  log(`  TEST STATUS: ⏳ Requires Playwright (will validate in browser)`);

  AUDIT_LOG.push(JSON.stringify({
    type: 'agenda',
    name: agenda,
    expected: { bills, passed },
    url: `/agenda/${agendaUrl}`
  }));
});

// ──────────────────────────────────────────────────────────────────────────
// SPECIAL AUDIT: MINISTERS PAGE
// ──────────────────────────────────────────────────────────────────────────

log('\n═══════════════════════════════════════════════════════════════');
log('SPECIAL AUDIT: MINISTERS PAGE');
log('═══════════════════════════════════════════════════════════════\n');

const activeMinsters = db.prepare(
  `SELECT COUNT(DISTINCT mk_id) as cnt FROM mk_position
   WHERE ministry_id IS NOT NULL AND is_current = 1`
).get().cnt;

log(`Database: ${activeMinsters} active ministers (is_current=1, ministry_id IS NOT NULL)`);
log(`Knesset Baseline: 33 ministers + 5 deputy ministers = 38 total (as of Dec 2022)`);
log(`⚠️  GAP: ${38 - activeMinsters} missing ministers (${Math.round((activeMinsters/38)*100)}% complete)`);
log(`\nPage URL: /ministers`);
log(`TEST STATUS: ⏳ Requires investigation + Playwright`);

AUDIT_LOG.push(JSON.stringify({
  type: 'ministers_special',
  expected: { active: activeMinsters, baseline: 38 },
  url: '/ministers'
}));

// ──────────────────────────────────────────────────────────────────────────
// SUMMARY
// ──────────────────────────────────────────────────────────────────────────

log('\n═══════════════════════════════════════════════════════════════');
log('AUDIT SUMMARY');
log('═══════════════════════════════════════════════════════════════\n');

log(`Total Audit Subjects: 31 (30 pages + 1 special audit)`);
log(`Expected Values Generated: ✓ All ${AUDIT_LOG.length - 2} subjects`);
log(`Status: Ready for Playwright validation phase\n`);
log(`Next Step: Run audit-browser.js to visit each page and compare UI values\n`);

// Save audit data for use by browser script
fs.writeFileSync(
  'scripts/audit-expected-values.json',
  JSON.stringify(AUDIT_LOG.filter(l => l.startsWith('{')), null, 2)
);

log('✓ Expected values saved to scripts/audit-expected-values.json\n');

db.close();
