/**
 * שלב 3: החלת הצירים שנוסחו בשלב 2.
 *
 * ── שני דברים ששלב 2 לא סיפק ─────────────────────────────────────────
 *
 * 1. צד לכל הצעה. שלב 2 שייך הצעות לציר אך לא אמר מי בעד ומי נגד.
 *    בציר כמו "האם לצמצם את סמכויות הגבייה" יש הצעות לשני הכיוונים,
 *    והנחה גורפת ש"הכול בעד" היא בדיוק התקלה שהפכה 15 שורות בהרצת
 *    ההצלה. לכן כאן רץ מעבר נוסף שקובע צד להצעה, אחת-אחת.
 *
 * 2. שיוך לאשכול. המודל המציא 18 נושאים משלו, ואף אחד מהם אינו אחד
 *    משמונת נושאי-העל של האתר. יצירת 19 אשכולות חדשים של שאלה אחת
 *    הייתה מציפה את מסך בחירת הנושאים, ולכן כל ציר משויך לאשכול
 *    קיים מתוך 53. ציר שאינו מתאים לאף אחד פשוט אינו נכנס.
 *
 * שני הדברים נקבעים בקריאה אחת לכל ציר, ונשמרים ל-JSONL כדי שהרצה
 * חוזרת לא תשלם עליהם שוב.
 *
 * ── שני ניסוחים שנכתבו ביד ────────────────────────────────────────────
 *
 * הצירים הפוליטיים נסקרו ונוסחו מחדש, ראה OVERRIDES.
 *
 *   npx tsx scripts/apply-drafted-axes.ts --plan     מחשב ומראה, בלי לכתוב
 *   npx tsx scripts/apply-drafted-axes.ts            מחיל
 *   npx tsx scripts/apply-drafted-axes.ts --undo     מבטל
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { geminiFetch, geminiUrl, DailyQuotaError } from '../src/lib/gemini-fetch';
import { CLUSTERS } from '../src/lib/axis-clusters';
import { MIN_BILLS_PER_ISSUE } from '../src/lib/canonical-agendas';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const DATA = path.join(process.cwd(), 'data/policy-analysis');
const CATALOG = path.join(DATA, 'axis-catalog.json');
const CLUSTER_FILE = path.join(DATA, 'axis-clusters.json');
const DRAFTS = path.join(process.cwd(), 'axis-drafts.jsonl');
const RESOLVED = path.join(process.cwd(), 'axis-resolved.jsonl');
/** רשומה מדויקת של השורות שנוספו לצירים קיימים, לצורך --undo */
const MERGE_LOG = path.join(process.cwd(), 'axis-merged.jsonl');

const plan = process.argv.includes('--plan');
const undo = process.argv.includes('--undo');

/** צירים שנוסחו מחדש ביד אחרי סקירה. המפתח הוא השאלה שהמודל החזיר. */
const OVERRIDES: Record<string, { question: string; pro: string; con: string }> = {
  'האם להרחיב סמכויות לגירוש ולשלילת מעמד של פעילי טרור ובני משפחותיהם?': {
    /*
      בניסוח המקורי צד ה"בעד" הצדיק רק פעולה נגד מי שפעל, בעוד צד
      ה"נגד" תקף דווקא את גירוש המשפחות. שני הצדדים התווכחו על דברים
      שונים. כאן הבעד מודה במפורש בחלק הקשה.

      כן הוסר "מנוגדים לדין הבינלאומי", שנאמר כעובדה ולא כעמדה.
    */
    question: 'האם לשלול מעמד ולגרש פעילי טרור ובני משפחותיהם?',
    pro: 'יש לשלול אזרחות ולגרש פעילי טרור ובני משפחה המזדהים עמם, כאמצעי הרתעה ומשום שתמיכה בטרור שוללת את הזכות למעמד.',
    con: 'יש להימנע משלילת מעמד ומגירוש, משום שהם פוגעים בזכויות יסוד ומענישים בני משפחה שלא הורשעו בעבירה.',
  },
  'האם להחיל את החוק והמשפט הישראלי על יהודה ושומרון?': {
    /*
      "להפסיק את האפליה" הניח שקיימת אפליה כעובדה, ו"מהווה סיפוח"
      קבע מסגור שנוי במחלוקת כעובדה. כל צד נוסח בשפת התעמולה של עצמו.
    */
    question: 'האם להחיל את החוק הישראלי על יהודה ושומרון?',
    pro: 'יש להחיל את החוק הישראלי על האזור, כדי להשוות את מעמדם המשפטי של התושבים ולבסס את אחיזת המדינה בו.',
    con: 'יש להותיר את המצב המשפטי הקיים, משום שהחלת החוק תקבע הכרעה חד-צדדית בשאלת השטחים לפני הסדר מדיני.',
  },
};

