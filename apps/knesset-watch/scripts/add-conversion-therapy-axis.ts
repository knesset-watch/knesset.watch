/**
 * ציר חדש: איסור טיפולי המרה.
 *
 * ── למה ──────────────────────────────────────────────────────────────
 *
 * במדגם איכות שדינה ביקשה, הצעת חוק איסור טיפול המרה שויכה לציר
 * "האם לחזק את זכויות ואוטונומיית מתמודדי הנפש?". הכיוון נכון אבל
 * הציר אינו: טיפולי המרה הם סוגיה של זכויות להט"ב, לא של בריאות
 * הנפש. המודל נתפס למילה "טיפול" ולהקשר הנפשי.
 *
 * הבדיקה גילתה שזו אינה תקלה נקודתית: יש עשר הצעות חוק על טיפולי
 * המרה, תשע מהן אינן מסווגות כלל, והיוזמים חוצים כמעט את כל
 * האופוזיציה — מיכל שיר סגמן, נעמה לזימי, יסמין פרידמן, מירב כהן,
 * מרב מיכאלי, מיקי לוי, אפרת רייטן, גלעד קריב, עידן רול, איתן
 * גינזבורג. אשכול מלוכד עם מחלוקת פוליטית ברורה, ובלי בית.
 *
 * בטקסונומיה של 166 הצירים אין אף ציר לזכויות להט"ב. הקרוב ביותר
 * הוא "האם לפתוח את מסגרות האימוץ וההורות לכולם?", וגם הוא אינו זה.
 *
 * ── מה הסקריפט עושה ──────────────────────────────────────────────────
 *
 *   1. מוסיף ציר ל-axis-catalog.json — שם, שאלה, ושתי עמדות.
 *   2. מוסיף אותו לאשכול ב-axis-clusters.json כדי שיופיע בשאלון.
 *   3. משייך את עשר ההצעות אליו, ומסיר את השיוך השגוי הקודם.
 *
 *   npx tsx scripts/add-conversion-therapy-axis.ts --dry-run
 *   npx tsx scripts/add-conversion-therapy-axis.ts
 *   npx tsx scripts/add-conversion-therapy-axis.ts --undo
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA = path.join(process.cwd(), 'data/policy-analysis');
const CATALOG = path.join(DATA, 'axis-catalog.json');
const CLUSTERS = path.join(DATA, 'axis-clusters.json');
const DB_PATH = path.join(process.cwd(), 'knesset.db');

const dryRun = process.argv.includes('--dry-run');
const undo = process.argv.includes('--undo');

const AXIS_ID = 'ax_conversion_therapy';

/*
  הניסוח נשמר ניטרלי: שני הצדדים מנוסחים כעמדה לגיטימית, כפי שנעשה
  בכל 166 הצירים האחרים. השאלה שואלת על האיסור ולא על התופעה, כי זה
  מה שהחקיקה בפועל מציעה.
*/
const AXIS = {
  issueId: AXIS_ID,
  topic: 'עבודה, זכויות ושוויון',
  subtopic: 'זכויות פרט וקהילת להט"ב',
  axisIndex: 1,
  question: 'האם לאסור בחוק טיפולי המרה?',
  stances: [
    {
      id: `${AXIS_ID}_pro`,
      label: 'יש לאסור טיפולי המרה ולהטיל סנקציות על מי שמבצע אותם, ' +
             'משום שהם פוגעים בקטינים ובזהותם ואינם מבוססים מדעית.',
    },
    {
      id: `${AXIS_ID}_con`,
      label: 'יש להותיר את ההכרעה למטופל, למשפחתו ולשיקול הדעת המקצועי, ' +
             'ולהימנע מהתערבות המחוקק בתוכן הטיפול הנפשי.',
    },
  ],
  billCount: 0,
  poolSize: 0,
  covered: 0,
};

const CLUSTER = {
  clusterId: 'cl_lgbt_rights',
  topic: AXIS.topic,
  label: 'זכויות קהילת להט"ב',
  billCount: 0,
  members: [{
    issueId: AXIS_ID,
    originalKeyword: 'איסור טיפולי המרה',
    subtopic: AXIS.subtopic,
    question: AXIS.question,
    billCount: 0,
  }],
};

/** ביטויים חד-משמעיים בלבד. "להט" לבדו תופס את "להטיל" ו"להטבות". */
const TERMS = ['טיפולי המרה', 'טיפול המרה', 'טיפולי ההמרה'];

