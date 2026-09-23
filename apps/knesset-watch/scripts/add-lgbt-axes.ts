/**
 * שני צירים נוספים באשכול זכויות להט"ב.
 *
 * ── למה ──────────────────────────────────────────────────────────────
 *
 * סריקת התחום מצאה 27 הצעות חוק שעוסקות בהגנה על נטייה מינית וזהות
 * מגדרית, והן נחלקות לשתי שאלות מדיניות שונות:
 *
 *   19  איסור הפליה — תעסוקה, מוצרים, שירותים, חינוך, חוק-יסוד
 *    8  פשעי שנאה   — עבירות פליליות ותגמולים לנפגעים
 *
 * לא איחדתי אותן. מי שתומכת בעיגון איסור הפליה בתעסוקה לא בהכרח
 * תומכת בהגדרת קבוצת נפגעים נפרדת בחוק העונשין, וזו בדיוק ההבחנה
 * שהשאלון אמור למדוד.
 *
 * ── מה כבר קיים ואיננו נוגעים בו ─────────────────────────────────────
 *
 * שש מההצעות כבר משויכות לציר "האם להחמיר אכיפה וענישה נגד הפליה
 * במקומות ציבוריים?". זה שיוך נכון וגם החדש נכון: האחד על חומרת
 * האכיפה, השני על העילות המוגנות. שיוך כפול נשמר בכוונה, בשונה
 * מציר טיפולי המרה שבו השיוך הקודם היה פשוט שגוי.
 *
 * יוצא דופן אחד: 2205142, "הגדרת פשע שנאה", משויך היום ל"הרחבת הגנה
 * מפני הטרדות מיניות". זו אותה מלכודת של טיפולי המרה — המודל נתפס
 * ל"מין" ו"מיניות". השיוך הזה מוסר.
 *
 * ── הערה על הצד ──────────────────────────────────────────────────────
 *
 * כל 27 ההצעות בכיוון אחד: הרחבת ההגנה. גם שתיים שנראו מגבילות
 * מגבילות הסתה ושנאה, כלומר גם הן מגינות. הצירים בכל זאת דו-צדדיים,
 * כמו כל השאר, כי העמדה הנגדית לגיטימית וקיימת בשיח. המחיר שצריך
 * לדעת עליו: מי שתבחר בעמדה הנגדית לא תקבל אף ח"כ, כי בכנסת ה-25
 * לא הוגשה הצעה בכיוון הזה. זה נכון לנתונים ואינו באג.
 *
 *   npx tsx scripts/add-lgbt-axes.ts --dry-run
 *   npx tsx scripts/add-lgbt-axes.ts
 *   npx tsx scripts/add-lgbt-axes.ts --undo
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA = path.join(process.cwd(), 'data/policy-analysis');
const CATALOG = path.join(DATA, 'axis-catalog.json');
const CLUSTERS = path.join(DATA, 'axis-clusters.json');
const DB_PATH = path.join(process.cwd(), 'knesset.db');
const CLUSTER_ID = 'cl_lgbt_rights';
const TOPIC = 'עבודה, זכויות ושוויון';
const SUBTOPIC = 'זכויות פרט וקהילת להט"ב';

const dryRun = process.argv.includes('--dry-run');
const undo = process.argv.includes('--undo');

/**
 * שיוך קיים שגוי שיוסר — נבדק אחד-אחד ולא נמחק בגורף.
 *
 * מזהי הצירים הם גיבוב ולא שם קריא, ולכן אי אפשר לנחש אותם מהשאלה.
 * ניסיון ראשון כאן היה ax_sexual_harassment_protection, שם שנראה
 * סביר ופשוט לא קיים — המחיקה הייתה מצליחה בשקט בלי למחוק כלום.
 * מכאן ואילך הסקריפט מוודא שהשורה קיימת לפני שהוא מדווח עליה.
 */
const WRONG = [{ billId: 2205142, issueId: 'ax_a9fb0eb99c' }];

