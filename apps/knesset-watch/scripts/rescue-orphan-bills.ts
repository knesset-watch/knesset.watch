/**
 * החזרת הצעות חוק יתומות לטקסונומיה, לפי תוכן העמדות.
 *
 * ── הבעיה ────────────────────────────────────────────────────────────
 *
 * 2,558 הצעות חוק עם יוזם אינן מסווגות לאף סוגיה בשאלון, ולכן כל אחת
 * מהן היא אפס בדירוג. זהו שליש מהעבודה החקיקתית של כמעט כל ח"כ.
 *
 * הסיבה אינה חוסר בנתונים. ל-100% מהן יש ניתוח מלא עם שתי עמדות
 * מנוסחות. הכשל הוא בשדה שעליו רץ האשכול:
 *
 *   raw_issue    "רישום כוורות במקרקעין שאינם מקרקעי ציבור"
 *   pro_stance   "לחייב רישום כדי לפקח על מחלות זיהומיות"
 *   con_stance   "התערבות מיותרת שפוגעת בזכויות קניין ובפרטיות"
 *
 * שם הסוגיה מתאר את החוק ולכן הוא כמעט תמיד ייחודי — cluster_size=1
 * אצל כל היתומות. העמדות מתארות מחלוקת, והמחלוקות חוזרות: רגולציה
 * מול חופש עיסוק, פיקוח מול פרטיות, ריכוזיות מול ביזור. הכוורות הן
 * מקרה פרטי של ציר שכבר קיים בשאלון.
 *
 * במדידה על 120 הצעות: התאמה לפי עמדות נתנה 87 מעל 0.60 לעומת 33
 * לפי שם, וההתאמות היו גם נכונות יותר ולא רק גבוהות יותר.
 *
 * ── מה הסקריפט עושה ──────────────────────────────────────────────────
 *
 *   1. מתאים כל שורת סוגיה יתומה לציר, לפי טקסט העמדות.
 *   2. קובע צד: העמדה שההצעה מקדמת מושווית לשני צידי הציר.
 *   3. מדווח כמה נכנסות בכל סף, ומייצר מדגם לבדיקה ידנית.
 *
 * הוא אינו כותב למסד. הפלט הוא JSONL לבדיקה, ורק --apply יכתוב —
 * וגם אז לטבלה נפרדת, לא על bill_political_classification.
 *
 *   npx tsx scripts/rescue-orphan-bills.ts                דוח מלא
 *   npx tsx scripts/rescue-orphan-bills.ts --limit 200    מדגם מהיר
 *   npx tsx scripts/rescue-orphan-bills.ts --threshold .65
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { CLUSTERS } from '../src/lib/axis-clusters';

const DIMS = 256;
const CACHE = path.join(process.cwd(), '.embed-cache.json');
const OUT = path.join(process.cwd(), 'orphan-rescue.jsonl');
const REPORT = path.join(process.cwd(), 'orphan-rescue-report.txt');
/** מה שלא עבר — לסיווג ידני, עם שלושה מועמדים לכל שורה */
const MANUAL = path.join(process.cwd(), 'orphan-manual-review.csv');

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const LIMIT = Number(arg('--limit')) || Infinity;
const THRESHOLD = Number(arg('--threshold')) || 0.65;
/*
  מרווח הצד: ההפרש בין קרבת העמדה לצד "בעד" לקרבתה לצד "נגד".
  מרווח אפסי פירושו שהעמדה יושבת באמצע הציר ואי אפשר לדעת לאיזה צד
  היא שייכת. סיווג כזה אינו "כמעט נכון" — הוא הטלת מטבע, ושיוך ח"כ
  לעמדה שלא נקט גרוע מאי-סיווג.
*/
const MIN_MARGIN = Number(arg('--min-margin')) || 0.05;

const jinaKey = (() => {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    if (line.startsWith('JINA_API_KEY=')) return line.slice('JINA_API_KEY='.length).trim();
  }
  throw new Error('אין JINA_API_KEY ב-.env.local');
})();

/* ── הטמעה, עם קאש על הדיסק ──────────────────────────────────────────
   הרצה חוזרת אינה משלמת שוב על אותו טקסט. הקאש הוא קובץ מקומי
   ו-gitignored; מחיקתו רק מייקרת את ההרצה הבאה. */
