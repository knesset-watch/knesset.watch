// scripts/fix-staff.ts
// Run: npm run db:fix-staff
//
// Re-parses staff sections from protocol_text with improved detection.
// session_staff had only 4 rows — this fixes the extraction.
// Clears and repopulates session_staff.

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

const STAFF_PATTERNS = [
  // Each pattern: search string, role, and whether name is on same line or next line
  { search: 'ייעוץ משפטי', role: 'legal_counsel' },
  { search: 'ייעוץ משפטית', role: 'legal_counsel' },
  { search: 'מנהלת הוועדה', role: 'manager' },
  { search: 'מנהל הוועדה', role: 'manager' },
  { search: 'מנהל/ת הוועדה', role: 'manager' },
  { search: 'רישום פרלמנטרי', role: 'writer' },
  { search: 'מתרגמת', role: 'translator' },
  { search: 'מתרגם', role: 'translator' },
];

function extractStaff(text: string): Array<{ role: string; name: string }> {
  const staff: Array<{ role: string; name: string }> = [];

  for (const { search, role } of STAFF_PATTERNS) {
    // Find all occurrences (may appear multiple times)
    let searchFrom = 0;
    while (true) {
      const idx = text.indexOf(search, searchFrom);
      if (idx < 0) break;
      searchFrom = idx + 1;

      // Only look within header/footer region (before body or after body)
      // Staff sections are typically before << יור >> or << דובר >>
      const bodyStart = text.search(/<< (יור|דובר)/);
      if (bodyStart > 0 && idx > bodyStart + 500) break; // too deep in body

      // Extract the colon and everything after on the same line and next few lines
      const colonIdx = text.indexOf(':', idx + search.length);
      if (colonIdx < 0 || colonIdx - idx > 30) continue; // colon too far = not our header

      // Grab up to 300 chars after the colon
      const afterColon = text.slice(colonIdx + 1, colonIdx + 300);

      // Split into lines, take non-empty lines until a blank line or new section header
      const lines = afterColon.split('\n');
      let foundName = false;
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          if (foundName) break; // blank line after a name = end of section
          continue;             // blank line before first name = skip (handles \n\n after colon)
        }
        if (line.length < 2 || line.length > 80) continue;
        if (line.endsWith(':')) break; // next section header
        if (/^[\d\s\-–]+$/.test(line)) continue;

        staff.push({ role, name: line });
        foundName = true;
      }
      break; // only take first occurrence per search term per session
    }
  }

  return staff;
}

async function main() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  console.log('Fix Session Staff');

  // Ensure table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_staff (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      role       TEXT NOT NULL,
      name_text  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_staff_session ON session_staff (session_id);
  `);

  // Clear existing (only 4 rows, all wrong)
  const deleted = db.prepare('DELETE FROM session_staff').run();
  console.log(`  Cleared ${deleted.changes} existing rows.`);

  const sessions = db.prepare(`
    SELECT id, protocol_text FROM committee_session
    WHERE protocol_text IS NOT NULL AND length(protocol_text) > 100
  `).all() as { id: number; protocol_text: string }[];

  console.log(`  Processing ${sessions.length.toLocaleString()} sessions...`);

  const insert = db.prepare('INSERT INTO session_staff (session_id, role, name_text) VALUES (?, ?, ?)');

  let totalInserted = 0;
  let sessionsWithStaff = 0;
  const BATCH = 1000;

  for (let i = 0; i < sessions.length; i += BATCH) {
    const batch = sessions.slice(i, i + BATCH);

    db.transaction(() => {
      for (const s of batch) {
        const staffEntries = extractStaff(s.protocol_text);
        if (staffEntries.length > 0) {
          sessionsWithStaff++;
          for (const e of staffEntries) {
            insert.run(s.id, e.role, e.name);
            totalInserted++;
          }
        }
      }
    })();

    if ((i + BATCH) % 3000 === 0 || i + BATCH >= sessions.length) {
      const pct = Math.round(((i + BATCH) / sessions.length) * 100);
      process.stdout.write(`\r    ${i + BATCH}/${sessions.length} (${pct}%) — ${totalInserted} staff entries found`);
    }
  }

  console.log('\n');

  // Stats by role
  const byRole = db.prepare(
    'SELECT role, COUNT(*) as cnt FROM session_staff GROUP BY role ORDER BY cnt DESC'
  ).all() as any[];

  console.log(`Results: ${totalInserted.toLocaleString()} staff entries across ${sessionsWithStaff.toLocaleString()} sessions`);
  byRole.forEach(r => console.log(`  ${r.role}: ${r.cnt.toLocaleString()}`));

  // Sample
  const sample = db.prepare(`
    SELECT ss.role, ss.name_text, cs.date, c.name as committee_name
    FROM session_staff ss
    JOIN committee_session cs ON cs.id = ss.session_id
    LEFT JOIN committee c ON c.id = cs.committee_id
    LIMIT 5
  `).all() as any[];
  console.log('\nSample:');
  sample.forEach(r => console.log(`  ${r.date} | ${r.committee_name} | ${r.role}: ${r.name_text}`));

  db.close();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
