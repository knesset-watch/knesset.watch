/**
 * שלב 2: ניסוח צירים לאשכולות, לסקירה לפני החלה.
 *
 * הסקריפט אינו כותב למסד ואינו נוגע בקטלוג. הוא מייצר טיוטה בלבד —
 * axis-drafts.csv — ורק אחרי סקירה יורץ שלב 3 שמחיל אותה.
 *
 * ── למה פיצול ולא ציר אחד לאשכול ─────────────────────────────────────
 *
 * הגרסה הראשונה שאלה "ציר אחד לכל ההצעות, או דחייה". כל 20 האשכולות
 * נדחו, ושתי הדחיות המעניינות היו:
 *
 *   אשכול 17: "עוסקות ברובן בזכויות אסירים... אך כוללות גם הצעה זרה
 *              לחלוטין מתחום ההשכלה הגבוהה"
 *   אשכול 18: "מרביתן עוסקות בהגבלת גביית אגרה בכביש 6... בעוד הצעה 9
 *              עוסקת בגביית חובות רשות המים"
 *
 * כלומר 14 הצעות טובות נפלו בגלל אחת. השאלה הבינארית הייתה שגויה.
 *
 * מתחת לזה טעות עמוקה יותר: הטמעות מקבצות לפי דמיון סמנטי, שקרוב
 * לתחום. ציר הוא מחלוקת. לכן "אגרת כביש 6" ו"גביית חובות רשות המים"
 * נפלו יחד — שתיהן על גבייה — ובכל זאת הן שני ויכוחים שונים.
 *
 * כאן המודל מקבל את כל ההצעות באשכול, ומחזיר כמה צירים שהוא מוצא,
 * עם מספרי ההצעות לכל ציר ורשימה מפורשת של מה שאינו שייך לאף אחד.
 *
 * ── על המכסה ─────────────────────────────────────────────────────────
 *
 *   retries = 0   ניסיון חוזר הוא בקשה נוספת. עדיף שאשכול ייכשל
 *                 וידווח מאשר שהמכסה תיבלע על אשכול אחד.
 *   JSONL         כל תשובה נכתבת מיד; הרצה חוזרת מדלגת על מה שכבר יש.
 *
 *   npx tsx scripts/draft-axes-from-clusters.ts --dry-run
 *   npx tsx scripts/draft-axes-from-clusters.ts
 *   npx tsx scripts/draft-axes-from-clusters.ts --top 5
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { geminiFetch, geminiUrl, GEMINI_MODEL, DailyQuotaError } from '../src/lib/gemini-fetch';
import { buildClusters, MIN_CLUSTER, THRESHOLD, type OrphanRow } from './lib/orphan-clustering';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const DRAFTS = path.join(process.cwd(), 'axis-drafts.jsonl');
const REVIEW = path.join(process.cwd(), 'axis-drafts.csv');

const dryRun = process.argv.includes('--dry-run');
const topArg = process.argv.indexOf('--top');
const TOP = topArg >= 0 ? Number(process.argv[topArg + 1]) : 20;

/** ציר עם פחות מזה אינו מצדיק שאלה בשאלון */
const MIN_AXIS = 4;

interface AxisOut {
  question: string; pro: string; con: string;
  topic: string; subtopic: string;
  billIds: number[];
}
interface Draft {
  clusterIndex: number;
  billCount: number;
  axes: AxisOut[];
  unassigned: number[];
  note?: string;
}

function apiKey(): string {
  for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
    if (line.startsWith('GEMINI_API_KEY=')) return line.slice('GEMINI_API_KEY='.length).trim();
  }
  throw new Error('אין GEMINI_API_KEY ב-.env.local');
}

