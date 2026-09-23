/**
 * החלת ההתאמות שנמצאו ב-match-orphans-to-axes, ברמת ביטחון גבוהה בלבד.
 *
 * ── למה רק "גבוה" ────────────────────────────────────────────────────
 *
 * במדגם של 100 נמצאו 39 התאמות: 28 בביטחון גבוה ו-11 בינוני. בדיקה
 * ידנית של שתי הרמות הראתה שההפרדה אמיתית — ארבע מארבע שנבדקו
 * ב"גבוה" היו נכונות, וב"בינוני" כשתיים מחמש היו רופפות.
 *
 * אחת מהן ממחישה למה הצד מסוכן לא פחות מהציר:
 *
 *   "תיעוד חזותי של השימוש במכת״זית לפיזור הפגנות" שויכה ל"האם
 *   להרחיב את סמכויות המשטרה?" — אבל ההצעה מגבילה את המשטרה.
 *   הציר נכון והצד הפוך, ושיוך כזה מזכה ח"כ על עמדה שהתנגד לה.
 *
 * שיוך שגוי גרוע מאי-שיוך: הוא מוסיף לח"כ עבודה שלא עשה. לכן
 * "בינוני" נשאר בחוץ, גם במחיר של כ-150 הצעות שיישארו יתומות.
 *
 * ── מה נכתב ──────────────────────────────────────────────────────────
 *
 * לטבלה הראשית, עם רשומה מדויקת ב-JSONL כדי ש---undo ימחק בדיוק את
 * מה שנוסף. השיוכים הקיימים של אותן הצעות אינם נמחקים — הצעה יתומה
 * אין לה שיוכים קיימים מלכתחילה.
 *
 *   npx tsx scripts/apply-orphan-matches.ts --plan
 *   npx tsx scripts/apply-orphan-matches.ts
 *   npx tsx scripts/apply-orphan-matches.ts --undo
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { CLUSTERS } from '../src/lib/axis-clusters';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const MATCHES = path.join(process.cwd(), 'orphan-matches.jsonl');
const SIDES = path.join(process.cwd(), 'orphan-sides.jsonl');
const APPLIED = path.join(process.cwd(), 'orphan-matches-applied.jsonl');

const plan = process.argv.includes('--plan');
const undo = process.argv.includes('--undo');

/** רק זה נכתב. ראה הנימוק בראש הקובץ. */
const ACCEPT = 'high';

interface Match {
  billId: number; issueId: string | null; side: string | null;
  confidence?: string; why?: string;
}

