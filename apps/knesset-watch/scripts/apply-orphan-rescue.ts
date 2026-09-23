/**
 * כתיבת ההתאמות שאושרו לטבלה נפרדת.
 *
 * הטבלה היא bill_political_classification_rescued, ולא הטבלה שהאתר
 * קורא ממנה. כך אפשר להשוות דירוגים לפני ואחרי לפני שמחליפים, ולחזור
 * אחורה במחיקת טבלה אחת ולא בשחזור מסד.
 *
 * המקור הוא orphan-rescue.jsonl, שנוצר ב-rescue-orphan-bills.ts. כל
 * שורה שם עברה שני ספים: ציון התאמה 0.65 ומרווח צד 0.05.
 *
 *   npx tsx scripts/apply-orphan-rescue.ts --dry-run    מדווח בלבד
 *   npx tsx scripts/apply-orphan-rescue.ts              כותב
 *   npx tsx scripts/apply-orphan-rescue.ts --drop       מוחק את הטבלה
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const SOURCE = path.join(process.cwd(), 'orphan-rescue.jsonl');
const TABLE = 'bill_political_classification_rescued';

const dryRun = process.argv.includes('--dry-run');
const drop = process.argv.includes('--drop');

interface Match {
  billId: number; billTitle: string; issueCandidate: string;
  axisId: string; axisQuestion: string; score: number;
  side: 'pro' | 'con'; stanceId: string; sideMargin: number;
}

function main(): void {
  if (!fs.existsSync(DB_PATH)) throw new Error(`לא נמצא: ${DB_PATH}`);
  const db = new Database(DB_PATH);

  if (drop) {
    db.exec(`DROP TABLE IF EXISTS ${TABLE}`);
    console.log(`הטבלה ${TABLE} נמחקה. bill_political_classification לא נגעה.`);
    db.close();
    return;
  }

  if (!fs.existsSync(SOURCE)) throw new Error(`לא נמצא: ${SOURCE}\nהריצי קודם את rescue-orphan-bills.ts`);
  const matches = fs.readFileSync(SOURCE, 'utf8').trim().split('\n')
    .map(l => JSON.parse(l) as Match);

  console.log(`התאמות בקובץ : ${matches.length.toLocaleString()}`);
  console.log(`הצעות חוק    : ${new Set(matches.map(m => m.billId)).size.toLocaleString()}`);
  console.log(`צירים        : ${new Set(matches.map(m => m.axisId)).size}`);

  /*
    בדיקת שפיות לפני כתיבה: אף הצעה שכבר מסווגת אינה אמורה להיות כאן.
    אם היא כן — משהו בצינור השתנה, ועדיף לעצור מאשר להכפיל שורות.
  */
  const existing = new Set(
    (db.prepare('SELECT DISTINCT bill_id FROM bill_political_classification').all() as Array<{ bill_id: number }>)
      .map(r => r.bill_id));
  const collisions = matches.filter(m => existing.has(m.billId));
  if (collisions.length) {
    console.error(`\n✗ ${collisions.length} הצעות כבר מסווגות בטבלה המקורית. עוצר.`);
    for (const c of collisions.slice(0, 5)) console.error(`   ${c.billId} — ${c.billTitle.slice(0, 50)}`);
    db.close();
    process.exit(1);
  }
  console.log('✓ אין חפיפה עם הטבלה המקורית');

  const minScore = Math.min(...matches.map(m => m.score));
  const minMargin = Math.min(...matches.map(m => m.sideMargin));
  console.log(`✓ ציון מינימלי ${minScore.toFixed(4)} · מרווח מינימלי ${minMargin.toFixed(4)}`);

  if (dryRun) {
    console.log('\n--dry-run — לא נכתב דבר.');
    db.close();
    return;
  }

  /*
    אותן שלוש עמודות כמו בטבלה המקורית, ועוד ארבע שמתעדות מאיפה השורה
    הגיעה. בלעדיהן אי אפשר יהיה להסביר בעוד חודש למה חוק מסוים שויך
    לציר מסוים, ומי שיסתכל יראה סיווג שנראה בדיוק כמו האנושי.
  */
  db.exec(`
    DROP TABLE IF EXISTS ${TABLE};
    CREATE TABLE ${TABLE} (
      bill_id     INTEGER NOT NULL,
      issue_id    TEXT    NOT NULL,
      stance_id   TEXT    NOT NULL,
      match_score REAL    NOT NULL,
      side_margin REAL    NOT NULL,
      source      TEXT    NOT NULL,
      created_at  TEXT    NOT NULL,
      PRIMARY KEY (bill_id, issue_id)
    );
    CREATE INDEX idx_rescued_bill ON ${TABLE}(bill_id);
    CREATE INDEX idx_rescued_issue ON ${TABLE}(issue_id);
  `);

  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO ${TABLE}
      (bill_id, issue_id, stance_id, match_score, side_margin, source, created_at)
    VALUES (?, ?, ?, ?, ?, 'stance-embedding', ?)`);

  const run = db.transaction((rows: Match[]) => {
    for (const m of rows) insert.run(m.billId, m.axisId, m.stanceId, m.score, m.sideMargin, now);
  });
  run(matches);

  const stored = db.prepare(`SELECT COUNT(*) AS n, COUNT(DISTINCT bill_id) AS bills FROM ${TABLE}`)
    .get() as { n: number; bills: number };
  console.log(`\nנכתבו ל-${TABLE}: ${stored.n.toLocaleString()} שורות · ${stored.bills.toLocaleString()} הצעות חוק`);

  const orig = db.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT bill_id) AS bills FROM bill_political_classification')
    .get() as { n: number; bills: number };
  console.log(`bill_political_classification: ${orig.n.toLocaleString()} שורות · ${orig.bills.toLocaleString()} הצעות — לא נגעה`);
  console.log(`\nיחד היו: ${(orig.bills + stored.bills).toLocaleString()} הצעות מסווגות (+${Math.round(stored.bills / orig.bills * 100)}%)`);
  console.log('\nלביטול: npx tsx scripts/apply-orphan-rescue.ts --drop');

  db.close();
}

main();
