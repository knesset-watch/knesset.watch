/**
 * ציר חדש: הפללת ניהול כת פוגענית.
 *
 * ── למה ──────────────────────────────────────────────────────────────
 *
 * חיפוש אחר חקיקה בנושא פגיעה מינית טקסית מאורגנת החזיר אפס תוצאות
 * בעשרה ניסוחים שונים. הכלי החקיקתי קיים, אבל תחת שם אחר: חמש הצעות
 * "טיפול בכתות פוגעניות", שמגדירות כת פוגענית כ"ארגון המנצל יחסי
 * תלות או מצוקה ומבצע עבירות פשע, מין או אלימות חמורה".
 *
 * ארבע מהחמש מסווגות היום רק תחת "האם להחמיר ענישה על פגיעה בחסרי
 * ישע?" — ציר גנרי שתופס את המילה "פגיע" ומפספס את הנושא. אותו דפוס
 * בדיוק של טיפולי המרה שנקברו תחת בריאות הנפש.
 *
 * היוזמים חוצים ארבע סיעות: מירב בן ארי וקבוצה של שבעה מיש עתיד,
 * גלעד קריב מהעבודה, פנינה תמנו מכחול לבן, יואב סגלוביץ' מיש עתיד.
 *
 * ── על המחלוקת ───────────────────────────────────────────────────────
 *
 * הציר אינו "האם כתות זה רע". הוא על הסעיף המהותי שבהצעות: הפללת
 * העמידה בראש הכת כשלעצמה, בלי להוכיח מעורבות ישירה בכל עבירה
 * פרטנית. זה עוקף את הקושי הראייתי שמאפיין פגיעה מאורגנת, ובאותה
 * מידה חורג מעקרון ההפללה על מעשה. שני הצדדים אמיתיים.
 *
 * ── מה נשמר ──────────────────────────────────────────────────────────
 *
 * השיוכים הקיימים אינם נמחקים, בשונה מציר טיפולי המרה שבו השיוך
 * הקודם היה שגוי. כאן הם נכונים אך חלקיים: ההצעות אכן מחמירות ענישה
 * על פגיעה בחסרי ישע, ו-2202389 אכן עוסקת גם במאגר מידע ובתקציבי
 * בריאות הנפש. הציר החדש מתווסף ואינו מחליף.
 *
 *   npx tsx scripts/add-cult-abuse-axis.ts --dry-run
 *   npx tsx scripts/add-cult-abuse-axis.ts
 *   npx tsx scripts/add-cult-abuse-axis.ts --undo
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { MIN_BILLS_PER_ISSUE } from '../src/lib/canonical-agendas';

const DATA = path.join(process.cwd(), 'data/policy-analysis');
const CATALOG = path.join(DATA, 'axis-catalog.json');
const CLUSTERS = path.join(DATA, 'axis-clusters.json');
const DB_PATH = path.join(process.cwd(), 'knesset.db');

/** פשיעה, אכיפה וענישה — שם יושב היום הציר הגנרי שההצעות קבורות תחתיו */
const CLUSTER_ID = 'cl_014';
const AXIS_ID = 'ax_cult_abuse';

const dryRun = process.argv.includes('--dry-run');
const undo = process.argv.includes('--undo');

const AXIS = {
  issueId: AXIS_ID,
  topic: 'משפט, ממשל ודמוקרטיה',
  subtopic: 'כתות פוגעניות ופגיעה מאורגנת',
  axisIndex: 1,
  question: 'האם להפליל את ניהול הכת הפוגענית כעבירה עצמאית?',
  stances: [
    {
      id: `${AXIS_ID}_pro`,
      label: 'יש להפליל את ניהול הכת עצמו ולהקים מערך טיפול לנפגעים, ' +
             'משום שהקושי הראייתי מונע היום העמדה לדין של מי שעומד בראשה.',
    },
    {
      id: `${AXIS_ID}_con`,
      label: 'יש להסתפק בעבירות הקיימות, משום שהפללה על מעמד ולא על מעשה ' +
             'פוגעת בעקרונות המשפט הפלילי ובחופש הדת וההתאגדות.',
    },
  ],
};

/**
 * "כת" לבדו פסול: הוא נבלע ב"כתב", "מכתב", "לכת" ו-1,139 תוצאות
 * נוספות. רק הצירוף המלא נבדק.
 */
const TERMS = ['כת פוגענית', 'כתות פוגעניות', 'כתות פוגעניים'];

function findBills(db: Database.Database): Array<{ id: number; title: string }> {
  const where = TERMS.map(() =>
    '(b.title LIKE ? OR i.issue_candidate LIKE ? OR i.policy_change LIKE ?)').join(' OR ');
  return db.prepare(`
    SELECT DISTINCT b.id, b.title FROM bill b
    LEFT JOIN bill_policy_issue i ON i.bill_id = b.id
    WHERE ${where} ORDER BY b.id`)
    .all(...TERMS.flatMap(t => Array(3).fill(`%${t}%`))) as Array<{ id: number; title: string }>;
}

