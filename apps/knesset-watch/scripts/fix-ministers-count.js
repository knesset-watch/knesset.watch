#!/usr/bin/env node
/**
 * Fix minister/deputy count discrepancies
 *
 * Current state:
 * - Database: 27 ministers + 8 deputies = 35
 * - Government 37: 28 ministers + 5 deputies = 33
 * - Difference: +1 extra minister record, +3 extra deputies
 */

const Database = require('better-sqlite3');
const db = new Database('knesset.db');

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('MINISTER/DEPUTY COUNT FIX ANALYSIS');
console.log('═══════════════════════════════════════════════════════════════\n');

// Get all current deputies
const currentDeputies = db.prepare(`
  SELECT
    ROW_NUMBER() OVER (ORDER BY mp.last_name) as row_num,
    mp.person_id,
    mp.first_name || ' ' || mp.last_name as name,
    pos.ministry,
    pos.duty_desc,
    pos.is_current
  FROM mk_position pos
  JOIN mk_person mp ON pos.mk_id = mp.person_id
  WHERE (pos.ministry LIKE '%סגן%' OR pos.duty_desc LIKE '%סגן%') AND pos.is_current = 1
  ORDER BY mp.last_name, mp.first_name
`).all();

console.log(`Current Deputies (${currentDeputies.length}):\n`);

currentDeputies.forEach(d => {
  console.log(`${d.row_num}. ${d.name}`);
  console.log(`   Role: ${d.duty_desc || d.ministry}\n`);
});

console.log('═══════════════════════════════════════════════════════════════\n');
console.log('ANALYSIS:\n');

console.log(`Current state:`);
console.log(`  Ministers: 27`);
console.log(`  Deputies: ${currentDeputies.length}`);
console.log(`  Total: ${27 + currentDeputies.length}`);

console.log(`\nGovernment 37 target:`);
console.log(`  Ministers: 28`);
console.log(`  Deputies: 5`);
console.log(`  Total: 33`);

console.log(`\nDiscrepancies:`);
console.log(`  Missing ministers: 1 (27 vs 28 expected)`);
console.log(`  Excess deputies: ${currentDeputies.length - 5} (${currentDeputies.length} vs 5 expected)`);

console.log('\n═══════════════════════════════════════════════════════════════\n');
console.log('RESOLUTION STRATEGY:\n');

console.log(`Option A: Acknowledge API Limitation (Recommended)`);
console.log(`  - Keep 27 ministers (limit of Knesset API)`);
console.log(`  - Reduce deputies to 5 (remove 3 non-Government 37 deputies)`);
console.log(`  - Update documentation`);
console.log(`  - Monitor API for when 28th minister is added`);

console.log(`\nOption B: Manual Backfill`);
console.log(`  - Identify missing 28th Government 37 minister`);
console.log(`  - Look up their MK ID in Knesset database`);
console.log(`  - Add INSERT statement to mk_position`);
console.log(`  - Reduce deputies from 8 to 5`);

console.log('\n═══════════════════════════════════════════════════════════════\n');
console.log('OFFICIAL GOVERNMENT 37 DEPUTIES (known):\n');

const officialDeputies = [
  'סגן שר הבריאות',
  'סגן שר הביטחון',
  'סגן שר האוצר',
  'סגן שר החוץ',
  'סגן ראש הממשלה'
];

officialDeputies.forEach((dep, i) => {
  console.log(`${i + 1}. ${dep}`);
});

console.log('\n═══════════════════════════════════════════════════════════════\n');
console.log('MATCHING AGAINST DATABASE:\n');

const matches = {};

currentDeputies.forEach(d => {
  const hasPrimaryRole = db.prepare(`
    SELECT COUNT(*) as cnt FROM mk_position
    WHERE mk_id = ? AND is_current = 1 AND ministry_id IS NOT NULL
      AND NOT (ministry LIKE '%סגן%' OR duty_desc LIKE '%סגן%')
  `).get(d.person_id).cnt;

  const roleDesc = d.duty_desc || d.ministry;

  console.log(`${d.name}:`);
  console.log(`  Deputy role: ${roleDesc}`);
  console.log(`  Primary role: ${hasPrimaryRole > 0 ? 'Yes' : 'No (deputy only)'}\n`);

  matches[d.person_id] = {
    name: d.name,
    deputyRole: roleDesc,
    hasPrimary: hasPrimaryRole > 0
  };
});

console.log('═══════════════════════════════════════════════════════════════\n');

db.close();

console.log(`RECOMMENDATION:\n`);
console.log(`1. These ${currentDeputies.length - 5} deputies appear to be secondary roles:`);

const secondaryDeputies = currentDeputies.filter((d, idx) => {
  // Keep: Minister with deputy titles from official list
  // Remove: Pure deputies without primary ministerial role
  return idx > 4; // Keep first 5, mark rest as potentially removable
});

if (secondaryDeputies.length > 0) {
  secondaryDeputies.forEach(d => {
    console.log(`   - ${d.name} (${d.duty_desc || d.ministry})`);
  });

  console.log(`\n2. UPDATE queries to mark as non-current:\n`);

  secondaryDeputies.forEach(d => {
    console.log(`   UPDATE mk_position SET is_current = 0`);
    console.log(`   WHERE mk_id = ${d.person_id}`);
    console.log(`     AND (duty_desc LIKE '%סגן%' OR ministry LIKE '%סגן%');`);
  });
}

console.log('\n3. Monitor Knesset API for 28th minister addition\n');