/** עוצר אם שיוך שאמור להימחק איננו — עדיף כישלון רועש מדיווח כוזב */
function assertWrongRowsExist(db: Database.Database): void {
  for (const w of WRONG) {
    const row = db.prepare(`SELECT 1 FROM bill_political_classification
                            WHERE bill_id = ? AND issue_id = ?`).get(w.billId, w.issueId);
    if (!row) {
      console.error(`✗ השיוך ${w.billId} → ${w.issueId} לא קיים. הרשימה אינה מעודכנת.`);
      process.exit(1);
    }
  }
}

interface AxisDef {
  id: string;
  index: number;
  keyword: string;
  question: string;
  pro: string;
  con: string;
  /** הצעה נכנסת לציר אם היא עומדת בתנאי הזה */
  match: (title: string) => boolean;
}

/** פלילי ותגמולים — נבדק מול הכותרת, שהיא המדד היציב ביותר כאן */
const HATE = /שנאה|איבה|הסתה|גזענות/;

const AXES: AxisDef[] = [
  {
    id: 'ax_lgbt_antidiscrimination',
    index: 2,
    keyword: 'איסור הפליה על רקע נטייה מינית וזהות מגדרית',
    question: 'האם להרחיב את איסור ההפליה לנטייה מינית ולזהות מגדרית?',
    pro: 'יש לעגן במפורש בחוק איסור הפליה מחמת נטייה מינית וזהות מגדרית, ' +
         'ולהחיל אותו על תעסוקה, דיור, שירותים וחינוך.',
    con: 'יש להסתפק באיסורי ההפליה הקיימים ולהימנע מהרחבתם, ' +
         'כדי לשמור על חופש החוזים, חופש הביטוי וחופש המצפון.',
    match: (t) => !HATE.test(t),
  },
  {
    id: 'ax_lgbt_hate_crime',
    index: 3,
    keyword: 'פשעי שנאה על רקע נטייה מינית וזהות מגדרית',
    question: 'האם להכיר בפגיעה על רקע נטייה מינית כפשע שנאה?',
    pro: 'יש להכיר בפגיעה על רקע נטייה מינית וזהות מגדרית כפשע שנאה, ' +
         'להחמיר בענישה ולזכות את הנפגעים בתגמולים ובשיקום.',
    con: 'יש להימנע מהגדרת קבוצות נפגעים נפרדות בחוק העונשין, ' +
         'ולשפוט כל מעשה אלימות לפי חומרתו בלבד.',
    match: (t) => HATE.test(t),
  },
];

/**
 * ציר קיים שמקבל בית שני באשכול, בלי ציר חדש ובלי לגעת בשיוכי ההצעות.
 *
 * "האם לפתוח את מסגרות האימוץ וההורות לכולם?" יושב באשכול "משפחות
 * וילדים", ושייך לשם. אבל 13 מ-15 ההצעות שלו עוסקות בדיוק במחסומים
 * שחלים על זוגות חד-מיניים: "רק איש ואשתו כשירים לאמץ" שמוחלף ב"שני
 * בני אדם", רישום בן או בת זוג כהורה, הורה נוסף לילד מתרומת זרע,
 * והחלפת "אב" ו"אם" בטפסים.
 *
 * אף אחת מהן אינה מזכירה להט"ב במילה מפורשת. החקיקה מנוסחת בלשון
 * ניטרלית בכוונה, ולכן חיפוש מילות מפתח לא מוצא אותה — נקודה עיוורת
 * שכדאי לזכור בכל סריקה עתידית של התחום.
 *
 * הצגה בשני אשכולות בטוחה: העמדות נשמרות כאובייקט לפי issueId
 * (KeywordMatchClient שורה 173), ולכן הציר נספר פעם אחת בציון גם אם
 * הוא מוצג פעמיים.
 */
const SHARED = [{
  issueId: 'ax_74732862df',
  keyword: 'פתיחת האימוץ וההורות לכל מבנה משפחה',
  subtopic: SUBTOPIC,
  question: 'האם לפתוח את מסגרות האימוץ וההורות לכולם?',
  billCount: 15,
}];

/* שני תווי גרשיים בעברית; הנתונים מערבבים ביניהם */
const IDENTITY = ['נטייה מינית', 'נטיה מינית', 'זהות מגדרית', 'להט"ב', 'להט״ב'];
const PROTECTION = ['פליה', 'שנאה', 'שוויון ההזדמנויות'];

