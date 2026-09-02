/**
 * Extract text from the bill documents already on disk.
 *
 *   npx tsx scripts/extract-bill-text.ts            כל מה שחסר
 *   npx tsx scripts/extract-bill-text.ts --limit=20 אצווה קטנה לבדיקה
 *   npx tsx scripts/extract-bill-text.ts --force    לחלץ מחדש גם מה שקיים
 *
 * למה סקריפט נפרד ולא download-bill-documents.ts: הסקריפט ההוא בוחר
 * לפי `WHERE doc_url IS NOT NULL AND local_path IS NULL`. שתי העמודות
 * ריקות במאגר הזה — doc_url ב-100% מ-7,296 החוקים — ולכן הוא היה
 * בוחר אפס שורות ולא עושה דבר. בנוסף הוא מוריד מהרשת, בעוד ש-7,407
 * הקבצים כבר יושבים ב-bill-documents/.
 *
 * כאן הכל מקומי: אין רשת, אין עלות, ואפשר לעצור ולהמשיך בכל רגע.
 * שם הקובץ הוא מזהה החוק, וזה כל הקישור שנדרש.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const DOCS_DIR = path.join(process.cwd(), 'bill-documents');

/**
 * טקסט קצר מזה אינו נוסח חוק אלא שריד חילוץ שנכשל — בדרך כלל PDF
 * סרוק בלי שכבת טקסט. נשמר כ-NULL כדי שייספר ככישלון ולא כהצלחה.
 */
const MIN_USEFUL_LENGTH = 200;

interface Args {
  limit: number | null;
  force: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const limitArg = argv.find(a => a.startsWith('--limit='));
  return {
    limit: limitArg ? Number(limitArg.split('=')[1]) || null : null,
    force: argv.includes('--force'),
  };
}

/** מוסיף עמודה רק אם אינה קיימת, כדי שהסקריפט יהיה בטוח להרצה חוזרת */
function ensureColumn(db: Database.Database, column: string, type: string): void {
  const cols = (db.prepare('PRAGMA table_info(bill)').all() as Array<{ name: string }>)
    .map(c => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE bill ADD COLUMN ${column} ${type}`);
    console.log(`  added column bill.${column}`);
  }
}

async function extractText(filePath: string): Promise<string | null> {
  const ext = path.extname(filePath).toLowerCase();
  const buffer = fs.readFileSync(filePath);

  try {
    if (ext === '.pdf') {
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      await parser.destroy();
      return result.text ?? null;
    }
    if (ext === '.docx' || ext === '.doc') {
      const result = await mammoth.extractRawText({ buffer });
      return result.value ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

/** רווחים כפולים ושורות ריקות מנפחים את הטקסט בלי להוסיף מידע */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

async function main() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`knesset.db not found at ${DB_PATH}`);
  if (!fs.existsSync(DOCS_DIR)) throw new Error(`bill-documents/ not found at ${DOCS_DIR}`);

  const args = parseArgs();
  const db = new Database(DB_PATH);

  ensureColumn(db, 'text_content', 'TEXT');
  ensureColumn(db, 'local_path', 'TEXT');

  // שם הקובץ הוא מזהה החוק — זה כל הקישור שנדרש בין הדיסק למאגר
  const onDisk = new Map<number, string>();
  for (const file of fs.readdirSync(DOCS_DIR)) {
    const ext = path.extname(file).toLowerCase();
    if (!['.pdf', '.docx', '.doc'].includes(ext)) continue;
    const id = Number(path.basename(file, ext));
    if (Number.isFinite(id)) onDisk.set(id, path.join(DOCS_DIR, file));
  }

  const billIds = (db.prepare('SELECT id, text_content FROM bill').all() as Array<{
    id: number;
    text_content: string | null;
  }>)
    .filter(b => onDisk.has(b.id))
    .filter(b => args.force || !b.text_content)
    .map(b => b.id);

  const todo = args.limit ? billIds.slice(0, args.limit) : billIds;

  console.log(`documents on disk: ${onDisk.size.toLocaleString()}`);
  console.log(`bills to extract:  ${todo.length.toLocaleString()}${args.limit ? ` (limited from ${billIds.length.toLocaleString()})` : ''}`);
  if (todo.length === 0) {
    console.log('nothing to do.');
    db.close();
    return;
  }

  const update = db.prepare('UPDATE bill SET text_content = ?, local_path = ? WHERE id = ?');

  let ok = 0;
  let tooShort = 0;
  let failed = 0;
  const startedAt = Date.now();

  for (const [index, id] of todo.entries()) {
    const filePath = onDisk.get(id)!;
    const relative = path.relative(process.cwd(), filePath);

    const raw = await extractText(filePath);
    const text = raw ? normalize(raw) : '';

    if (text.length >= MIN_USEFUL_LENGTH) {
      update.run(text, relative, id);
      ok++;
    } else if (text.length > 0) {
      // חילוץ חלקי — נשמר כ-NULL, אבל המסלול נרשם כדי לדעת שנוסה
      update.run(null, relative, id);
      tooShort++;
    } else {
      update.run(null, `${relative}.failed`, id);
      failed++;
    }

    if ((index + 1) % 250 === 0 || index === todo.length - 1) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = (index + 1) / elapsed;
      const remaining = Math.round((todo.length - index - 1) / rate);
      console.log(
        `  ${index + 1}/${todo.length}  ok=${ok} short=${tooShort} failed=${failed}` +
        `  ${rate.toFixed(1)}/s  eta ${Math.floor(remaining / 60)}m${remaining % 60}s`,
      );
    }
  }

  const stats = db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN text_content IS NOT NULL AND text_content != '' THEN 1 ELSE 0 END) AS withText
     FROM bill`,
  ).get() as { total: number; withText: number };

  console.log('\nDone.');
  console.log(`  extracted:      ${ok.toLocaleString()}`);
  console.log(`  too short:      ${tooShort.toLocaleString()}  (probably scanned PDFs)`);
  console.log(`  failed:         ${failed.toLocaleString()}`);
  console.log(`  bills with text now: ${stats.withText.toLocaleString()} / ${stats.total.toLocaleString()}`);

  db.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