/*
  כל ההצעות באשכול נשלחות, ולא מדגם. בלי זה המודל יכול לשייך רק את מה
  שראה, וכל השאר היה נושר בשקט. האשכול הגדול הוא 78 הצעות, ובעלות
  הנוכחית זה זניח.
*/
function buildPrompt(bills: OrphanRow[]): string {
  const list = bills
    .map((b, i) => `[${i + 1}] ${b.title}\n     ${b.text.slice(0, 240)}`).join('\n\n');
  return `להלן ${bills.length} הצעות חוק מהכנסת ה-25 שקובצו יחד לפי דמיון בתוכן. הקיבוץ אוטומטי ואינו מדויק — ייתכן שהן מכילות כמה נושאים נפרדים, וייתכן שחלקן אינן שייכות לאף קבוצה.

${list}

המשימה: לזהות אילו צירי מחלוקת פוליטיים קיימים כאן, ולשייך כל הצעה לציר שלה.

כללים:
- ציר הוא שאלה שיש עליה מחלוקת אמיתית בכנסת. אם כל הסיעות מסכימות, זה לא ציר.
- ציר צריך לפחות ${MIN_AXIS} הצעות. קבוצה קטנה מזה — שלח את ההצעות ל-unassigned.
- אל תאחד בכוח נושאים רחוקים. עדיף שלושה צירים נקיים מאחד מעורפל.
- מוטב לשלוח הצעה ל-unassigned מלדחוף אותה לציר שאינו שלה.
- כל מספר הצעה מופיע פעם אחת בלבד בכל התשובה.
- השאלה מתחילה ב"האם", עד 12 מילים.
- שני הצדדים מנוסחים כעמדה לגיטימית, בגוף שלישי, בלי לרמוז מי צודק.
- כל עמדה: משפט אחד עד 28 מילים, שמסביר גם למה מחזיקים בה.

אם אין כאן אף ציר — החזר axes ריק וכתוב note.

החזר JSON בלבד:
{"axes":[{"question":"האם ...?","pro":"...","con":"...","topic":"...","subtopic":"...","bills":[1,4,7]}],"unassigned":[2,3],"note":""}`;
}

/** ממפה את המספרים שהמודל החזיר חזרה ל-bill_id, ופוסל מה שאינו תקין */
function toDraft(ci: number, bills: OrphanRow[], parsed: {
  axes?: Array<Record<string, unknown>>; unassigned?: number[]; note?: string;
}): Draft {
  const seen = new Set<number>();
  const idx = (n: unknown): number | null => {
    const v = Number(n);
    if (!Number.isInteger(v) || v < 1 || v > bills.length) return null;
    if (seen.has(v)) return null;   // שיוך כפול — נספר פעם אחת
    seen.add(v);
    return v - 1;
  };

  const axes: AxisOut[] = [];
  for (const a of parsed.axes ?? []) {
    const ids = (Array.isArray(a.bills) ? a.bills : [])
      .map(idx).filter((v): v is number => v !== null).map(i => bills[i].billId);
    if (!a.question || ids.length < MIN_AXIS) continue;
    axes.push({
      question: String(a.question), pro: String(a.pro ?? ''), con: String(a.con ?? ''),
      topic: String(a.topic ?? ''), subtopic: String(a.subtopic ?? ''), billIds: ids,
    });
  }
  /*
    כל מה שלא שויך לציר תקף נחשב unassigned, גם אם המודל לא הזכיר
    אותו. כך המאזן תמיד סוגר ואף הצעה לא נעלמת בשקט — זו בדיוק
    התקלה שהעלימה עשר הצעות בהרצת ההצלה.
  */
  const assigned = new Set(axes.flatMap(a => a.billIds));
  const unassigned = bills.map(b => b.billId).filter(id => !assigned.has(id));
  return { clusterIndex: ci, billCount: bills.length, axes, unassigned, note: parsed.note };
}

async function askGemini(bills: OrphanRow[], key: string, label: string): Promise<Record<string, unknown> | null> {
  const res = await geminiFetch(
    geminiUrl('generateContent', key),
    {
      contents: [{ parts: [{ text: buildPrompt(bills) }] }],
      /*
        8192 לא הספיק: אשכול של 27 הצעות נקטע על MAX_TOKENS באמצע
        ה-JSON. תשובה עם ארבעה צירים ורשימות מזהים ארוכות תופסת יותר
        ממה שנראה, ותשובה קטועה היא בקשה שהתבזבזה במלואה.
      */
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 32768 },
    },
    { retries: 0, timeoutMs: 90_000, label },
  );
  if (!res.ok) { console.log(`    ✗ ${res.status}`); return null; }
  const body = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  };
  const cand = body.candidates?.[0];
  /*
    finishReason נבדק לפני התוכן. התעלמות ממנו היא מה שגרם בעבר
    לשמירת תשובה קטועה בת 15 תווים בקאש לצמיתות.
  */
  if (cand?.finishReason && cand.finishReason !== 'STOP') {
    console.log(`    ✗ נקטע: ${cand.finishReason}`);
    return null;
  }
  const text = (cand?.content?.parts ?? []).map(p => p.text ?? '').join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]) as Record<string, unknown>; } catch { return null; }
}

