/**
 * Import bill full text from the JSONL archive into knesset.db.
 *
 *   npx tsx scripts/import-bill-fulltext.ts --dir="C:/path/to/Archive"
 *   npx tsx scripts/import-bill-fulltext.ts --dir=... --dry-run
 *
 * למה הארכיון ולא ה-PDF-ים שב-git: חילוץ ישיר מ-bill-documents/ מחזיר
 * ב-67% מהמקרים חוברת "רשומות" שלמה — גיליון רשמי שמכיל עשרות הצעות
 * חוק — השמורה תחת מזהה של חוק אחד. "חוק הירושה" יצא 87,670 תווים.
 * בארכיון הזה התופעה יורדת ל-7%, והחציון 2,775 תווים, שזה סדר הגודל
 * הנכון להצעת חוק בודדת.
 *
 * הסקריפט מסמן את החוברות שנותרו ב-is_gazette כדי שאפשר יהיה לטפל בהן
 * בנפרד, במקום להעמיד פנים שהן טקסט של חוק אחד.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { repairIfReversed } from './lib/rtl-repair';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

/** פתיח שמעיד על גיליון רשומות ולא על הצעת חוק בודדת */
const GAZETTE_MARKER = /רשומות/;
const GAZETTE_WINDOW = 300;

/** מתחת לזה אין ממש נוסח חוק — שריד חילוץ, בדרך כלל PDF סרוק */
const MIN_USEFUL_LENGTH = 200;

interface ArchiveRow {
  id: number;
  title?: string | null;
  text_content?: string | null;
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const dirArg = argv.find(a => a.startsWith('--dir='));
  return {
    dir: dirArg ? dirArg.slice('--dir='.length).replace(/^["']|["']$/g, '') : null,
    dryRun: argv.includes('--dry-run'),
  };
}

function ensureColumn(db: Database.Database, column: string, type: string): void {
  const cols = (db.prepare('PRAGMA table_info(bill)').all() as Array<{ name: string }>)
    .map(c => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE bill ADD COLUMN ${column} ${type}`);
    console.log(`  added column bill.${column}`);
  }
}

/** קורא שורה-שורה כדי לא להחזיק 100MB של JSON בזיכרון בבת אחת */
async function* readJsonl(filePath: string): AsyncGenerator<ArchiveRow> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      yield JSON.parse(trimmed) as ArchiveRow;
    } catch {
      // שורה פגומה — מדולגת, נספרת בסטטיסטיקה
    }
  }
}

/**
 * שומר שורות ומאחד רק רווחים בתוכן.
 *
 * הגרסה הקודמת איחדה גם שורות חדשות, וזו הייתה טעות: 91% מהמסמכים
 * הגיעו עם סדר מילים הפוך, והתיקון עובד שורה-שורה. בלי מבנה השורות
 * אי אפשר לתקן אותם כלל.
 */
function normalize(text: string): string {
  return text
    .split('\n')
    .map(line => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function main() {
  const args = parseArgs();
  if (!args.dir) throw new Error('--dir is required, pointing at the folder holding the .jsonl files');
  if (!fs.existsSync(args.dir)) throw new Error(`directory not found: ${args.dir}`);
  if (!fs.existsSync(DB_PATH)) throw new Error(`knesset.db not found at ${DB_PATH}`);

  const files = fs
    .readdirSync(args.dir)
    .filter(f => f.endsWith('.jsonl'))
    .sort()
    .map(f => path.join(args.dir!, f));

  if (files.length === 0) throw new Error(`no .jsonl files in ${args.dir}`);
  console.log(`archive: ${files.length} files`);

  const db = new Database(DB_PATH);
  ensureColumn(db, 'text_content', 'TEXT');
  ensureColumn(db, 'is_gazette', 'INTEGER');
  ensureColumn(db, 'text_rtl_repaired', 'INTEGER');

  const known = new Set(
    (db.prepare('SELECT id FROM bill').all() as Array<{ id: number }>).map(r => r.id),
  );

  const update = db.prepare(
    'UPDATE bill SET text_content = ?, is_gazette = ?, text_rtl_repaired = ? WHERE id = ?',
  );

  let seen = 0;
  let imported = 0;
  let gazette = 0;
  let tooShort = 0;
  let unknownBill = 0;
  let repairedCount = 0;

  type Row = [string, number, number, number];
  const apply = db.transaction((rows: Row[]) => {
    for (const row of rows) update.run(...row);
  });

  let batch: Row[] = [];

  for (const file of files) {
    for await (const row of readJsonl(file)) {
      seen++;

      if (!known.has(row.id)) {
        unknownBill++;
        continue;
      }

      const normalized = normalize(row.text_content ?? '');
      if (normalized.length < MIN_USEFUL_LENGTH) {
        tooShort++;
        continue;
      }

      // התיקון קודם לזיהוי החוברת — "רשומות" מופיע הפוך בטקסט שלא תוקן
      const { text, repaired } = repairIfReversed(normalized);
      if (repaired) repairedCount++;

      const isGazette = GAZETTE_MARKER.test(text.slice(0, GAZETTE_WINDOW)) ? 1 : 0;
      if (isGazette) gazette++;

      batch.push([text, isGazette, repaired ? 1 : 0, row.id]);
      imported++;

      if (batch.length >= 500 && !args.dryRun) {
        apply(batch);
        batch = [];
      }
    }
    console.log(`  ${path.basename(file)} — ${seen.toLocaleString()} rows read`);
  }

  if (batch.length > 0 && !args.dryRun) apply(batch);

  console.log(`\n${args.dryRun ? 'Dry run — nothing written.' : 'Done.'}`);
  console.log(`  rows in archive:     ${seen.toLocaleString()}`);
  console.log(`  imported:            ${imported.toLocaleString()}`);
  console.log(`  flagged as gazette:  ${gazette.toLocaleString()}`);
  console.log(`  RTL-repaired:        ${repairedCount.toLocaleString()}`);
  console.log(`  too short, skipped:  ${tooShort.toLocaleString()}`);
  console.log(`  id not in bill table:${unknownBill.toLocaleString()}`);

  if (!args.dryRun) {
    const stats = db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN text_content IS NOT NULL AND text_content != '' THEN 1 ELSE 0 END) AS withText,
              SUM(CASE WHEN is_gazette = 1 THEN 1 ELSE 0 END) AS gazette
       FROM bill`,
    ).get() as { total: number; withText: number; gazette: number };
    console.log(`\n  bills with text: ${stats.withText.toLocaleString()} / ${stats.total.toLocaleString()}`);
    console.log(`  gazette booklets: ${stats.gazette.toLocaleString()}`);
  }

  db.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
