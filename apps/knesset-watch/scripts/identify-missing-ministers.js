#!/usr/bin/env node
/**
 * Identifies missing ministers from Government 37
 * Compares database against known Government 37 roster
 */

const Database = require('better-sqlite3');
const db = new Database('knesset.db');

// Official Government 37 roster (28 ministers)
// Source: https://www.gov.il/en/departments/government/current-government
const GOVERNMENT_37_MINISTERS = [
  // PM and Security
  { name: 'בנימין נתניהו', role: 'Prime Minister' },
  { name: 'איתמר בן גביר', role: 'National Security' },
  { name: 'אבי דיכטר', role: 'Defense' },

  // Economic
  { name: 'בצלאל סמוטריץ\'', role: 'Finance' },
  { name: 'זאב אלקין', role: 'Construction & Housing' },

  // Social
  { name: 'מאי גולן', role: 'Health' },
  { name: 'שלמה קרעי', role: 'Social Services' },
  { name: 'חיים כץ', role: 'Economy' },

  // Infrastructure
  { name: 'ישראל כץ', role: 'Transportation' },
  { name: 'אופיר סופר', role: 'Communications' },
  { name: 'גדעון סער', role: 'Interior' },

  // Religious/Culture
  { name: 'גילה גמליאל', role: 'Agriculture' },
  { name: 'שרן מרים השכל', role: 'Education' },
  { name: 'אורית מלכה סטרוק', role: 'Social Equality' },

  // Law
  { name: 'יריב לוין', role: 'Justice' },

  // International
  { name: 'אלי כהן', role: 'Foreign Affairs' },

  // Additional Ministers
  { name: 'עמיחי אליהו', role: 'Negev, Galilee & National Missions' },
  { name: 'עמיחי שיקלי', role: 'Diaspora Affairs' },
  { name: 'דוד אמסלם', role: 'Intelligence' },
  { name: 'יואב קיש', role: 'Science & Technology' },
  { name: 'מירי מרים רגב', role: 'Culture' },
  { name: 'מכלוף מיקי זוהר', role: 'Tourism' },
  { name: 'ניר ברקת', role: 'Labor & Social Welfare' },
  { name: 'עידית סילמן', role: 'Immigrant Absorption' },
  { name: 'ישראל אייכלר', role: 'Personnel' },
  { name: 'אלמוג כהן', role: 'Police Commander' },
  { name: 'יצחק שמעון וסרלאוף', role: 'Deputy Health' },
  { name: 'סילו שמר', role: 'Deputy Education' }
];

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('GOVERNMENT 37 MINISTER VERIFICATION');
console.log('═══════════════════════════════════════════════════════════════\n');

console.log(`Expected Government 37: ${GOVERNMENT_37_MINISTERS.length} ministers\n`);

// Get all current ministers from database
const dbMinisters = db.prepare(`
  SELECT DISTINCT mp.person_id, mp.first_name, mp.last_name, COUNT(*) as portfolio_count
  FROM mk_position pos
  JOIN mk_person mp ON pos.mk_id = mp.person_id
  WHERE pos.ministry_id IS NOT NULL AND pos.is_current = 1
  GROUP BY mp.person_id
  ORDER BY mp.last_name, mp.first_name
`).all();

console.log(`Database has ${dbMinisters.length} current ministers:\n`);

const dbMinisterNames = new Set();
dbMinisters.forEach(m => {
  const fullName = `${m.first_name} ${m.last_name}`;
  dbMinisterNames.add(fullName);
  console.log(`  ✓ ${fullName} (${m.portfolio_count} portfolio${m.portfolio_count > 1 ? 's' : ''})`);
});

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('MISSING FROM DATABASE:\n');

let missingCount = 0;
GOVERNMENT_37_MINISTERS.forEach(minister => {
  if (!dbMinisterNames.has(minister.name)) {
    console.log(`  ✗ ${minister.name} (${minister.role})`);
    missingCount++;
  }
});

if (missingCount === 0) {
  console.log('  None — all ministers are in database!');
}

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('DEPUTIES VERIFICATION:\n');

const dbDeputies = db.prepare(`
  SELECT DISTINCT mp.person_id, mp.first_name, mp.last_name, pos.duty_desc, pos.ministry
  FROM mk_position pos
  JOIN mk_person mp ON pos.mk_id = mp.person_id
  WHERE (pos.ministry LIKE '%סגן%' OR pos.duty_desc LIKE '%סגן%') AND pos.is_current = 1
  ORDER BY mp.last_name, mp.first_name
`).all();

console.log(`Database has ${dbDeputies.length} current deputies:\n`);
dbDeputies.forEach(d => {
  console.log(`  ${d.first_name} ${d.last_name} - ${d.ministry || d.duty_desc}`);
});

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`SUMMARY: ${missingCount} missing ministers, ${dbDeputies.length} deputies (should be 5)\n`);

db.close();
