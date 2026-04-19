const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(process.cwd(), 'knesset.db'));

console.log('SAMPLE DATA FOR AUDIT\n');

// MKs - 5 random
console.log('=== 5 Random MKs ===');
const mks = db.prepare(`
  SELECT DISTINCT person_id, first_name, last_name 
  FROM mk_person 
  ORDER BY RANDOM() LIMIT 5
`).all();
mks.forEach(mk => {
  console.log(`/mk/${mk.person_id} — ${mk.first_name} ${mk.last_name}`);
});

// Votes - 5 random
console.log('\n=== 5 Random Votes ===');
const votes = db.prepare(`
  SELECT id, title FROM plenary_vote 
  ORDER BY RANDOM() LIMIT 5
`).all();
votes.forEach(v => {
  console.log(`/vote/${v.id} — "${v.title.substring(0, 60)}"`);
});

// Committees - 5 random (from mk_position)
console.log('\n=== 5 Random Committees ===');
const comms = db.prepare(`
  SELECT DISTINCT committee FROM mk_position 
  WHERE committee IS NOT NULL 
  ORDER BY RANDOM() LIMIT 5
`).all();
comms.forEach(c => {
  console.log(`/committee/${encodeURIComponent(c.committee)}`);
});

// Factions - 5 random (from mk_person)
console.log('\n=== 5 Random Factions ===');
const factions = db.prepare(`
  SELECT DISTINCT faction_name FROM mk_person 
  WHERE faction_name IS NOT NULL 
  ORDER BY RANDOM() LIMIT 5
`).all();
factions.forEach(f => {
  console.log(`/faction/${encodeURIComponent(f.faction_name)}`);
});

// Ministries - 5 random (from mk_position)
console.log('\n=== 5 Random Ministries ===');
const ministries = db.prepare(`
  SELECT DISTINCT ministry FROM mk_position 
  WHERE ministry IS NOT NULL 
  ORDER BY RANDOM() LIMIT 5
`).all();
ministries.forEach(m => {
  console.log(`/ministry/${encodeURIComponent(m.ministry)}`);
});

// Agenda topics - 5 random (from bill)
console.log('\n=== 5 Random Agenda Topics ===');
const agendas = db.prepare(`
  SELECT DISTINCT macro_agenda FROM bill 
  WHERE macro_agenda IS NOT NULL AND macro_agenda != '' 
  ORDER BY RANDOM() LIMIT 5
`).all();
agendas.forEach(a => {
  console.log(`/agenda/${encodeURIComponent(a.macro_agenda)}`);
});

db.close();
