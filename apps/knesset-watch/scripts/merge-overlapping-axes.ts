/**
 * מיזוג צירים חופפים, לפי ההכרעות על 14 הזוגות שפס א מצא.
 *
 *   npx tsx scripts/merge-overlapping-axes.ts --dry    מה יקרה, בלי לכתוב
 *   npx tsx scripts/merge-overlapping-axes.ts          ביצוע
 *
 * ── למה מיזוג ולא הסרה ────────────────────────────────────────────
 *
 * הצירים בכל זוג נראים כפולים בניסוח, אבל לא בנתונים: בכל 14 הזוגות
 * יותר מ-60% מהצעות הציר הקטן אינן מסווגות גם לגדול, חציון 93%,
 * ובשלושה זוגות 100%. הסרה פשוטה הייתה מוציאה מאות הצעות מהשאלון.
 *
 * לכן הסיווגים עוברים לציר שנשאר, והציר שרוקן יוצא מהשאלון.
 *
 * ── היפוך עמדות ───────────────────────────────────────────────────
 *
 * זוג אחד מהעשרה הוא זוג הפוך ולא כפול: "להחמיר את הפיקוח במערכת
 * הבריאות" מול "להקל בדרישות הרגולטוריות". שני הצירים הם קוטב אחד
 * של אותה שאלה, ולכן ההעברה הופכת את העמדה — מי שתמך בהקלה נספר
 * כמתנגד להחמרה. בלי ההיפוך המיזוג היה מקלקל 46 הצעות במקום לתקן.
 *
 * ── מה נשאר בחוץ ──────────────────────────────────────────────────
 *
 * שני זוגות נדחו להמשך ולא נוגעים כאן: "עסקים ותחרות במשק", שצריך
 * להתפצל לתחומים כמו הגנה על בריאות הציבור ושמירה על תחרות, ו"סמכויות
 * משטרה מול זכויות נאשמים", שמכיל תתי-נושאים כמו שיפוט צבאי.
 *
 * שני זוגות נוספים מקבלים ניסוח מבדיל ולא מיזוג, כי ההבחנה ביניהם
 * אמיתית: קצבאות (מי זכאי מול כמה משלמים), ומינויים בכירים.
 *
 * המסד אינו בגיט. הסקריפט הזה הוא התיעוד היחיד של מה שנעשה בו, ולכן
 * הוא חוזר על עצמו בבטחה: הרצה שנייה לא תמצא מה להעביר.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

/**
 * --db=knesset-deploy.db חייב לרוץ גם הוא.
 *
 * הפרודקשן אינו קורא את knesset.db אלא את knesset-deploy.db, קובץ נפרד
 * שנמצא בגיט. בלי הרצה שנייה עליו השאלון היה מציג 210 היגדים בעוד
 * הדירוג מחושב על הסיווגים הישנים — לא קריסה, אלא מספרים שגויים בשקט.
 *
 * קובצי ה-JSON מתעדכנים רק בהרצה על המסד הראשי, כדי שלא ייכתבו פעמיים.
 */
const DB_ARG = process.argv.find(a => a.startsWith('--db='));
const DB_FILE = DB_ARG ? DB_ARG.split('=')[1] : 'knesset.db';
const DB_PATH = path.join(process.cwd(), DB_FILE);
const IS_PRIMARY = DB_FILE === 'knesset.db';
const DATA_DIR = path.join(process.cwd(), 'data', 'policy-analysis');
const DRY = process.argv.includes('--dry');

interface Merge {
  pair: number;
  keep: string;
  drop: string;
  /** זוג הפוך: pro של הציר שמתרוקן הופך ל-con של הנשאר */
  invert?: boolean;
  /** הצעות שנשארות בציר המתרוקן ואינן עוברות */
  except?: number[];
  note: string;
}