function main(): void {
  const db = new Database(DB_PATH);

  if (undo) {
    if (!fs.existsSync(APPLIED)) { console.log('אין מה לבטל.'); db.close(); return; }
    let n = 0;
    db.transaction(() => {
      for (const line of fs.readFileSync(APPLIED, 'utf8').split('\n').filter(Boolean)) {
        const m = JSON.parse(line) as { billId: number; issueId: string };
        n += db.prepare('DELETE FROM bill_political_classification WHERE bill_id = ? AND issue_id = ?')
          .run(m.billId, m.issueId).changes;
      }
    })();
    fs.rmSync(APPLIED);
    console.log(`בוטל. ${n} שיוכים הוסרו.`);
    db.close();
    return;
  }

  if (!fs.existsSync(MATCHES)) {
    console.error(`✗ ${path.basename(MATCHES)} לא קיים. הריצי קודם match-orphans-to-axes.ts --all`);
    db.close(); process.exit(1);
  }

  const all = fs.readFileSync(MATCHES, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Match);
  const matched = all.filter(m => m.issueId && m.side);
  const high = matched.filter(m => m.confidence === ACCEPT);
  const rest = matched.filter(m => m.confidence !== ACCEPT);

  console.log(`נבדקו   : ${all.length}`);
  console.log(`הותאמו  : ${matched.length}  (${Math.round(matched.length / all.length * 100)}%)`);
  console.log(`  גבוה  : ${high.length}   ← נכתבות`);
  console.log(`  אחרות : ${rest.length}   ← נשארות יתומות\n`);

  /*
    מזהה ציר שאינו קיים נפסל שוב כאן, ולא רק בזמן הקריאה למודל.
    בין ההרצות נוספו ובוטלו צירים, ושורה שמצביעה על ציר שהוסר הייתה
    נכתבת למסד בלי שאף שאלון יציג אותה.
  */
  const valid = new Set(CLUSTERS.flatMap(c => c.questions.map(q => q.issueId)));
  const bad = high.filter(m => !valid.has(m.issueId!));
  if (bad.length) {
    console.log(`⚠ ${bad.length} מצביעות על ציר שאינו קיים עוד — מדולגות:`);
    for (const b of bad.slice(0, 5)) console.log(`    ${b.billId} → ${b.issueId}`);
  }
  const write = high.filter(m => valid.has(m.issueId!));

  /*
    ── הצד מגיע מהבדיקה הנפרדת, לא מהתאמת הציר ──────────────────────

    סקריפט ההתאמה שלח למודל את שאלת הציר בלבד, בלי תוויות העמדות,
    ולכן המודל הניח ש-pro הוא "כן לשאלה". בציר ax_c776a3fa7a התוויות
    הפוכות ביחס לשאלה: _pro הוא "יש לפתוח את השוק לתחרות" ו-_con הוא
    "יש להגן על הייצור המקומי". תשע הצעות שמעדיפות תוצרת מקומית היו
    נכתבות בצד ההפוך.

    verify-match-sides הציג את שתי התוויות בלי שמן ובסדר מתחלף, ולכן
    התוצאה שלו היא הקובעת. הצעה שהבדיקה לא הכריעה בה אינה נכתבת.
  */
  const verified = new Map<number, string | null>();
  if (fs.existsSync(SIDES)) {
    for (const line of fs.readFileSync(SIDES, 'utf8').split('\n').filter(Boolean)) {
      const v = JSON.parse(line) as { billId: number; verified: string | null };
      verified.set(v.billId, v.verified);
    }
  } else {
    console.error('✗ orphan-sides.jsonl לא קיים. הריצי קודם verify-match-sides.ts');
    db.close(); process.exit(1);
  }

  let flips = 0, unresolved = 0;
  for (const m of write) {
    if (!verified.has(m.billId)) { m.side = null; unresolved++; continue; }
    const v = verified.get(m.billId);
    if (!v) { m.side = null; unresolved++; continue; }
    if (v !== m.side) flips++;
    m.side = v;
  }
  console.log(`  צד תוקן לפי הבדיקה: ${flips}`);
  console.log(`  הבדיקה לא הכריעה  : ${unresolved}  ← לא נכתבות`);

  /* הצעה שכבר סווגה בינתיים — לא נוגעים בה */
  const already = write.filter(m =>
    db.prepare('SELECT 1 FROM bill_political_classification WHERE bill_id = ?').get(m.billId));
  if (already.length) console.log(`  ${already.length} סווגו בינתיים במקום אחר — מדולגות`);
  const final = write.filter(m => m.side && !already.some(a => a.billId === m.billId));

  const byAxis = new Map<string, number>();
  for (const m of final) byAxis.set(m.issueId!, (byAxis.get(m.issueId!) ?? 0) + 1);
  const label = new Map(CLUSTERS.flatMap(c => c.questions.map(q => [q.issueId, q.question] as [string, string])));
  console.log(`\n═══ ${final.length} שיוכים על ${byAxis.size} צירים ═══`);
  for (const [id, n] of [...byAxis].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(n).padStart(3)} · ${label.get(id)?.slice(0, 58)}`);
  }
  const pro = final.filter(m => m.side === 'pro').length;
  console.log(`\n  בעד ${pro} · נגד ${final.length - pro}`);

  if (plan) { console.log('\n--plan — לא נכתב דבר.'); db.close(); return; }
  if (!final.length) { console.log('\nאין מה לכתוב.'); db.close(); return; }

  let written = 0;
  db.transaction(() => {
    for (const m of final) {
      const n = db.prepare(`INSERT OR IGNORE INTO bill_political_classification (bill_id, issue_id, stance_id)
                            VALUES (?, ?, ?)`).run(m.billId, m.issueId, `${m.issueId}_${m.side}`).changes;
      if (!n) continue;
      written++;
      fs.appendFileSync(APPLIED, JSON.stringify({ billId: m.billId, issueId: m.issueId }) + '\n');
    }
  })();

  const orph = (db.prepare(`SELECT COUNT(DISTINCT i.bill_id) AS n FROM bill_policy_issue i
    WHERE NOT EXISTS (SELECT 1 FROM bill_political_classification c WHERE c.bill_id = i.bill_id)
      AND EXISTS (SELECT 1 FROM bill_initiator bi WHERE bi.bill_id = i.bill_id)`).get() as { n: number }).n;

  console.log(`\n✓ ${written} שיוכים נכתבו.`);
  console.log(`  יתומות עם יוזם: ${orph}`);
  console.log('\nלביטול: npx tsx scripts/apply-orphan-matches.ts --undo');
  db.close();
}

main();