/**
 * צירים שכבר קיימים בשאלון בניסוח אחר. ההצעות מתווספות לציר הקיים
 * במקום להקים ציר רביעי שאומר את אותו דבר.
 *
 * שלב 2 עבד רק על הצעות יתומות, ולכן מעולם לא ראה את 204 הצירים
 * הקיימים. כך נוצר ציר ריבונות נוסף לצד ax_18cd3cf6b7 שמחזיק 44
 * הצעות, ושאלת שוויון נוספת לצד ax_55641f42c4.
 *
 * בשני המקרים כיוון ה"בעד" של הציר הקיים זהה לזה של החדש, ולכן
 * pro→pro ו-con→con.
 */
const MERGE_INTO: Record<string, string> = {
  'האם להחיל את החוק הישראלי על יהודה ושומרון?': 'ax_18cd3cf6b7',
  'האם יש לעגן במפורש את הזכות לשוויון בחוק-יסוד: כבוד האדם וחירותו?': 'ax_55641f42c4',
};

interface AxisDraft {
  question: string; pro: string; con: string;
  topic: string; subtopic: string; billIds: number[];
}
interface Resolved {
  key: string;
  clusterId: string | null;
  /** bill_id → 'pro' | 'con' | 'none' */
  sides: Record<string, string>;
}

/** מזהה יציב מהשאלה, בפורמט של 204 הצירים הקיימים */
const axisId = (q: string) => 'ax_' + crypto.createHash('sha256').update(q).digest('hex').slice(0, 10);

function apiKey(): string {
  for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
    if (line.startsWith('GEMINI_API_KEY=')) return line.slice('GEMINI_API_KEY='.length).trim();
  }
  throw new Error('אין GEMINI_API_KEY ב-.env.local');
}

function loadDrafts(): AxisDraft[] {
  const out: AxisDraft[] = [];
  for (const line of fs.readFileSync(DRAFTS, 'utf8').split('\n').filter(Boolean)) {
    for (const a of (JSON.parse(line) as { axes: AxisDraft[] }).axes) {
      const o = OVERRIDES[a.question];
      out.push(o ? { ...a, ...o } : a);
    }
  }
  return out;
}

function buildPrompt(a: AxisDraft, bills: Array<{ id: number; title: string; change: string }>): string {
  const clusterList = CLUSTERS.map(c => `${c.clusterId} | ${c.topic} | ${c.label}`).join('\n');
  const billList = bills.map(b => `[${b.id}] ${b.title}\n     ${b.change.slice(0, 200)}`).join('\n\n');
  return `ציר מחלוקת:
שאלה: ${a.question}
עמדה א (pro): ${a.pro}
עמדה ב (con): ${a.con}

ההצעות המשויכות לציר:

${billList}

אשכולות קיימים באתר:

${clusterList}

שתי משימות:

1. לכל הצעה — לאיזו עמדה היא דוחפת? "pro" אם היא מקדמת את עמדה א,
   "con" אם היא מקדמת את עמדה ב, "none" אם אינה מקדמת אף אחת.
   קבע לפי מה שההצעה עושה בפועל, לא לפי מי יזם אותה.

2. לאיזה אשכול קיים הציר הזה שייך? החזר את ה-clusterId שלו.
   אם אף אשכול אינו מתאים באמת — החזר null. אל תדחוף בכוח.

החזר JSON בלבד:
{"clusterId":"cl_xxx","sides":{"2196942":"pro","2197406":"con"}}`;
}

