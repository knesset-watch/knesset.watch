/**
 * מיזוג ההצעות שהוחזרו לטבלה שהאתר קורא ממנה.
 *
 * עד עכשיו הן ישבו ב-bill_political_classification_rescued ולא השפיעו
 * על כלום. המיזוג מכניס אותן ל-bill_political_classification, ומרגע
 * זה הן נספרות בדירוג שמשתמשות רואות.
 *
 * הפיך: הטבלה הנפרדת נשארת ומשמשת רשומה מדויקת של מה נוסף, ולכן
 * --undo מוחק בדיוק את השורות האלה ולא נוגע בשום דבר אחר.
 *
 *   npx tsx scripts/merge-rescued.ts --dry-run   מודד את ההשפעה
 *   npx tsx scripts/merge-rescued.ts             ממזג
 *   npx tsx scripts/merge-rescued.ts --undo      מבטל
 */

import Database from 'better-sqlite3';
import path from 'path';
import { CLUSTER_TOPICS } from '../src/lib/axis-clusters';
import { computeAgendaActivity } from '../src/lib/agenda-activity';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const MAIN = 'bill_political_classification';
const RESCUED = 'bill_political_classification_rescued';

const dryRun = process.argv.includes('--dry-run');
const undo = process.argv.includes('--undo');

/** התוצאות של כל נושא-על, לפני ואחרי */
function snapshot(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const t of CLUSTER_TOPICS) {
    const sel = t.clusters.flatMap(c => c.questions).map(q => ({ issueId: q.issueId, stanceId: q.stances[0]?.id }));
    const r = computeAgendaActivity(sel);
    out.set(t.label, r.rows.slice(0, 10).map(x => x.name));
  }
  return out;
}

function main(): void {
  const db = new Database(DB_PATH);

  const has = db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?`).get(RESCUED) as { n: number };
  if (!has.n) { console.error(`✗ ${RESCUED} לא קיימת. הריצי קודם apply-orphan-rescue.ts`); db.close(); process.exit(1); }

  if (undo) {
    const before = (db.prepare(`SELECT COUNT(*) AS n FROM ${MAIN}`).get() as { n: number }).n;
    /*
      נמחקות רק שורות שקיימות בטבלה הנפרדת עם אותו צמד. אם מישהו הוסיף
      בינתיים סיווג אנושי לאותו חוק ואותו ציר, הוא יימחק גם — ולכן
      המחיקה מדווחת כמה הסירה, ולא מניחה.
    */
    const n = db.prepare(`
      DELETE FROM ${MAIN} WHERE (bill_id, issue_id) IN
        (SELECT bill_id, issue_id FROM ${RESCUED})`).run().changes;
    console.log(`הוסרו ${n} שורות. ${MAIN}: ${before.toLocaleString()} → ${(before - n).toLocaleString()}`);
    console.log(`${RESCUED} נשארה כרשומה.`);
    db.close();
    return;
  }

  const rescued = db.prepare(`SELECT COUNT(*) AS rows, COUNT(DISTINCT bill_id) AS bills FROM ${RESCUED}`).get() as Record<string, number>;
  const mainBefore = db.prepare(`SELECT COUNT(*) AS rows, COUNT(DISTINCT bill_id) AS bills FROM ${MAIN}`).get() as Record<string, number>;

  console.log(`${MAIN}  : ${mainBefore.bills.toLocaleString()} הצעות · ${mainBefore.rows.toLocaleString()} שורות`);
  console.log(`${RESCUED}: ${rescued.bills.toLocaleString()} הצעות · ${rescued.rows.toLocaleString()} שורות\n`);

  const overlap = db.prepare(`
    SELECT COUNT(*) AS n FROM ${RESCUED} r
    WHERE EXISTS (SELECT 1 FROM ${MAIN} m WHERE m.bill_id = r.bill_id AND m.issue_id = r.issue_id)`).get() as { n: number };
  if (overlap.n) { console.error(`✗ ${overlap.n} שורות כבר קיימות. עוצר.`); db.close(); process.exit(1); }
  console.log('✓ אין חפיפה\n');

  console.log('מודד דירוגים לפני...');
  const before = snapshot();

  const applied = db.transaction(() => {
    db.prepare(`INSERT INTO ${MAIN} (bill_id, issue_id, stance_id)
                SELECT bill_id, issue_id, stance_id FROM ${RESCUED}`).run();
  });
  applied();

  console.log('מודד דירוגים אחרי...\n');
  const after = snapshot();

  console.log('═══ מה זז בעשירייה הראשונה ═══');
  let totalMoved = 0;
  for (const [topic, oldTop] of before) {
    const newTop = after.get(topic) ?? [];
    const left = oldTop.filter(n => !newTop.includes(n));
    const joined = newTop.filter(n => !oldTop.includes(n));
    totalMoved += joined.length;
    const same = oldTop.filter((n, i) => newTop[i] === n).length;
    console.log(`\n  ${topic}`);
    console.log(`    נשארו במקומם: ${same}/10`);
    if (joined.length) console.log(`    נכנסו : ${joined.join(', ')}`);
    if (left.length)   console.log(`    יצאו  : ${left.join(', ')}`);
    if (!joined.length && !left.length) console.log('    ללא שינוי בהרכב');
  }

  const mainAfter = db.prepare(`SELECT COUNT(*) AS rows, COUNT(DISTINCT bill_id) AS bills FROM ${MAIN}`).get() as Record<string, number>;
  console.log(`\n═══ סיכום ═══`);
  console.log(`  ${MAIN}: ${mainBefore.bills.toLocaleString()} → ${mainAfter.bills.toLocaleString()} הצעות  (+${(mainAfter.bills - mainBefore.bills).toLocaleString()})`);
  console.log(`  שמות חדשים בעשיריות: ${totalMoved}`);

  if (dryRun) {
    // ב-dry-run מחזירים את המצב לקדמותו; המדידה דרשה כתיבה זמנית
    db.prepare(`DELETE FROM ${MAIN} WHERE (bill_id, issue_id) IN (SELECT bill_id, issue_id FROM ${RESCUED})`).run();
    console.log('\n--dry-run — השינוי בוטל, המסד כמו שהיה.');
  } else {
    console.log('\nלביטול: npx tsx scripts/merge-rescued.ts --undo');
  }
  db.close();
}

main();