async function main(): Promise<void> {
  const db = new Database(DB_PATH, { readonly: true });
  console.log(`מודל: ${GEMINI_MODEL}\n`);

  const { kept, groups, skipped } = await buildClusters(db);
  if (skipped.length) console.log(`⚠ ${skipped.length} הצעות ללא וקטור, מחוץ לניתוח`);

  const big = groups.filter(g => g.length >= MIN_CLUSTER).slice(0, TOP);
  console.log(`${big.length} אשכולות בסף ${THRESHOLD} · ${big.reduce((s, g) => s + g.length, 0)} הצעות\n`);

  const done = new Map<number, Draft>();
  if (fs.existsSync(DRAFTS)) {
    for (const line of fs.readFileSync(DRAFTS, 'utf8').split('\n').filter(Boolean)) {
      const d = JSON.parse(line) as Draft;
      if (Array.isArray(d.axes)) done.set(d.clusterIndex, d);
    }
    if (done.size) console.log(`${done.size} אשכולות כבר בקובץ, מדלג עליהם\n`);
  }

  if (dryRun) {
    console.log(buildPrompt(big[0].map(i => kept[i])).slice(0, 1500));
    console.log(`\n--dry-run — ${big.length - done.size} בקשות היו נשלחות.`);
    db.close();
    return;
  }

  const key = apiKey();
  let quotaHit = false, failed = 0;

  for (let ci = 0; ci < big.length && !quotaHit; ci++) {
    if (done.has(ci)) continue;
    const bills = big[ci].map(i => kept[i]);
    console.log(`  אשכול ${ci + 1}/${big.length} · ${bills.length} הצעות · ${bills[0].domain}`);

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = await askGemini(bills, key, `cluster-${ci}`);
    } catch (e) {
      if (e instanceof DailyQuotaError) {
        console.log(`\n  המכסה היומית נגמרה (${e.quotaValue ?? '20'}). מה שנוסח נשמר.`);
        quotaHit = true;
        break;
      }
      throw e;
    }

    /*
      תקלת תעבורה אינה החלטה. 503, תשובה קטועה או JSON שבור אינם
      נרשמים — אחרת ההרצה החוזרת הייתה מדלגת עליהם ואשכול שנפל על
      תקלת רשת היה נקבר לנצח.
    */
    if (!parsed || !Array.isArray(parsed.axes)) {
      console.log('    ↻ ללא תשובה תקפה — יידון שוב בהרצה הבאה');
      failed++;
      continue;
    }

    const draft = toDraft(ci, bills, parsed as Parameters<typeof toDraft>[2]);
    fs.appendFileSync(DRAFTS, JSON.stringify(draft) + '\n');
    done.set(ci, draft);

    if (!draft.axes.length) {
      console.log(`    — אין ציר: ${(draft.note ?? '').slice(0, 64)}`);
    } else {
      for (const a of draft.axes) console.log(`    ✓ ${a.billIds.length.toString().padStart(2)} · ${a.question}`);
      if (draft.unassigned.length) console.log(`      (${draft.unassigned.length} לא שויכו)`);
    }
    await new Promise(r => setTimeout(r, 1_000));
  }

  const all = [...done.values()].sort((a, b) => a.clusterIndex - b.clusterIndex);
  const axes = all.flatMap(d => d.axes);
  const assigned = axes.reduce((s, a) => s + a.billIds.length, 0);
  const seen = all.reduce((s, d) => s + d.billCount, 0);

  console.log(`\n═══ סיכום ═══`);
  console.log(`  אשכולות שנבדקו : ${all.length}/${big.length}`);
  console.log(`  צירים שנוסחו   : ${axes.length}`);
  console.log(`  הצעות ששויכו   : ${assigned} מתוך ${seen}  (${Math.round(assigned / (seen || 1) * 100)}%)`);
  console.log(`  לא שויכו       : ${seen - assigned}`);
  if (failed) console.log(`  נכשלו          : ${failed}  (לא נרשמו — יידונו שוב)`);
  if (quotaHit) console.log(`  נעצר על המכסה.`);

  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  const lines = [['אשכול', 'הצעות בציר', 'שאלה', 'בעד', 'נגד', 'נושא', 'תת-נושא', 'bill_ids']
    .map(esc).join(',')];
  for (const d of all) {
    for (const a of d.axes) {
      lines.push([d.clusterIndex + 1, a.billIds.length, a.question, a.pro, a.con,
        a.topic, a.subtopic, a.billIds.join(' ')].map(esc).join(','));
    }
  }
  fs.writeFileSync(REVIEW, '﻿' + lines.join('\n') + '\n');
  console.log(`\nנכתב: ${path.basename(REVIEW)} · ${path.basename(DRAFTS)}`);
  console.log('לא נכתב דבר למסד ולא לקטלוג הצירים.');
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
