/**
 * Export the RTL-repaired bill texts out of knesset.db.
 *
 *   npx tsx scripts/export-bill-texts.ts            # gzip (ברירת מחדל)
 *   npx tsx scripts/export-bill-texts.ts --raw      # בלי דחיסה
 *
 * למה: 92% מ-7,167 המסמכים הגיעו מהארכיון עם סדר מילים הפוך בכל שורה,
 * תוצר של חילוץ טקסט מ-PDF בכיווניות RTL. התיקון העלה את עיגון הראיות
 * מ-2% ל-64%, והוא קיים רק בתוך knesset.db — שהוא gitignored ומשקלו
 * 187MB. בלי הייצוא הזה אף אחת מלבד דינה לא יכולה לעבוד על הנוסחים.
 *
 * ברירת המחדל היא gzip: 53MB גולמי הם יותר מדי ל-git, ובניגוד לקבצי
 * הניתוח אין ערך ב-diff על נוסח חוק — הוא לא משתנה בין הרצות.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

function arg(flag: string, fallback: string): string {
  const a = process.argv.slice(2).find(x => x.startsWith(`${flag}=`));
  return a ? a.slice(flag.length + 1) : fallback;
}

interface Row {
  id: number;
  title: string | null;
  committee_name: string | null;
  text_content: string;
  is_gazette: number | null;
  text_rtl_repaired: number | null;
}

function main() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`knesset.db not found at ${DB_PATH}`);

  const raw = process.argv.slice(2).includes('--raw');
  const outDir = path.join(process.cwd(), arg('--out', 'data/bill-texts'));
  fs.mkdirSync(outDir, { recursive: true });

  const db = new Database(DB_PATH, { readonly: true });
  const rows = db.prepare(
    `SELECT id, title, committee_name, text_content,
            COALESCE(is_gazette, 0) AS is_gazette,
            COALESCE(text_rtl_repaired, 0) AS text_rtl_repaired
     FROM bill
     WHERE text_content IS NOT NULL AND text_content != ''
     ORDER BY id`,
  ).all() as Row[];

  /**
   * נבנה במקטעים ולא כמחרוזת אחת: 53MB של טקסט בקריאת join אחת עוברים
   * את תקרת המחרוזת של V8 בקלות על מכונות עמוסות.
   */
  const chunks: Buffer[] = [];
  let chars = 0;
  let repaired = 0;

  for (const r of rows) {
    chars += r.text_content.length;
    if (r.text_rtl_repaired === 1) repaired++;
    chunks.push(
      Buffer.from(
        JSON.stringify({
          id: r.id,
          title: r.title,
          committee: r.committee_name,
          is_gazette: r.is_gazette === 1,
          rtl_repaired: r.text_rtl_repaired === 1,
          text: r.text_content,
        }) + '\n',
        'utf8',
      ),
    );
  }
  db.close();

  const body = Buffer.concat(chunks);
  const outPath = path.join(outDir, raw ? 'bill-texts.jsonl' : 'bill-texts.jsonl.gz');
  fs.writeFileSync(outPath, raw ? body : zlib.gzipSync(body, { level: 9 }));

  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;
  console.log(`exported ${rows.length.toLocaleString()} bill texts`);
  console.log(`  characters:   ${chars.toLocaleString()}`);
  console.log(`  RTL-repaired: ${repaired.toLocaleString()} (${Math.round((repaired / rows.length) * 100)}%)`);
  console.log('');
  console.log(`  ${path.relative(process.cwd(), outPath)}  ${mb(fs.statSync(outPath).size)}`);
  if (!raw) console.log(`  (uncompressed would be ${mb(body.length)})`);
}

main();