/**
 * שני התנאים חייבים להתקיים באותה שורת סוגיה, לא בשתי שורות שונות של
 * אותה הצעה. בלי זה הצעה שמזכירה להט"ב בהקשר אחד והפליה בהקשר אחר
 * הייתה נכנסת בטעות.
 */
function findBills(db: Database.Database): Array<{ id: number; title: string }> {
  const clause = (terms: string[]) => terms.map(() =>
    '(i.issue_candidate LIKE ? OR i.policy_change LIKE ? OR b.title LIKE ?)').join(' OR ');
  const args = (terms: string[]) => terms.flatMap(t => Array(3).fill(`%${t}%`));
  return db.prepare(`
    SELECT DISTINCT b.id, b.title FROM bill_policy_issue i JOIN bill b ON b.id = i.bill_id
    WHERE (${clause(IDENTITY)}) AND (${clause(PROTECTION)}) ORDER BY b.id`)
    .all(...args(IDENTITY), ...args(PROTECTION)) as Array<{ id: number; title: string }>;
}

function readJson(f: string): Array<Record<string, unknown>> {
  return JSON.parse(fs.readFileSync(f, 'utf8')) as Array<Record<string, unknown>>;
}
function writeJson(f: string, v: unknown): void {
  fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n');
}

function runUndo(db: Database.Database): void {
  let removed = 0;
  for (const a of AXES) {
    removed += db.prepare('DELETE FROM bill_political_classification WHERE issue_id = ?').run(a.id).changes;
  }
  const ids = new Set(AXES.map(a => a.id));
  /*
    מהקטלוג מוסרים רק הצירים החדשים. הציר המשותף נשאר — הוא לא נוצר
    כאן, ומחיקתו הייתה מוחקת ציר שהאשכול "משפחות וילדים" תלוי בו.
  */
  writeJson(CATALOG, readJson(CATALOG).filter(a => !ids.has(String(a.issueId))));

  const drop = new Set([...ids, ...SHARED.map(s => s.issueId)]);
  const cl = readJson(CLUSTERS);
  for (const c of cl) {
    if (c.clusterId !== CLUSTER_ID) continue;
    const members = (c.members as Array<Record<string, unknown>>).filter(m => !drop.has(String(m.issueId)));
    c.members = members;
    c.billCount = members.reduce((s, m) => s + Number(m.billCount ?? 0), 0);
  }
  writeJson(CLUSTERS, cl);

  /*
    השיוך הקודם של 2205142 מוחזר, כדי שהביטול יהיה באמת ביטול ולא
    יישאיר את ההצעה בלי שום ציר.
  */
  for (const w of WRONG) {
    db.prepare(`INSERT OR IGNORE INTO bill_political_classification (bill_id, issue_id, stance_id)
                VALUES (?, ?, ?)`).run(w.billId, w.issueId, `${w.issueId}_pro`);
  }
  console.log(`בוטל. ${removed} שיוכים הוסרו, שני הצירים הוסרו מהקטלוג ומהאשכול,`);
  console.log(`והשיוך הקודם של ${WRONG.map(w => w.billId).join(', ')} הוחזר.`);
}