const MERGES: Merge[] = [
  { pair: 1, keep: 'ax_c6c000cb74', drop: 'ax_fdc1475368', note: 'החמרת ענישה — הפיצול היה שרירותי' },
  { pair: 2, keep: 'ax_06d92ed369', drop: 'ax_eb27cc354e', note: 'חובות על עסקים להגנת הצרכן' },
  { pair: 3, keep: 'ax_cc00cc9cee', drop: 'ax_b270ff3560', note: 'מימון ציבורי של שירותי בריאות' },
  { pair: 6, keep: 'ax_1975be1d8c', drop: 'ax_958f04e784', note: 'תמיכה כלכלית ישירה' },
  { pair: 8, keep: 'ax_a1e872c1ff', drop: 'ax_597feede1e', invert: true, note: 'פיקוח במערכת הבריאות — זוג הפוך' },
  { pair: 9, keep: 'ax_0a2ba5871e', drop: 'ax_4a0f6a172d', note: 'הנצחה ממלכתית' },
  {
    pair: 10,
    keep: 'ax_91aaa85ddc',
    drop: 'ax_c787393d8f',
    note: 'פיקוח פרלמנטרי — חוץ מהצעת החסינות',
    /* חסינות חברי הכנסת היא סוגיה בפני עצמה ואינה פיקוח פרלמנטרי.
       ההצעה נשארת בציר המתרוקן וממתינה לציר ייעודי. */
    except: [],
  },
  { pair: 11, keep: 'ax_ff91aefa1a', drop: 'ax_432fd4e36c', note: 'סמכויות מול פרטיות' },
  { pair: 13, keep: 'ax_902dd2c7c0', drop: 'ax_bd07feaae6', note: 'הגנה על בעלי חיים' },
  { pair: 14, keep: 'ax_b357eb370b', drop: 'ax_63daad0a32', note: 'הגבלת סמכות בית המשפט' },
];

const db = new Database(DB_PATH);

/** מאתר את הצעת החסינות לפי הכותרת, כדי שלא נסמוך על מזהה שנכתב ביד */
function resolveExceptions() {
  const m = MERGES.find(x => x.pair === 10)!;
  const rows = db
    .prepare(
      `SELECT a.bill_id id, b.title t FROM bill_political_classification a
       JOIN bill b ON b.id = a.bill_id WHERE a.issue_id = ? AND b.title LIKE '%חסינות%'`,
    )
    .all(m.drop) as Array<{ id: number; t: string }>;
  m.except = rows.map(r => r.id);
  for (const r of rows) console.log(`  זוג 10 · נשארת בציר המתרוקן: ${r.t.slice(0, 70)}`);
}

const stanceOf = (issueId: string, suffix: 'pro' | 'con') => `${issueId}_${suffix}`;

function suffixOf(stanceId: string | null): 'pro' | 'con' | null {
  if (!stanceId) return null;
  if (stanceId.endsWith('_pro')) return 'pro';
  if (stanceId.endsWith('_con')) return 'con';
  return null;
}