const cache: Record<string, number[]> = fs.existsSync(CACHE)
  ? JSON.parse(fs.readFileSync(CACHE, 'utf8'))
  : {};

async function embedAll(texts: string[], label: string): Promise<Array<number[] | null>> {
  const need = [...new Set(texts.filter(t => t && !cache[t]))];
  if (need.length) {
    /*
      Jina מגביל ל-100,000 טוקנים לדקה. אצווה של 48 עמדות בעברית חורגת
      מזה בהרצה רציפה, ולכן: אצווה קטנה יותר, השהיה בין אצוות, וניסיון
      חוזר על 429. הקאש נכתב אחרי כל אצווה, כדי שהרצה שנקטעת לא תשלם
      שוב על מה שכבר הוטמע.
    */
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < need.length; i += 24) {
      /*
        הקיצוץ נעשה על העותק שנשלח בלבד, והקאש נשמר תחת המפתח המלא.

        בגרסה הקודמת נשמר תחת המפתח החתוך, ולכן כל טקסט ארוך מ-700
        תווים לא נמצא בחיפוש החוזר — הוא חזר null, השורה דולגה בשקט,
        והצעת החוק נעלמה משני קובצי הפלט גם יחד. עשר הצעות אבדו ככה,
        וזה התגלה רק כי המאזן לא הסתדר.
      */
      const keys = need.slice(i, i + 24);
      const batch = keys.map(t => t.slice(0, 700));
      let ok = false;
      for (let attempt = 0; attempt < 6 && !ok; attempt++) {
        const res = await fetch('https://api.jina.ai/v1/embeddings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jinaKey}` },
          body: JSON.stringify({ model: 'jina-embeddings-v3', input: batch, dimensions: DIMS }),
        });
        if (res.status === 429) {
          const wait = 15_000 * (attempt + 1);
          process.stdout.write(`\r  ${label}: מגבלת קצב, ממתין ${wait / 1000}ש...        `);
          await sleep(wait);
          continue;
        }
        if (!res.ok) throw new Error(`Jina ${res.status}: ${(await res.text()).slice(0, 160)}`);
        const data = await res.json() as { data?: Array<{ embedding?: number[] }> };
        (data.data ?? []).forEach((d, j) => { if (d.embedding) cache[keys[j]] = d.embedding; });
        fs.writeFileSync(CACHE, JSON.stringify(cache));
        ok = true;
      }
      if (!ok) throw new Error(`${label}: מגבלת הקצב לא התפנתה`);
      process.stdout.write(`\r  ${label}: ${Math.min(i + 24, need.length)}/${need.length} חדשים        `);
      await sleep(2_000);
    }
    process.stdout.write('\n');
  } else {
    console.log(`  ${label}: הכול בקאש`);
  }
  return texts.map(t => cache[t] ?? null);
}

/** עיגול כלפי מטה, כדי שמספר לא ייראה כחורג מהסף שהוא נכשל בו */
const floor4 = (n: number) => (Math.floor(n * 10000) / 10000).toFixed(4);

const cos = (a: number[], b: number[]) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb));
};

interface Row {
  billId: number; billTitle: string; issueCandidate: string;
  policyChange: string; pro: string; con: string;
}