function main(): void {
  const db = new Database(DB_PATH);

  if (undo) { runUndo(db); db.close(); return; }

  const bills = findBills(db);
  const buckets = AXES.map(a => ({ axis: a, bills: bills.filter(b => a.match(b.title)) }));
  const unmatched = bills.filter(b => !AXES.some(a => a.match(b.title)));

  console.log(`הצעות חוק בתחום: ${bills.length}\n`);
  for (const { axis, bills: bs } of buckets) {
    console.log(`═══ ${axis.question}  —  ${bs.length} ═══`);
    for (const b of bs) console.log(`  ${b.id}  ${b.title.slice(0, 56)}`);
    console.log('');
  }
  if (unmatched.length) {
    console.error(`✗ ${unmatched.length} הצעות לא נכנסו לאף ציר. עוצר.`);
    for (const b of unmatched) console.error(`  ${b.id}  ${b.title.slice(0, 56)}`);
    db.close();
    process.exit(1);
  }

  assertWrongRowsExist(db);
  const existing = db.prepare(`
    SELECT bill_id, issue_id FROM bill_political_classification
    WHERE bill_id IN (${bills.map(() => '?').join(',')})`)
    .all(...bills.map(b => b.id)) as Array<{ bill_id: number; issue_id: string }>;
  const kept = existing.filter(r =>
    !WRONG.some(w => w.billId === r.bill_id && w.issueId === r.issue_id));
  console.log(`שיוכים קיימים שנשמרים לצד החדשים: ${kept.length}`);
  for (const w of WRONG) console.log(`שיוך שגוי שיוסר: ${w.billId} → ${w.issueId}`);

  if (dryRun) { console.log('\n--dry-run — לא נכתב דבר.'); db.close(); return; }

  // ── הקטלוג ──
  const cat = readJson(CATALOG);
  const clash = AXES.find(a => cat.some(c => c.issueId === a.id));
  if (clash) { console.error(`✗ ${clash.id} כבר קיים. --undo קודם.`); db.close(); process.exit(1); }
  writeJson(CATALOG, [...cat, ...buckets.map(({ axis, bills: bs }) => ({
    issueId: axis.id, topic: TOPIC, subtopic: SUBTOPIC, axisIndex: axis.index,
    question: axis.question,
    stances: [{ id: `${axis.id}_pro`, label: axis.pro }, { id: `${axis.id}_con`, label: axis.con }],
    billCount: bs.length, poolSize: bs.length, covered: bs.length,
  }))]);

  // ── האשכול ──
  const cl = readJson(CLUSTERS);
  const cluster = cl.find(c => c.clusterId === CLUSTER_ID);
  if (!cluster) {
    console.error(`✗ האשכול ${CLUSTER_ID} לא קיים. הריצי קודם add-conversion-therapy-axis.ts`);
    db.close(); process.exit(1);
  }
  const members = cluster.members as Array<Record<string, unknown>>;
  for (const { axis, bills: bs } of buckets) {
    members.push({
      issueId: axis.id, originalKeyword: axis.keyword, subtopic: SUBTOPIC,
      question: axis.question, billCount: bs.length,
    });
  }
  /*
    הציר המשותף נוסף לאשכול בלבד. הוא כבר קיים בקטלוג ובאשכול אחר,
    וההצעות שלו כבר משויכות — כתיבה נוספת כאן הייתה משכפלת אותן.
  */
  for (const s of SHARED) {
    const inCatalog = cat.some(a => a.issueId === s.issueId);
    if (!inCatalog) {
      console.error(`✗ הציר המשותף ${s.issueId} לא קיים בקטלוג. עוצר.`);
      db.close(); process.exit(1);
    }
    members.push({ ...s, shared: true });
    console.log(`\nציר משותף נוסף לאשכול (בלי שינוי בשיוכים): ${s.question}`);
  }
  cluster.billCount = members.reduce((s, m) => s + Number(m.billCount ?? 0), 0);
  writeJson(CLUSTERS, cl);

  // ── השיוך ──
  db.transaction(() => {
    for (const w of WRONG) {
      db.prepare('DELETE FROM bill_political_classification WHERE bill_id = ? AND issue_id = ?')
        .run(w.billId, w.issueId);
    }
    for (const { axis, bills: bs } of buckets) {
      for (const b of bs) {
        db.prepare(`INSERT OR IGNORE INTO bill_political_classification (bill_id, issue_id, stance_id)
                    VALUES (?, ?, ?)`).run(b.id, axis.id, `${axis.id}_pro`);
      }
    }
  })();

  console.log('\n═══ נכתב ═══');
  for (const a of AXES) {
    const n = db.prepare('SELECT COUNT(*) AS n FROM bill_political_classification WHERE issue_id = ?')
      .get(a.id) as { n: number };
    console.log(`  ${String(n.n).padStart(3)}  ${a.question}`);
  }
  console.log(`\n  האשכול "${cluster.label}" מונה כעת ${members.length} צירים ו-${cluster.billCount} הצעות.`);
  console.log('\nלביטול: npx tsx scripts/add-lgbt-axes.ts --undo');
  db.close();
}

main();