async function resolveAxis(a: AxisDraft, db: Database.Database, key: string): Promise<Resolved | null> {
  const bills = a.billIds.map(id => {
    const r = db.prepare(`SELECT b.title AS title,
        (SELECT i.policy_change FROM bill_policy_issue i WHERE i.bill_id = b.id LIMIT 1) AS change
      FROM bill b WHERE b.id = ?`).get(id) as { title: string; change: string | null };
    return { id, title: r?.title ?? '', change: r?.change ?? '' };
  });

  const res = await geminiFetch(
    geminiUrl('generateContent', key),
    {
      contents: [{ parts: [{ text: buildPrompt(a, bills) }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json', maxOutputTokens: 8192 },
    },
    { retries: 0, timeoutMs: 90_000, label: axisId(a.question) },
  );
  if (!res.ok) { console.log(`    ✗ ${res.status}`); return null; }
  const body = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  };
  const cand = body.candidates?.[0];
  if (cand?.finishReason && cand.finishReason !== 'STOP') { console.log(`    ✗ נקטע: ${cand.finishReason}`); return null; }
  const m = ((cand?.content?.parts ?? []).map(p => p.text ?? '').join('')).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const p = JSON.parse(m[0]) as { clusterId?: string | null; sides?: Record<string, string> };
    const valid = CLUSTERS.some(c => c.clusterId === p.clusterId);
    return { key: a.question, clusterId: valid ? p.clusterId! : null, sides: p.sides ?? {} };
  } catch { return null; }
}

const readJson = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8')) as Array<Record<string, unknown>>;
const writeJson = (f: string, v: unknown) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n');

function runUndo(db: Database.Database): void {
  const ids = loadDrafts().map(a => axisId(a.question));
  const idSet = new Set(ids);
  let removed = 0;
  for (const id of ids) {
    removed += db.prepare('DELETE FROM bill_political_classification WHERE issue_id = ?').run(id).changes;
  }
  writeJson(CATALOG, readJson(CATALOG).filter(a => !idSet.has(String(a.issueId))));
  const cl = readJson(CLUSTER_FILE);
  for (const c of cl) {
    const members = (c.members as Array<Record<string, unknown>>).filter(m => !idSet.has(String(m.issueId)));
    if (members.length === (c.members as unknown[]).length) continue;
    c.members = members;
    c.billCount = members.reduce((s, m) => s + Number(m.billCount ?? 0), 0);
  }
  writeJson(CLUSTER_FILE, cl);

  /* שורות שנוספו לצירים קיימים — נמחקות אחת-אחת לפי הרשומה */
  let unmerged = 0;
  if (fs.existsSync(MERGE_LOG)) {
    for (const line of fs.readFileSync(MERGE_LOG, 'utf8').split('\n').filter(Boolean)) {
      const m = JSON.parse(line) as { billId: number; issueId: string };
      unmerged += db.prepare('DELETE FROM bill_political_classification WHERE bill_id = ? AND issue_id = ?')
        .run(m.billId, m.issueId).changes;
    }
    fs.rmSync(MERGE_LOG);
  }
  console.log(`בוטל. ${removed} שיוכים הוסרו ו-${ids.length} צירים הוסרו מהקטלוג ומהאשכולות.`);
  if (unmerged) console.log(`בנוסף ${unmerged} שיוכים הוסרו מצירים קיימים שמוזגו אליהם.`);
}

async function main(): Promise<void> {
  const db = new Database(DB_PATH);
  if (undo) { runUndo(db); db.close(); return; }

  const drafts = loadDrafts();
  console.log(`צירים מהטיוטה: ${drafts.length}`);
  console.log(`נוסחו מחדש ביד: ${drafts.filter(a => Object.values(OVERRIDES).some(o => o.question === a.question)).length}\n`);

  // ── מעבר הפענוח: צד לכל הצעה ואשכול לכל ציר ──
  const resolved = new Map<string, Resolved>();
  if (fs.existsSync(RESOLVED)) {
    for (const line of fs.readFileSync(RESOLVED, 'utf8').split('\n').filter(Boolean)) {
      const r = JSON.parse(line) as Resolved;
      resolved.set(r.key, r);
    }
    console.log(`${resolved.size} צירים כבר מפוענחים בקובץ\n`);
  }

  const key = apiKey();
  for (const a of drafts) {
    if (resolved.has(a.question)) continue;
    console.log(`  ${a.question.slice(0, 62)}`);
    let r: Resolved | null = null;
    try { r = await resolveAxis(a, db, key); } catch (e) {
      if (e instanceof DailyQuotaError) { console.log('\n  המכסה נגמרה. מה שפוענח נשמר.'); break; }
      throw e;
    }
    if (!r) { console.log('    ↻ ללא תשובה תקפה — יידון שוב'); continue; }
    fs.appendFileSync(RESOLVED, JSON.stringify(r) + '\n');
    resolved.set(a.question, r);
    const pro = Object.values(r.sides).filter(s => s === 'pro').length;
    const con = Object.values(r.sides).filter(s => s === 'con').length;
    const cl = CLUSTERS.find(c => c.clusterId === r!.clusterId);
    console.log(`    בעד ${pro} · נגד ${con} · אשכול: ${cl?.label ?? '(אין מתאים — הציר לא ייכנס)'}`);
    await new Promise(x => setTimeout(x, 800));
  }

  // ── מה ייכנס בפועל ──
  const sided = (a: AxisDraft) => {
    const r = resolved.get(a.question);
    return r ? Object.values(r.sides).filter(s => s === 'pro' || s === 'con').length : 0;
  };

  /* מיזוג לציר קיים — ההצעות נכנסות, ציר חדש אינו נוצר */
  const merges = drafts.filter(a => MERGE_INTO[a.question] && sided(a) > 0);

  /*
    ציר עם פחות מ-MIN_BILLS_PER_ISSUE הצעות אינו מוצג בשאלון. בהרצה
    קודמת נוצרו כך עשרה צירים בני ארבע הצעות: הם נכתבו למסד, ההצעות
    נראו מסווגות, ואף משתמשת לא יכלה להגיע אליהן. עדיף להשאיר אותן
    יתומות ולדעת זאת.
  */
  const ready = drafts.filter(a => {
    if (MERGE_INTO[a.question]) return false;
    const r = resolved.get(a.question);
    return r && r.clusterId && sided(a) >= MIN_BILLS_PER_ISSUE;
  });
  const tooSmall = drafts.filter(a => !MERGE_INTO[a.question] && sided(a) > 0 && sided(a) < MIN_BILLS_PER_ISSUE);
  const noHome = drafts.length - ready.length - merges.length - tooSmall.length;

  console.log(`\n═══ מה ייכנס ═══`);
  console.log(`  צירים חדשים : ${ready.length}`);
  console.log(`  מיזוגים     : ${merges.length}  (${merges.reduce((s, a) => s + sided(a), 0)} הצעות לצירים קיימים)`);
  if (tooSmall.length) console.log(`  מתחת לסף ${MIN_BILLS_PER_ISSUE}  : ${tooSmall.length}  (${tooSmall.reduce((s, a) => s + sided(a), 0)} הצעות נשארות יתומות)`);
  if (noHome) console.log(`  ללא אשכול   : ${noHome}`);
  let rows = 0;
  for (const a of ready) {
    const r = resolved.get(a.question)!;
    const n = Object.values(r.sides).filter(s => s !== 'none').length;
    rows += n;
    const cl = CLUSTERS.find(c => c.clusterId === r.clusterId);
    console.log(`    ${String(n).padStart(2)} · ${a.question.slice(0, 54)}`);
    console.log(`         ← ${cl?.label}`);
  }
  console.log(`  שיוכים : ${rows}`);

  if (plan) { console.log('\n--plan — לא נכתב דבר.'); db.close(); return; }
  if (!ready.length) { console.log('\nאין מה להחיל.'); db.close(); return; }

  // ── הקטלוג ──
  const cat = readJson(CATALOG);
  const existing = new Set(cat.map(a => String(a.issueId)));
  for (const a of ready) {
    const id = axisId(a.question);
    if (existing.has(id)) { console.log(`  דילוג: ${id} כבר קיים`); continue; }
    const r = resolved.get(a.question)!;
    const cl = CLUSTERS.find(c => c.clusterId === r.clusterId)!;
    cat.push({
      issueId: id, topic: cl.topic, subtopic: a.subtopic,
      axisIndex: 1, question: a.question,
      stances: [{ id: `${id}_pro`, label: a.pro }, { id: `${id}_con`, label: a.con }],
      billCount: a.billIds.length, poolSize: a.billIds.length, covered: a.billIds.length,
    });
  }
  writeJson(CATALOG, cat);

  // ── האשכולות ──
  const cl = readJson(CLUSTER_FILE);
  for (const a of ready) {
    const id = axisId(a.question);
    const r = resolved.get(a.question)!;
    const target = cl.find(c => c.clusterId === r.clusterId);
    if (!target) continue;
    const members = target.members as Array<Record<string, unknown>>;
    if (members.some(m => m.issueId === id)) continue;
    members.push({
      issueId: id, originalKeyword: a.subtopic, subtopic: a.subtopic,
      question: a.question, billCount: a.billIds.length,
    });
    target.billCount = members.reduce((s, m) => s + Number(m.billCount ?? 0), 0);
  }
  writeJson(CLUSTER_FILE, cl);

  // ── השיוכים ──
  let written = 0, merged = 0;
  db.transaction(() => {
    const assign = (billId: number, id: string, side: string) =>
      db.prepare(`INSERT OR IGNORE INTO bill_political_classification (bill_id, issue_id, stance_id)
                  VALUES (?, ?, ?)`).run(billId, id, `${id}_${side}`).changes;

    for (const a of ready) {
      const id = axisId(a.question);
      for (const [billId, side] of Object.entries(resolved.get(a.question)!.sides)) {
        if (side !== 'pro' && side !== 'con') continue;
        written += assign(Number(billId), id, side);
      }
    }
    /*
      השורות שנוספו לציר קיים נרשמות אחת-אחת. בלי זה --undo היה חייב
      למחוק לפי issue_id, ולמחוק בדרך גם את 44 ההצעות שכבר היו על
      הציר הזה מלכתחילה. נרשמות רק שורות ש-changes אישר שנוספו, כך
      ששיוך שכבר היה קיים לא ייגע.
    */
    for (const a of merges) {
      const id = MERGE_INTO[a.question];
      for (const [billId, side] of Object.entries(resolved.get(a.question)!.sides)) {
        if (side !== 'pro' && side !== 'con') continue;
        if (!assign(Number(billId), id, side)) continue;
        merged++;
        fs.appendFileSync(MERGE_LOG, JSON.stringify({ billId: Number(billId), issueId: id }) + '\n');
      }
    }
  })();

  console.log(`\n✓ ${ready.length} צירים נוספו · ${written} שיוכים נכתבו.`);
  if (merged) console.log(`✓ ${merged} שיוכים נוספו לצירים קיימים (מיזוג).`);
  console.log('לביטול: npx tsx scripts/apply-drafted-axes.ts --undo');
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