function run() {
  console.log(`${DRY ? 'הרצה יבשה' : 'ביצוע'} · ${MERGES.length} מיזוגים · ${DB_FILE}\n`);
  resolveExceptions();
  console.log('');

  const before = (db.prepare('SELECT COUNT(*) n FROM bill_political_classification').get() as { n: number }).n;
  let moved = 0;
  let collided = 0;
  let flipped = 0;

  const tx = db.transaction(() => {
    for (const m of MERGES) {
      const rows = db
        .prepare('SELECT bill_id, stance_id FROM bill_political_classification WHERE issue_id = ?')
        .all(m.drop) as Array<{ bill_id: number; stance_id: string | null }>;

      const except = new Set(m.except ?? []);
      let mMoved = 0;
      let mCollided = 0;

      for (const row of rows) {
        if (except.has(row.bill_id)) continue;

        const exists = db
          .prepare('SELECT 1 FROM bill_political_classification WHERE bill_id = ? AND issue_id = ?')
          .get(row.bill_id, m.keep);

        if (exists) {
          /* ההצעה כבר מסווגת לציר שנשאר. הסיווג הקיים גובר, והשורה
             הכפולה נמחקת — מפתח ראשי (bill_id, issue_id) ממילא אוסר שתיהן. */
          if (!DRY) db.prepare('DELETE FROM bill_political_classification WHERE bill_id = ? AND issue_id = ?').run(row.bill_id, m.drop);
          mCollided++;
          continue;
        }

        let suffix = suffixOf(row.stance_id);
        if (m.invert && suffix) {
          suffix = suffix === 'pro' ? 'con' : 'pro';
          flipped++;
        }
        const newStance = suffix ? stanceOf(m.keep, suffix) : null;

        if (!DRY) {
          db.prepare('UPDATE bill_political_classification SET issue_id = ?, stance_id = ? WHERE bill_id = ? AND issue_id = ?')
            .run(m.keep, newStance, row.bill_id, m.drop);
        }
        mMoved++;
      }

      moved += mMoved;
      collided += mCollided;
      console.log(
        `זוג ${String(m.pair).padStart(2)} · ${m.drop} → ${m.keep}` +
          `${m.invert ? '  [היפוך עמדות]' : ''}\n` +
          `         ${mMoved} הועברו · ${mCollided} כבר היו שם · ${m.note}`,
      );
    }
  });

  tx();

  const after = (db.prepare('SELECT COUNT(*) n FROM bill_political_classification').get() as { n: number }).n;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`שורות סיווג: ${before} → ${after}  (${before - after} כפילויות הוסרו)`);
  console.log(`הועברו: ${moved} · התנגשויות: ${collided} · עמדות שהופכו: ${flipped}`);

  const leftovers = MERGES.map(m => ({
    drop: m.drop,
    n: (db.prepare('SELECT COUNT(*) n FROM bill_political_classification WHERE issue_id = ?').get(m.drop) as { n: number }).n,
  })).filter(x => x.n > 0);
  console.log(
    leftovers.length === 0
      ? 'כל הצירים שרוקנו ריקים.'
      : 'נשארו סיווגים: ' + leftovers.map(x => `${x.drop}=${x.n}`).join(', ') + '  (צפוי רק בזוג 10)',
  );

  if (DRY) {
    console.log('\nהרצה יבשה — לא נכתב דבר.');
    return;
  }

  if (!IS_PRIMARY) {
    console.log(`\n${DB_FILE} עודכן. קובצי ה-JSON לא נגעו — הם מתעדכנים רק בהרצה על המסד הראשי.`);
    return;
  }

  // ── הסרת הצירים שרוקנו משלושת הקבצים, ועדכון billCount ─────────
  const dropped = new Set(MERGES.map(m => m.drop));
  const countOf = db.prepare('SELECT COUNT(*) n FROM bill_political_classification WHERE issue_id = ?');

  const catPath = path.join(DATA_DIR, 'axis-catalog.json');
  const cat = JSON.parse(fs.readFileSync(catPath, 'utf8')) as Array<Record<string, unknown>>;
  const catKept = cat.filter(a => !dropped.has(a.issueId as string));
  for (const a of catKept) a.billCount = (countOf.get(a.issueId as string) as { n: number }).n;
  fs.writeFileSync(catPath, JSON.stringify(catKept, null, 2));

  const clPath = path.join(DATA_DIR, 'axis-clusters.json');
  const clusters = JSON.parse(fs.readFileSync(clPath, 'utf8')) as Array<{
    members: Array<Record<string, unknown>>;
    billCount: number;
  }>;
  for (const c of clusters) {
    c.members = c.members.filter(m => !dropped.has(m.issueId as string));
    for (const m of c.members) m.billCount = (countOf.get(m.issueId as string) as { n: number }).n;
    c.billCount = c.members.reduce((s, m) => s + (m.billCount as number), 0);
  }
  fs.writeFileSync(clPath, JSON.stringify(clusters, null, 2));

  const kwPath = path.join(DATA_DIR, 'axis-keywords.json');
  const kw = (JSON.parse(fs.readFileSync(kwPath, 'utf8')) as Array<Record<string, unknown>>).filter(
    k => !dropped.has(k.issueId as string),
  );
  for (const k of kw) k.billCount = (countOf.get(k.issueId as string) as { n: number }).n;
  fs.writeFileSync(kwPath, JSON.stringify(kw, null, 2));

  console.log(`\nצירים: ${cat.length} → ${catKept.length}`);
  console.log(`חברי אשכולות: ${clusters.reduce((s, c) => s + c.members.length, 0)}`);
  console.log('שלושת הקבצים עודכנו, כולל billCount.');
}

run();
db.close();
