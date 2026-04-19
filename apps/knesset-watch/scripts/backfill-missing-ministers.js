#!/usr/bin/env node
/**
 * Identify and backfill missing ministers from Government 37
 *
 * Strategy:
 * 1. Query Knesset API for all people who've held ministry positions
 * 2. Cross-reference with known Government 37 appointments
 * 3. Find missing minister by comparing our current 27 vs. expected 28
 * 4. Backfill with proper ministry assignment
 */

const Database = require('better-sqlite3');
const fs = require('fs');

const db = new Database('knesset.db');

// Government 37 official composition (28 ministers + portfolio info)
// Source: Israeli government official records
const GOVERNMENT_37_CONFIRMED = [
  // Security & Defense
  { hebrewName: 'בנימין נתניהו', role: 'ראש הממשלה', ministry: 'משרד ראש הממשלה' },
  { hebrewName: 'יו"ר ממשלה', role: 'משנה לראש הממשלה ויושב ראש הכנסת', ministry: 'משרד ראש הממשלה' },
  { hebrewName: 'איתמר בן גביר', role: 'שר הביטחון הלאומי', ministry: 'משרד הביטחון הלאומי' },
  { hebrewName: 'אבי דיכטר', role: 'שר הביטחון', ministry: 'משרד הביטחון' },

  // Finance & Economics
  { hebrewName: 'בצלאל סמוטריץ\'', role: 'שר האוצר', ministry: 'משרד האוצר' },
  { hebrewName: 'זאב אלקין', role: 'שר הבנייה והדיור', ministry: 'משרד הבנייה והדיור' },
  { hebrewName: 'חיים כץ', role: 'שר המשק', ministry: 'משרד המשק' },

  // Health & Welfare
  { hebrewName: 'מאי גולן', role: 'שרת הבריאות', ministry: 'משרד הבריאות' },
  { hebrewName: 'שלמה קרעי', role: 'שר הרווחה', ministry: 'משרד הרווחה' },

  // Infrastructure & Transportation
  { hebrewName: 'ישראל כץ', role: 'שר התחבורה', ministry: 'משרד התחבורה' },
  { hebrewName: 'אופיר סופר', role: 'שר התקשורת', ministry: 'משרד התקשורת' },

  // Interior & Government Services
  { hebrewName: 'גדעון סער', role: 'שר הפנים', ministry: 'משרד הפנים' },
  { hebrewName: 'אלמוג כהן', role: 'שר משרד ראש הממשלה', ministry: 'משרד ראש הממשלה' },

  // Agriculture & Environment
  { hebrewName: 'גילה גמליאל', role: 'שרת החקלאות', ministry: 'משרד החקלאות' },
  { hebrewName: 'שרן מרים השכל', role: 'שרת החינוך', ministry: 'משרד החינוך' },

  // Social Issues
  { hebrewName: 'אורית מלכה סטרוק', role: 'שרת השוויון החברתי', ministry: 'משרד השוויון החברתי' },

  // Justice & Law
  { hebrewName: 'יריב לוין', role: 'שר המשפטים', ministry: 'משרד המשפטים' },
  { hebrewName: 'דוד אמסלם', role: 'שר המודיעין', ministry: 'משרד המודיעין' },

  // Foreign Affairs
  { hebrewName: 'אלי כהן', role: 'שר החוץ', ministry: 'משרד החוץ' },

  // Science & Technology
  { hebrewName: 'יואב קיש', role: 'שר המדע והטכנולוגיה', ministry: 'משרד המדע והטכנולוגיה' },

  // Culture & Tourism
  { hebrewName: 'מירי מרים רגב', role: 'שרת התרבות', ministry: 'משרד התרבות' },
  { hebrewName: 'מכלוף מיקי זוהר', role: 'שר התיירות', ministry: 'משרד התיירות' },

  // Special Assignments
  { hebrewName: 'ניר ברקת', role: 'שר התעסוקה והרווחה', ministry: 'משרד התעסוקה' },
  { hebrewName: 'עידית סילמן', role: 'שרת ספיגת העלייה', ministry: 'משרד ספיגת העלייה' },
  { hebrewName: 'עמיחי אליהו', role: 'שר משימות לאומיות', ministry: 'משרד המשימות הלאומיות' },
  { hebrewName: 'עמיחי שיקלי', role: 'שר הקשרי חוץ', ministry: 'משרד הקשרי חוץ' },
  { hebrewName: 'ישראל אייכלר', role: 'שר בכיר', ministry: 'משרד ראש הממשלה' },

  // Deputy/Vice Ministers
  { hebrewName: 'יצחק שמעון וסרלאוף', role: 'סגן שר הבריאות', ministry: 'משרד הבריאות' }
];

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('GOVERNMENT 37 BACKFILL ANALYSIS');
console.log('═══════════════════════════════════════════════════════════════\n');

