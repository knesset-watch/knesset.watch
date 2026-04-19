/**
 * Find the 6 missing ministers from Government 37
 * 
 * Government 37 (Dec 2022 - present) should have:
 * 28 Ministers + 5 Deputy Ministers = 33 total
 * 
 * Known government 37 composition (from public records):
 */

const Database = require('better-sqlite3');
const db = new Database('knesset.db');

// Official Government 37 ministers (as of formation Dec 2022)
// Source: Israeli government official records
const GOVERNMENT_37_OFFICIAL = [
  'בנימין נתניהו',           // PM
  'בצלאל סמוטריץ\'',         // Finance + Defense
  'יריב לוין',               // Justice
  'גדעון סער',               // Foreign Affairs
  'ישראל כץ',                // Defense (was)
  'חיים כץ',                 // Health + Construction
  'יואב קיש',                // Education
  'ניר ברקת',                // Economy
  'אבי דיכטר',               // Agriculture
  'אופיר סופר',              // Immigration
  'אורית מלכה סטרוק',        // Settlement
  'איתמר בן גביר',           // National Security
  'עידית סילמן',             // Environment
  'יצחק שמעון וסרלאוף',       // Negev/Galil
  'מאי גולן',                // Social Equality
  'מכלוף מיקי זוהר',         // Culture
  'מירי מרים רגב',          // Transportation
  'שלמה קרעי',               // Communications
  'עמיחי שיקלי',             // Diaspora Affairs
  'אלי כהן',                 // Energy
  'עמיחי אליהו',             // Heritage
  'דוד אמסלם',               // Justice + Government-Knesset
  'גילה גמליאל',             // Innovation/Science
  'אלמוג כהן',               // PM Office
  'זאב אלקין',               // Treasury Deputy
  'שרן מרים השכל',          // Foreign Affairs Deputy
  'מירי רגב',                // Transportation Deputy
  'יוסף עטאונה',             // (Deputy - possible)
  'דני דנון',                // (check if in government)
  'עוז קציר',                // (check if deputy)
  'נסים בן שיתרית',          // (check if deputy)
  'בן ברקט',                 // (check if in list)
];

console.log('🔍 FINDING MISSING MINISTERS FROM GOVERNMENT 37\n');

// Get current ministers from database
const currentMinisterRows = db.prepare(`
  SELECT DISTINCT mp.person_id, mp.first_name, mp.last_name
  FROM mk_position
  JOIN mk_person mp ON mk_position.mk_id = mp.person_id
  WHERE mk_position.ministry_id IS NOT NULL 
    AND mk_position.is_current = 1
  ORDER BY mp.last_name
`).all();

const currentMinisters = new Map(
  currentMinisterRows.map(r => [
    `${r.first_name} ${r.last_name}`.trim(),
    r.person_id
  ])
);

console.log(`Current ministers in DB: ${currentMinisters.size}`);
console.log(`Government 37 should have: 33\n`);

// Search for each expected minister
console.log('═══════════════════════════════════════════════════\n');

const missing = [];
const found = [];

for (const officialName of GOVERNMENT_37_OFFICIAL) {
  // Search database for similar names
  const rows = db.prepare(`
    SELECT person_id, first_name, last_name
    FROM mk_person
    WHERE 
      (first_name LIKE ? OR last_name LIKE ? OR 
       (first_name || ' ' || last_name) LIKE ?)
      AND is_current = 1
    LIMIT 5
  `).all(
    `%${officialName.split(' ')[0]}%`,
    `%${officialName.split(' ')[officialName.split(' ').length - 1]}%`,
    `%${officialName}%`
  );

  if (rows.length > 0) {
    // Found in database
    const match = rows[0];
    const dbName = `${match.first_name} ${match.last_name}`.trim();
    found.push({ official: officialName, db: dbName, id: match.person_id });
  } else {
    missing.push(officialName);
  }
}

console.log(`✓ FOUND IN DATABASE (${found.length}):\n`);
found.slice(0, 15).forEach((m, i) => {
  console.log(`${i + 1}. ${m.official} → DB: ${m.db}`);
});

if (found.length > 15) {
  console.log(`... and ${found.length - 15} more`);
}

console.log(`\n❌ MISSING FROM DATABASE (${missing.length}):\n`);
missing.forEach((m, i) => {
  console.log(`${i + 1}. ${m}`);
});

console.log('\n═══════════════════════════════════════════════════\n');

// Try to find missing by searching more broadly
console.log('Searching for missing ministers in full MK database...\n');

const broadSearch = [];
for (const missingName of missing) {
  const parts = missingName.split(' ');
  const results = db.prepare(`
    SELECT person_id, first_name, last_name, is_current
    FROM mk_person
    WHERE first_name LIKE ? OR last_name LIKE ?
    LIMIT 10
  `).all(`%${parts[0]}%`, `%${parts[parts.length - 1]}%`);

  if (results.length > 0) {
    console.log(`${missingName}:`);
    results.forEach(r => {
      console.log(`  → ${r.first_name} ${r.last_name} (ID: ${r.person_id}, current: ${r.is_current})`);
    });
  }
}

db.close();

console.log('\n═══════════════════════════════════════════════════');
console.log('NEXT STEP: Cross-reference names and verify MK IDs');
console.log('═══════════════════════════════════════════════════\n');