const readJson = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as Array<Record<string, unknown>>;
const writeJson = (f: string, v: unknown) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n');

function main(): void {
  const db = new Database(DB_PATH);

  if (undo) {
    const n = db.prepare('DELETE FROM bill_political_classification WHERE issue_id = ?').run(AXIS_ID).changes;
    writeJson(CATALOG, readJson(CATALOG).filter(a => a.issueId !== AXIS_ID));
    const cl = readJson(CLUSTERS);
    for (const c of cl) {
      if (c.clusterId !== CLUSTER_ID) continue;
      const members = (c.members as Array<Record<string, unknown>>).filter(m => m.issueId !== AXIS_ID);
      c.members = members;
      c.billCount = members.reduce((s, m) => s + Number(m.billCount ?? 0), 0);
    }
    writeJson(CLUSTERS, cl);
    console.log(`בוטל. ${n} שיוכים הוסרו והציר הוסר מהקטלוג ומהאשכול.`);
    db.close();
    return;
  }

  const bills = findBills(db);
  console.log(`הצעות חוק על כתות פוגעניות: ${bills.length}\n`);
  for (const b of bills) {
    const init = db.prepare(`SELECT p.first_name||' '||p.last_name AS n, p.faction_name AS f
      FROM bill_initiator bi JOIN mk_person p ON p.person_id = bi.mk_id WHERE bi.bill_id = ?`)
      .all(b.id) as Array<{ n: string; f: string }>;
    console.log(`  ${b.id}  ${b.title.slice(0, 54)}`);
    console.log(`          ${init.map(x => `${x.n} (${x.f})`).join(', ').slice(0, 96) || '—'}`);
  }

  /*
    הסף אינו מועתק כמספר. בהרצה קודמת נוצרו עשרה צירים עם ארבע הצעות
    שנכתבו למסד ולא הופיעו בשאלון כלל.
  */
  if (bills.length < MIN_BILLS_PER_ISSUE) {
    console.error(`\n✗ ${bills.length} הצעות, והסף הוא ${MIN_BILLS_PER_ISSUE}. הציר לא יוצג בשאלון. עוצר.`);
    db.close();
    process.exit(1);
  }

  const kept = db.prepare(`SELECT COUNT(*) AS n FROM bill_political_classification
    WHERE bill_id IN (${bills.map(() => '?').join(',')})`).get(...bills.map(b => b.id)) as { n: number };
  console.log(`\nשיוכים קיימים שנשמרים לצד החדש: ${kept.n}`);

  if (dryRun) { console.log('\n--dry-run — לא נכתב דבר.'); db.close(); return; }

  const cat = readJson(CATALOG);
  if (cat.some(a => a.issueId === AXIS_ID)) { console.error('✗ הציר כבר קיים. --undo קודם.'); db.close(); process.exit(1); }
  writeJson(CATALOG, [...cat, {
    ...AXIS, billCount: bills.length, poolSize: bills.length, covered: bills.length,
  }]);

  const cl = readJson(CLUSTERS);
  const cluster = cl.find(c => c.clusterId === CLUSTER_ID);
  if (!cluster) { console.error(`✗ האשכול ${CLUSTER_ID} לא קיים.`); db.close(); process.exit(1); }
  const members = cluster.members as Array<Record<string, unknown>>;
  members.push({
    issueId: AXIS_ID, originalKeyword: 'הפללת ניהול כת פוגענית',
    subtopic: AXIS.subtopic, question: AXIS.question, billCount: bills.length,
  });
  cluster.billCount = members.reduce((s, m) => s + Number(m.billCount ?? 0), 0);
  writeJson(CLUSTERS, cl);

  /*
    כל החמש מפלילות את ניהול הכת, ולכן כולן בצד ה"בעד". זה נבדק בגוף
    ההצעות ולא הונח משמן: כל אחת קובעת עבירה עצמאית של עשר שנות מאסר.
  */
  db.transaction(() => {
    for (const b of bills) {
      db.prepare(`INSERT OR IGNORE INTO bill_political_classification (bill_id, issue_id, stance_id)
                  VALUES (?, ?, ?)`).run(b.id, AXIS_ID, `${AXIS_ID}_pro`);
    }
  })();

  const n = db.prepare('SELECT COUNT(*) AS n FROM bill_political_classification WHERE issue_id = ?')
    .get(AXIS_ID) as { n: number };
  console.log(`\n✓ הציר נוסף לאשכול "${cluster.label}". ${n.n} הצעות שויכו.`);
  console.log(`  ${AXIS.question}`);
  console.log('\nלביטול: npx tsx scripts/add-cult-abuse-axis.ts --undo');
  db.close();
}

main();