function findBills(db: Database.Database): Array<{ id: number; title: string }> {
  const where = TERMS.map(() =>
    `(i.issue_candidate LIKE ? OR i.policy_change LIKE ? OR b.title LIKE ?)`).join(' OR ');
  const args = TERMS.flatMap(t => [`%${t}%`, `%${t}%`, `%${t}%`]);
  return db.prepare(`
    SELECT DISTINCT b.id, b.title FROM bill_policy_issue i
    JOIN bill b ON b.id = i.bill_id WHERE ${where} ORDER BY b.id`).all(...args) as Array<{ id: number; title: string }>;
}

function main(): void {
  const db = new Database(DB_PATH);

  if (undo) {
    const n = db.prepare('DELETE FROM bill_political_classification WHERE issue_id = ?').run(AXIS_ID).changes;
    const cat = JSON.parse(fs.readFileSync(CATALOG, 'utf8')) as Array<Record<string, unknown>>;
    fs.writeFileSync(CATALOG, JSON.stringify(cat.filter(a => a.issueId !== AXIS_ID), null, 2) + '\n');
    const cl = JSON.parse(fs.readFileSync(CLUSTERS, 'utf8')) as Array<Record<string, unknown>>;
    fs.writeFileSync(CLUSTERS, JSON.stringify(cl.filter(c => c.clusterId !== CLUSTER.clusterId), null, 2) + '\n');
    console.log(`בוטל. הוסרו ${n} שיוכים, והציר הוסר משני הקבצים.`);
    db.close();
    return;
  }

  const bills = findBills(db);
  console.log(`הצעות חוק על טיפולי המרה: ${bills.length}`);
  for (const b of bills) console.log(`  ${b.id}  ${b.title.slice(0, 58)}`);

  // השיוך השגוי הקודם — לציר של מתמודדי הנפש
  const wrong = db.prepare(`
    SELECT bill_id, issue_id FROM bill_political_classification
    WHERE bill_id IN (${bills.map(() => '?').join(',')})`).all(...bills.map(b => b.id)) as Array<Record<string, string | number>>;
  if (wrong.length) {
    console.log(`\nשיוכים קיימים שיוסרו: ${wrong.length}`);
    for (const w of wrong) console.log(`  ${w.bill_id} → ${w.issue_id}`);
  }

  if (dryRun) { console.log('\n--dry-run — לא נכתב דבר.'); db.close(); return; }

  // ── הקבצים ──
  const cat = JSON.parse(fs.readFileSync(CATALOG, 'utf8')) as Array<Record<string, unknown>>;
  if (cat.some(a => a.issueId === AXIS_ID)) { console.error('✗ הציר כבר קיים. --undo קודם.'); db.close(); process.exit(1); }
  const axis = { ...AXIS, billCount: bills.length, poolSize: bills.length, covered: bills.length };
  fs.writeFileSync(CATALOG, JSON.stringify([...cat, axis], null, 2) + '\n');

  const cl = JSON.parse(fs.readFileSync(CLUSTERS, 'utf8')) as Array<Record<string, unknown>>;
  const cluster = {
    ...CLUSTER,
    billCount: bills.length,
    members: [{ ...CLUSTER.members[0], billCount: bills.length }],
  };
  fs.writeFileSync(CLUSTERS, JSON.stringify([...cl, cluster], null, 2) + '\n');

  // ── השיוך ──
  const tx = db.transaction(() => {
    for (const b of bills) {
      db.prepare('DELETE FROM bill_political_classification WHERE bill_id = ?').run(b.id);
      /*
        כל העשר אוסרות טיפולי המרה, ולכן כולן בצד ה"בעד" של הציר.
        זה אינו ניחוש: שם החוק עצמו הוא "איסור טיפול המרה".
      */
      db.prepare(`INSERT INTO bill_political_classification (bill_id, issue_id, stance_id)
                  VALUES (?, ?, ?)`).run(b.id, AXIS_ID, `${AXIS_ID}_pro`);
    }
  });
  tx();

  const n = db.prepare('SELECT COUNT(*) AS n FROM bill_political_classification WHERE issue_id = ?').get(AXIS_ID) as { n: number };
  console.log(`\n✓ הציר נוסף. ${n.n} הצעות שויכו אליו.`);
  console.log(`  ${AXIS.question}`);
  console.log(`    בעד: ${AXIS.stances[0].label.slice(0, 70)}`);
  console.log(`    נגד: ${AXIS.stances[1].label.slice(0, 70)}`);
  console.log('\nלביטול: npx tsx scripts/add-conversion-therapy-axis.ts --undo');
  db.close();
}

main();
