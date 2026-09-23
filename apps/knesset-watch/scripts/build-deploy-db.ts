/**
 * בניית knesset-deploy.db מתוך knesset.db המקומי.
 *
 * הפרודקשן אינו רץ על knesset.db. vercel.json — וה-Build Command ב-Render —
 * מעתיקים את knesset-deploy.db ומגישים אותו, וזה קובץ שנבנה עד היום ביד.
 * המשמעות הייתה שאף אחד לא ידע מה בדיוק נמצא בו ומה חסר, עד שפיצ׳ר נשבר
 * בפרודקשן ועבד מקומית.
 *
 * מה הסקריפט מוסיף לקובץ קיים:
 *   bill_policy_analysis   התקציר שמוצג בעמוד החוק
 *   bill_policy_issue      האג׳נדה של החוק — תחום, סוגיה, עמדות בעד ונגד
 *
 * מה הוא משמיט במכוון:
 *   raw_response    11.6MB של פלט LLM גולמי שהממשק אינו קורא
 *   evidence_json   אותו שיקול
 *   text_content    50MB של נוסחי חוק; הם מכפילים את גודל הקובץ, והנוסח
 *                   עצמו משובש בחלק מההצעות. אפשר להוסיף עם --with-text.
 *
 * הרצה:
 *   npx tsx scripts/build-deploy-db.ts            מוסיף את שכבת הניתוח
 *   npx tsx scripts/build-deploy-db.ts --with-text  מוסיף גם את הנוסח המלא
 *   npx tsx scripts/build-deploy-db.ts --dry-run    מדווח בלי לכתוב
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, 'knesset.db');
const TARGET = path.join(ROOT, 'knesset-deploy.db');

const withText = process.argv.includes('--with-text');
const dryRun = process.argv.includes('--dry-run');

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(0) + 'MB';
}

function main(): void {
  for (const f of [SOURCE, TARGET]) {
    if (!fs.existsSync(f)) {
      console.error(`✗ לא נמצא: ${f}`);
      process.exit(1);
    }
  }

  const before = fs.statSync(TARGET).size;
  console.log(`מקור : knesset.db        ${mb(fs.statSync(SOURCE).size)}`);
  console.log(`יעד  : knesset-deploy.db ${mb(before)}`);
  console.log('');

  const db = new Database(TARGET);
  db.exec(`ATTACH DATABASE '${SOURCE.replace(/\\/g, '/')}' AS src`);

  const has = (t: string): boolean =>
    !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(t);

  const count = (t: string, schema = 'src'): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${schema}.${t}`).get() as { n: number }).n;

  // ── the summary shown on the bill page ─────────────────────────────────
  console.log(`bill_policy_analysis : ${count('bill_policy_analysis')} rows in source`);
  if (!dryRun) {
    if (has('bill_policy_analysis')) db.exec('DROP TABLE bill_policy_analysis');
    db.exec(`CREATE TABLE bill_policy_analysis (
      bill_id INTEGER, analysis_version TEXT, overall_summary TEXT,
      confidence REAL, needs_review INTEGER, evidence_grounding TEXT,
      status TEXT, text_chars INTEGER, analyzed_at TEXT)`);
    db.exec(`INSERT INTO bill_policy_analysis
      SELECT bill_id, analysis_version, overall_summary, confidence, needs_review,
             evidence_grounding, status, text_chars, analyzed_at
      FROM src.bill_policy_analysis`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_bpa_bill ON bill_policy_analysis(bill_id)');
  }

  // ── the per-bill agenda ────────────────────────────────────────────────
  console.log(`bill_policy_issue    : ${count('bill_policy_issue')} rows in source`);
  if (!dryRun) {
    if (has('bill_policy_issue')) db.exec('DROP TABLE bill_policy_issue');
    db.exec(`CREATE TABLE bill_policy_issue (
      id INTEGER, bill_id INTEGER, analysis_version TEXT, domain_candidate TEXT,
      issue_candidate TEXT, policy_change TEXT, pro_stance TEXT, con_stance TEXT,
      explanation TEXT, confidence REAL, is_primary INTEGER)`);
    db.exec(`INSERT INTO bill_policy_issue
      SELECT id, bill_id, analysis_version, domain_candidate, issue_candidate,
             policy_change, pro_stance, con_stance, explanation, confidence, is_primary
      FROM src.bill_policy_issue`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_bpi_bill ON bill_policy_issue(bill_id)');
  }

  /*
    ── שיוך ההצעות לצירים ─────────────────────────────────────────────────

    זה מה שהשאלון קורא ממנו, והוא לא הועתק כאן עד עכשיו. הסקריפט רק
    ודא בסוף שהטבלה קיימת ושהצטרפות אליה עובדת — ושתיהן היו נכונות גם
    כשהתוכן היה מיושן בחודשים. התוצאה: 467 הצעות שמוזגו ו-37 שיוכי
    להט"ב עבדו מקומית והשאלון בפרודקשן החזיר עליהן ריק.
  */
  console.log(`bill_political_classification : ${count('bill_political_classification')} rows in source ` +
              `(${count('bill_political_classification', 'main')} in target)`);
  if (!dryRun) {
    db.exec('DELETE FROM bill_political_classification');
    db.exec(`INSERT INTO bill_political_classification (bill_id, issue_id, stance_id)
             SELECT bill_id, issue_id, stance_id FROM src.bill_political_classification`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_bpc_issue ON bill_political_classification(issue_id)');
  }

  // ── the full bill text, only when asked for ────────────────────────────
  if (withText) {
    console.log('bill.text_content    : copying — this adds roughly 50MB');
    if (!dryRun) {
      const cols = (db.prepare(`SELECT name FROM pragma_table_info('bill')`).all() as Array<{ name: string }>)
        .map(c => c.name);
      if (!cols.includes('text_content')) {
        db.exec('ALTER TABLE bill ADD COLUMN text_content TEXT');
      }
      if (!cols.includes('text_rtl_repaired')) {
        db.exec('ALTER TABLE bill ADD COLUMN text_rtl_repaired TEXT');
      }
      db.exec(`UPDATE bill SET
        text_content      = (SELECT s.text_content      FROM src.bill s WHERE s.id = bill.id),
        text_rtl_repaired = (SELECT s.text_rtl_repaired FROM src.bill s WHERE s.id = bill.id)`);
    }
  } else {
    console.log('bill.text_content    : skipped — pass --with-text to include it');
  }

  db.exec('DETACH DATABASE src');

  if (dryRun) {
    console.log('\n--dry-run — nothing was written');
    db.close();
    return;
  }

  db.exec('VACUUM');
  db.close();

  const after = fs.statSync(TARGET).size;
  console.log('');
  console.log(`גודל : ${mb(before)} → ${mb(after)}  (${after > before ? '+' : ''}${mb(after - before)})`);

  // ── prove the queries the app runs now work ────────────────────────────
  const check = new Database(TARGET, { readonly: true });
  const ok = (label: string, sql: string): void => {
    try {
      check.prepare(sql).all();
      console.log(`  ✓ ${label}`);
    } catch (e) {
      console.log(`  ✗ ${label} — ${(e as Error).message.split('\n')[0]}`);
    }
  };
  console.log('');
  console.log('בדיקת השאילתות שהאפליקציה מריצה:');
  ok('bill summary', 'SELECT overall_summary FROM bill_policy_analysis LIMIT 1');
  ok('bill agenda', 'SELECT domain_candidate, pro_stance, con_stance FROM bill_policy_issue LIMIT 1');
  ok('bills list join',
     'SELECT b.id, a.overall_summary FROM bill b LEFT JOIN bill_policy_analysis a ON a.bill_id = b.id LIMIT 1');
  ok('cluster → bills',
     'SELECT b.id FROM bill_political_classification c JOIN bill b ON b.id = c.bill_id LIMIT 1');

  /*
    בדיקה שהשאילתה עוברת אינה מספיקה — היא עברה גם כשהתוכן היה מיושן.
    כאן משווים ספירות מול המקור, כי זה מה שבאמת נשבר.
  */
  const src = new Database(SOURCE, { readonly: true });
  console.log('');
  console.log('השוואת ספירות מול knesset.db:');
  for (const t of ['bill_policy_analysis', 'bill_policy_issue', 'bill_political_classification']) {
    const a = (src.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    const b = (check.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    console.log(`  ${a === b ? '✓' : '✗'} ${t.padEnd(30)} ${a.toLocaleString()} → ${b.toLocaleString()}`);
  }
  src.close();
  check.close();
}

main();