async function main() {
  // ── אילו הצעות יתומות ──────────────────────────────────────────────
  const mapping = fs.readFileSync('data/policy-analysis/canonical/bill-issue-mapping.jsonl', 'utf8')
    .trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean) as Array<Record<string, unknown>>;
  const orient = new Set(fs.readFileSync('data/policy-analysis/canonical-orientation.jsonl', 'utf8')
    .trim().split('\n').map(l => { try { return JSON.parse(l).canonical_issue_id; } catch { return null; } }));

  const db = new Database('knesset.db', { readonly: true });
  const classified = new Set(
    (db.prepare('SELECT DISTINCT bill_id FROM bill_political_classification').all() as Array<{ bill_id: number }>)
      .map(r => r.bill_id));

  const orphanIds = [...new Set(
    mapping.filter(m => m.review_required || !orient.has(m.canonical_issue_id)).map(m => Number(m.bill_id)),
  )].filter(id => !classified.has(id));

  const ids = orphanIds.slice(0, LIMIT === Infinity ? orphanIds.length : LIMIT);
  console.log(`הצעות יתומות שאינן מסווגות כלל: ${orphanIds.length.toLocaleString()}`);
  console.log(`מעובדות בהרצה זו              : ${ids.length.toLocaleString()}\n`);

  const rows: Row[] = [];
  for (let i = 0; i < ids.length; i += 400) {
    const slice = ids.slice(i, i + 400);
    const ph = slice.map(() => '?').join(',');
    const got = db.prepare(`
      SELECT i.bill_id AS billId, b.title AS billTitle, i.issue_candidate AS issueCandidate,
             i.policy_change AS policyChange, i.pro_stance AS pro, i.con_stance AS con
      FROM bill_policy_issue i JOIN bill b ON b.id = i.bill_id
      WHERE i.bill_id IN (${ph})
        AND i.pro_stance IS NOT NULL AND i.con_stance IS NOT NULL
        AND LENGTH(i.pro_stance) > 10 AND LENGTH(i.con_stance) > 10`).all(...slice) as Row[];
    rows.push(...got);
  }
  db.close();
  console.log(`שורות סוגיה לעיבוד: ${rows.length.toLocaleString()}\n`);

  // ── הצירים ─────────────────────────────────────────────────────────
  const axes = CLUSTERS.flatMap(c => c.questions.map(q => ({
    id: q.issueId,
    question: q.question,
    proId: q.stances[0]?.id ?? '',
    conId: q.stances[1]?.id ?? '',
    proLabel: q.stances[0]?.label ?? '',
    conLabel: q.stances[1]?.label ?? '',
  }))).filter(a => a.proId && a.conId);

  console.log(`צירים: ${axes.length}\n`);
  console.log('מטמיע...');
  const axisVecs = await embedAll(axes.map(a => `${a.question} ${a.proLabel} ${a.conLabel}`), 'צירים');
  const axisPro = await embedAll(axes.map(a => a.proLabel), 'צד בעד');
  const axisCon = await embedAll(axes.map(a => a.conLabel), 'צד נגד');
  const rowVecs = await embedAll(rows.map(r => `${r.policyChange} ${r.pro} ${r.con}`), 'יתומות');
  /*
    הצד נקבע מ-policy_change ולא מ-pro_stance.

    pro_stance הוא הנימוק בעד ההצעה, והנימוקים משני צידי מחלוקת
    כתובים באותה שפה: ״פגיעה נפשית קשה״ מול ״ענישה שאינה מידתית״.
    שניהם משפטיים, שניהם רציניים, ולכן שניהם קרובים במידה דומה לשני
    צידי הציר. מדדתי רטוריקה במקום מעשה.

    policy_change אומר מה ההצעה עושה — ״נוכחות קטין תגרור החמרה או
    כפל עונש״ — וזה חד־משמעי.

    נמדד על 179 השורות שהצד בהן לא הוכרע:
      pro_stance      9 נפתרות, חציון מרווח 0.0263
      policy_change  91 נפתרות, חציון מרווח 0.0510
  */
  const rowPro = await embedAll(rows.map(r => r.policyChange), 'מה ההצעה עושה');

  // ── התאמה וקביעת צד ────────────────────────────────────────────────
  interface Match {
    billId: number; billTitle: string; issueCandidate: string;
    axisId: string; axisQuestion: string; score: number;
    side: 'pro' | 'con'; stanceId: string; sideMargin: number;
    alternatives: Array<{ id: string; question: string; score: number }>;
  }
  const matches: Match[] = [];
  const skipped: number[] = [];

  for (let i = 0; i < rows.length; i++) {
    const v = rowVecs[i], p = rowPro[i];
    // דילוג שקט הוא איך שעשר ההצעות אבדו. עכשיו הוא נספר ומדווח.
    if (!v || !p) { skipped.push(rows[i].billId); continue; }

    // שלושת הקרובים, כדי שהבדיקה הידנית תוכל לבחור ולא רק לאשר
    const ranked = axes
      .map((a, j) => ({ j, s: axisVecs[j] ? cos(v, axisVecs[j]!) : -1 }))
      .sort((x, y) => y.s - x.s)
      .slice(0, 3);
    const bi = ranked[0]?.j ?? -1;
    const bs = ranked[0]?.s ?? -1;
    if (bi < 0) continue;

    /*
      הצד נקבע ממה שההצעה עושה בפועל. policy_change מתאר את השינוי
      החקיקתי, ולכן הוא מייצג את עמדת ההצעה. משווים אותו
      לשני צידי הציר ולוקחים את הקרוב.

      sideMargin הוא ההפרש בין השניים. מרווח קטן פירושו שהעמדה יושבת
      באמצע ואי אפשר לקבוע צד — ושם עדיף לא לסווג כלל.
    */
    const ap = axisPro[bi], ac = axisCon[bi];
    if (!ap || !ac) continue;
    const simPro = cos(p, ap), simCon = cos(p, ac);
    const side: 'pro' | 'con' = simPro >= simCon ? 'pro' : 'con';

    matches.push({
      billId: rows[i].billId,
      billTitle: rows[i].billTitle,
      issueCandidate: rows[i].issueCandidate,
      axisId: axes[bi].id,
      axisQuestion: axes[bi].question,
      score: bs,
      side,
      stanceId: side === 'pro' ? axes[bi].proId : axes[bi].conId,
      sideMargin: Math.abs(simPro - simCon),
      alternatives: ranked.map(r => ({ id: axes[r.j].id, question: axes[r.j].question, score: r.s })),
    });
  }

  // ── דוח ────────────────────────────────────────────────────────────
  if (skipped.length) {
    console.error(`
✗ ${skipped.length} שורות דולגו — ההטמעה נכשלה:`);
    console.error(`   ${skipped.slice(0, 10).join(', ')}`);
  }

  const lines: string[] = [];
  const say = (s = '') => { console.log(s); lines.push(s); };

  say('\n═══ כמה נכנסות בכל סף ═══');
  say(`  ${'סף'.padStart(5)}  ${'שורות'.padStart(7)}  ${'הצעות חוק'.padStart(10)}  ${'% מהיתומות'.padStart(11)}`);
  for (const t of [0.55, 0.6, 0.65, 0.7, 0.75, 0.8]) {
    const hit = matches.filter(m => m.score >= t);
    const bills = new Set(hit.map(m => m.billId)).size;
    say(`  ${t.toFixed(2).padStart(5)}  ${String(hit.length).padStart(7)}  ${String(bills).padStart(10)}  ${String(Math.round(bills / ids.length * 100) + '%').padStart(11)}`);
  }

  const passScore = matches.filter(m => m.score >= THRESHOLD);
  const kept = passScore.filter(m => m.sideMargin >= MIN_MARGIN);
  const ambiguous = passScore.filter(m => m.sideMargin < MIN_MARGIN);
  const belowScore = matches.filter(m => m.score < THRESHOLD);
  say(`\n═══ בסף ${THRESHOLD} ═══`);
  say(`  שורות      : ${kept.length.toLocaleString()}`);
  say(`  הצעות חוק  : ${new Set(kept.map(m => m.billId)).size.toLocaleString()}`);
  say(`  צירים שונים: ${new Set(kept.map(m => m.axisId)).size}`);
  say(`  נפלו על מרווח צד < ${MIN_MARGIN}: ${ambiguous.length}`);
  say(`  בעד / נגד  : ${kept.filter(m => m.side === 'pro').length} / ${kept.filter(m => m.side === 'con').length}`);

  const margins = kept.map(m => m.sideMargin).sort((a, b) => a - b);
  if (margins.length) {
    const pm = (q: number) => margins[Math.floor(margins.length * q)].toFixed(3);
    say(`  מרווח הצד  : חציון ${pm(.5)} | p25 ${pm(.25)} | מינימום ${margins[0].toFixed(3)}`);
    say(`  מרווח < 0.02 (לא ניתן לקבוע צד): ${margins.filter(m => m < 0.02).length}`);
  }

  say('\n═══ מדגם אקראי לבדיקה ידנית ═══');
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (const m of [...kept].sort(() => rnd() - 0.5).slice(0, 12)) {
    say(`\n  ${m.score.toFixed(3)} · ${m.side === 'pro' ? 'בעד' : 'נגד'} (מרווח ${m.sideMargin.toFixed(3)})`);
    say(`    חוק  : ${m.billTitle.slice(0, 62)}`);
    say(`    סוגיה: ${m.issueCandidate.slice(0, 62)}`);
    say(`    ציר  : ${m.axisQuestion.slice(0, 62)}`);
  }

  fs.writeFileSync(OUT, kept.map(m => JSON.stringify(m)).join('\n') + '\n');

  /*
    לסיווג ידני: כל מה שלא עבר, עם שלושת הצירים הקרובים ביותר ועם
    העמדות עצמן. שתי העמודות האחרונות ריקות ומיועדות למילוי — מזהה
    הציר הנבחר, וצד. מי שממלא אותן אינו צריך לחפש: המועמדים כאן.
  */
  const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  const byBillIssue = new Map<string, Row>();
  for (const r of rows) byBillIssue.set(`${r.billId}|${r.issueCandidate}`, r);

  /*
    הצעה יכולה לשאת כמה סוגיות. אם אחת מהן כן נמצאה, ההצעה מסווגת —
    ואין טעם לשלוח את השורות האחרות שלה לבדיקה ידנית. 73 מתוך 1,633
    היו כאלה.
  */
  const classifiedNow = new Set(kept.map(m => m.billId));
  const needManual = [...ambiguous, ...belowScore].filter(m => !classifiedNow.has(m.billId));
  /*
    שני מספרים שונים לגמרי, ובגרסה הקודמת שניהם נקראו ״ציון״ והיו
    מעורבבים בעמודה אחת:

      ציון התאמה  כמה ההצעה דומה לציר.  טווח 0.4-0.9,  סף 0.65
      מרווח צד    כמה ברור אם היא בעד או נגד. טווח 0-0.3, סף 0.05

    עכשיו לכל אחד עמודה משלו, וסיבת הדחייה היא מילים ולא מספר.
  */
  const header = [
    'bill_id', 'מה חסר', 'ציון התאמה', 'מרווח צד',
    'כותרת החוק', 'הסוגיה', 'עמדת בעד', 'עמדת נגד',
    'מועמד 1', 'התאמה 1', 'מועמד 2', 'התאמה 2', 'מועמד 3', 'התאמה 3',
    'ציר נבחר (למילוי)', 'צד pro/con (למילוי)',
  ];
  const csv = [header.map(esc).join(',')];
  for (const m of needManual) {
    const src = byBillIssue.get(`${m.billId}|${m.issueCandidate}`);
    const reason = m.score < THRESHOLD ? 'אין ציר מתאים' : 'הצד אינו ברור';
    /*
      עיגול כלפי מטה, לא לזוגי הקרוב. ציון של 0.64999 מעוגל רגיל
      מוצג כ-0.6500 — ואז שורה שנדחתה נראית כאילו עברה את הסף,
      ומי שקורא את הקובץ מסיק שהסינון שבור. הוא אינו.
    */
    csv.push([
      String(m.billId), reason, floor4(m.score), floor4(m.sideMargin),
      m.billTitle, m.issueCandidate,
      src?.pro ?? '', src?.con ?? '',
      m.alternatives[0]?.question ?? '', floor4(m.alternatives[0]?.score ?? 0),
      m.alternatives[1]?.question ?? '', floor4(m.alternatives[1]?.score ?? 0),
      m.alternatives[2]?.question ?? '', floor4(m.alternatives[2]?.score ?? 0),
      '', '',
    ].map(esc).join(','));
  }
  // BOM כדי ש-Excel יקרא עברית נכון
  fs.writeFileSync(MANUAL, '\uFEFF' + csv.join('\n') + '\n');
  fs.writeFileSync(REPORT, lines.join('\n') + '\n');
  say(`\n\nנכתבו:`);
  say(`  ${path.basename(OUT)}     ${kept.length.toLocaleString()} התאמות`);
  say(`  ${path.basename(REPORT)}  הדוח הזה`);
  say(`  ${path.basename(MANUAL)}  ${needManual.length.toLocaleString()} שורות לסיווג ידני`);
  say('\nלא נכתב דבר למסד. הטבלה bill_political_classification לא נגעה.');
}

main();