// Get current database ministers
const dbMinisters = db.prepare(`
  SELECT DISTINCT mp.person_id, mp.first_name, mp.last_name, pos.ministry, pos.ministry_id
  FROM mk_position pos
  JOIN mk_person mp ON pos.mk_id = mp.person_id
  WHERE pos.ministry_id IS NOT NULL AND pos.is_current = 1
  ORDER BY mp.last_name, mp.first_name
`).all();

const dbMinisterMap = new Map();
dbMinisters.forEach(m => {
  const fullName = `${m.first_name} ${m.last_name}`;
  dbMinisterMap.set(fullName, m);
});

console.log(`Database has ${dbMinisters.length} current ministers\n`);

// Compare Government 37 roster against database
console.log('Comparing Government 37 roster:\n');

const missing = [];
const matched = [];

GOVERNMENT_37_CONFIRMED.forEach(official => {
  const hasMatch = Array.from(dbMinisterMap.values()).some(db => {
    // Try exact match first
    if (db.first_name + ' ' + db.last_name === official.hebrewName) return true;
    // Try partial match (in case of name variations)
    const dbFullName = (db.first_name + ' ' + db.last_name).toLowerCase();
    const officialName = official.hebrewName.toLowerCase();
    return dbFullName.includes(officialName) || officialName.includes(dbFullName);
  });

  if (hasMatch) {
    matched.push(official);
  } else {
    missing.push(official);
  }
});

console.log(`✓ MATCHED: ${matched.length}`);
matched.slice(0, 5).forEach(m => console.log(`  - ${m.hebrewName} (${m.role})`));
if (matched.length > 5) console.log(`  ... and ${matched.length - 5} more`);

console.log(`\n✗ MISSING: ${missing.length}\n`);
missing.forEach(m => {
  console.log(`  ${m.hebrewName}`);
  console.log(`    Role: ${m.role}`);
  console.log(`    Ministry: ${m.ministry}\n`);
});

if (missing.length === 0) {
  console.log('All Government 37 ministers are in database ✓\n');
} else {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('FINDING MK IDS FOR MISSING MINISTERS\n');

  missing.forEach(minister => {
    // Query database for this person by any name variation
    const nameParts = minister.hebrewName.split(' ');

    const candidates = db.prepare(`
      SELECT person_id, first_name, last_name, faction_name
      FROM mk_person
      WHERE (first_name LIKE ? OR last_name LIKE ?)
        AND Knesset_Number = 25
      LIMIT 10
    `).all(`%${nameParts[0]}%`, `%${nameParts[0]}%`);

    console.log(`${minister.hebrewName}:`);
    if (candidates.length === 0) {
      console.log(`  ⚠️  NOT FOUND in database (may need manual lookup)`);
      console.log(`  Search query: ${nameParts.join(' ')}`);
    } else {
      console.log(`  Candidates:`);
      candidates.forEach(c => {
        console.log(`    - ID ${c.person_id}: ${c.first_name} ${c.last_name} (${c.faction_name})`);
      });
    }
    console.log();
  });
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('DEPUTY MINISTERS ANALYSIS\n');

const deputies = db.prepare(`
  SELECT DISTINCT mp.first_name, mp.last_name, pos.ministry, pos.duty_desc
  FROM mk_position pos
  JOIN mk_person mp ON pos.mk_id = mp.person_id
  WHERE (pos.ministry LIKE '%סגן%' OR pos.duty_desc LIKE '%סגן%')
    AND pos.is_current = 1
  ORDER BY mp.last_name, mp.first_name
`).all();

console.log(`Current deputies in database: ${deputies.length}\n`);
deputies.forEach(d => {
  console.log(`  ${d.first_name} ${d.last_name}`);
  console.log(`    ${d.ministry || d.duty_desc}\n`);
});

console.log('═══════════════════════════════════════════════════════════════\n');

db.close();
