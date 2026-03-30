/**
 * One-time migration: backfill init_date for all existing K25 bills.
 * Extracts the Gregorian year from the bill title (e.g. "...התשפ"ה-2025" → "2025").
 * This covers ~91% of bills; the rest lack a standard year in the title.
 *
 * Usage:
 *   cd apps/knesset-watch
 *   npx tsx scripts/migrate-bill-initdate.ts
 */

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

function main() {
  const db = new Database(DB_PATH);

  // Add column if missing
  const cols = (db.prepare('PRAGMA table_info(bill)').all() as { name: string }[]).map(r => r.name);
  if (!cols.includes('init_date')) {
    db.exec('ALTER TABLE bill ADD COLUMN init_date TEXT');
    console.log('Added init_date column');
  }

  // Extract year from title: titles end with "...התשפ\"ה-2025" pattern
  const result = db.prepare(`
    UPDATE bill SET init_date = SUBSTR(TRIM(title), -4, 4)
    WHERE init_date IS NULL AND TRIM(title) GLOB '*-202[0-9]'
  `).run();

  console.log(`Updated init_date for ${result.changes} bills`);
  db.close();
}

main();
