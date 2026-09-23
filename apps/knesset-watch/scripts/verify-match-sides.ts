/**
 * אימות הצד של ההתאמות, בנפרד משאלת הציר.
 *
 * ── למה ──────────────────────────────────────────────────────────────
 *
 * מתוך 363 התאמות בביטחון גבוה, 348 יצאו "בעד" ו-15 "נגד" — 95.9%.
 * חלק מזה אמיתי, כי רוב הצעות החוק הפרטיות מרחיבות זכויות ותקציבים,
 * אבל במדגם כבר נמצא מקרה שבו הצד נקבע הפוך:
 *
 *   "תיעוד חזותי של השימוש במכת״זית לפיזור הפגנות" שויכה ל"האם
 *   להרחיב את סמכויות המשטרה?" בצד "בעד" — בעוד שההצעה מגבילה
 *   את המשטרה.
 *
 * ── איך הבדיקה מנטרלת את ההטיה ───────────────────────────────────────
 *
 * שתי העמדות מוצגות בלי התוויות "בעד" ו"נגד", כ"עמדה 1" ו"עמדה 2",
 * והסדר ביניהן מתהפך בחצי מהצירים. אילו הוצגו מתויגות ובסדר קבוע,
 * מודל שנוטה לצד המנוסח בחיוב היה מאשר את עצמו.
 *
 * ההיפוך נקבע מ-hash של מזהה הציר ולכן קבוע בין הרצות, וניתן לשחזר
 * כל תוצאה.
 *
 * הסקריפט אינו כותב למסד. הפלט הוא JSONL עם הצד המאומת.
 *
 *   npx tsx scripts/verify-match-sides.ts
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { geminiFetch, geminiUrl, DailyQuotaError } from '../src/lib/gemini-fetch';
import { CLUSTERS } from '../src/lib/axis-clusters';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const MATCHES = path.join(process.cwd(), 'orphan-matches.jsonl');
const OUT = path.join(process.cwd(), 'orphan-sides.jsonl');

interface Match { billId: number; issueId: string | null; side: string | null; confidence?: string }
interface Verdict { billId: number; issueId: string; original: string; verified: string | null }

const AXES = new Map(CLUSTERS.flatMap(c => c.questions.map(q => [q.issueId, q] as const)));

function apiKey(): string {
  for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
    if (line.startsWith('GEMINI_API_KEY=')) return line.slice('GEMINI_API_KEY='.length).trim();
  }
  throw new Error('אין GEMINI_API_KEY ב-.env.local');
}

/** האם להציג את הצד ה"נגד" ראשון. קבוע לכל ציר, כדי שההרצה תהיה ניתנת לשחזור. */
function flipped(issueId: string): boolean {
  return parseInt(crypto.createHash('sha256').update(issueId).digest('hex').slice(0, 2), 16) % 2 === 1;
}

function buildPrompt(issueId: string, bills: Array<{ id: number; title: string; change: string }>): string {
  const axis = AXES.get(issueId)!;
  const flip = flipped(issueId);
  const first = flip ? axis.stances[1] : axis.stances[0];
  const second = flip ? axis.stances[0] : axis.stances[1];
  const list = bills.map(b => `[${b.id}] ${b.title}\n     ${b.change.slice(0, 240)}`).join('\n\n');
  return `שאלת מדיניות: ${axis.question}

עמדה 1: ${first.label}

עמדה 2: ${second.label}

להלן הצעות חוק מהכנסת ה-25:

${list}

לכל הצעה: איזו מהשתיים היא מקדמת בפועל?

- החלט לפי מה שההצעה משנה בחוק, לא לפי הכותרת ולא לפי מי יזם אותה.
- הצעה שמטילה חובת דיווח, פיקוח או מגבלה על גוף — מקדמת את העמדה
  שמצמצמת את כוחו של אותו גוף, גם אם היא מרחיבה את החוק שמסדיר אותו.
- אם ההצעה אינה מקדמת אף אחת מהשתיים, החזר 0.

החזר JSON בלבד:
{"sides":[{"billId":123,"position":1},{"billId":124,"position":2},{"billId":125,"position":0}]}`;
}

async function askAxis(issueId: string, bills: Array<{ id: number; title: string; change: string }>, key: string):
  Promise<Map<number, string | null> | null> {
  const res = await geminiFetch(
    geminiUrl('generateContent', key),
    {
      contents: [{ parts: [{ text: buildPrompt(issueId, bills) }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json', maxOutputTokens: 8192 },
    },
    { retries: 0, timeoutMs: 90_000, label: issueId },
  );
  if (!res.ok) return null;
  const body = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  };
  const cand = body.candidates?.[0];
  if (cand?.finishReason && cand.finishReason !== 'STOP') return null;
  const m = ((cand?.content?.parts ?? []).map(p => p.text ?? '').join('')).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const p = JSON.parse(m[0]) as { sides?: Array<{ billId?: number; position?: number }> };
    const flip = flipped(issueId);
    const out = new Map<number, string | null>();
    for (const r of p.sides ?? []) {
      const pos = Number(r.position);
      if (pos !== 1 && pos !== 2) { out.set(Number(r.billId), null); continue; }
      /* עמדה 1 היא pro רק כשלא התהפך */
      const isFirstPro = !flip;
      out.set(Number(r.billId), (pos === 1) === isFirstPro ? 'pro' : 'con');
    }
    return out;
  } catch { return null; }
}

async function main(): Promise<void> {
  const db = new Database(DB_PATH, { readonly: true });
  const high = fs.readFileSync(MATCHES, 'utf8').split('\n').filter(Boolean)
    .map(l => JSON.parse(l) as Match)
    .filter(m => m.issueId && m.side && m.confidence === 'high' && AXES.has(m.issueId));

  const byAxis = new Map<string, Match[]>();
  for (const m of high) {
    if (!byAxis.has(m.issueId!)) byAxis.set(m.issueId!, []);
    byAxis.get(m.issueId!)!.push(m);
  }
  console.log(`${high.length} התאמות על ${byAxis.size} צירים`);
  console.log(`סדר העמדות מתהפך ב-${[...byAxis.keys()].filter(flipped).length} מהם\n`);

  const done = new Map<number, Verdict>();
  if (fs.existsSync(OUT)) {
    for (const line of fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean)) {
      const v = JSON.parse(line) as Verdict;
      done.set(v.billId, v);
    }
    if (done.size) console.log(`${done.size} כבר בקובץ\n`);
  }

  const key = apiKey();
  let i = 0;
  for (const [issueId, ms] of byAxis) {
    i++;
    if (ms.every(m => done.has(m.billId))) continue;
    const bills = ms.map(m => {
      const r = db.prepare(`SELECT b.title AS title,
          (SELECT policy_change FROM bill_policy_issue WHERE bill_id = b.id LIMIT 1) AS change
        FROM bill b WHERE b.id = ?`).get(m.billId) as { title: string; change: string | null };
      return { id: m.billId, title: r?.title ?? '', change: r?.change ?? '' };
    });
    process.stdout.write(`\r  ${i}/${byAxis.size} ...      `);
    let res: Map<number, string | null> | null = null;
    try { res = await askAxis(issueId, bills, key); } catch (e) {
      if (e instanceof DailyQuotaError) { console.log('\nהמכסה נגמרה. מה שנבדק נשמר.'); break; }
      throw e;
    }
    if (!res) continue;
    for (const m of ms) {
      const v: Verdict = {
        billId: m.billId, issueId, original: m.side!,
        verified: res.has(m.billId) ? res.get(m.billId)! : null,
      };
      fs.appendFileSync(OUT, JSON.stringify(v) + '\n');
      done.set(m.billId, v);
    }
    await new Promise(r => setTimeout(r, 600));
  }
  process.stdout.write('\n');

  const all = [...done.values()];
  const agree = all.filter(v => v.verified === v.original);
  const flip = all.filter(v => v.verified && v.verified !== v.original);
  const none = all.filter(v => !v.verified);
  console.log(`\n═══ תוצאה ═══`);
  console.log(`  נבדקו   : ${all.length}`);
  console.log(`  מאשרות  : ${agree.length}`);
  console.log(`  הפוכות  : ${flip.length}   ← היו נכתבות בצד השגוי`);
  console.log(`  ללא צד  : ${none.length}`);
  const proAfter = all.filter(v => (v.verified ?? v.original) === 'pro').length;
  console.log(`\n  לפני : בעד ${all.filter(v => v.original === 'pro').length} · נגד ${all.filter(v => v.original === 'con').length}`);
  console.log(`  אחרי : בעד ${proAfter} · נגד ${all.length - none.length - proAfter}`);

  if (flip.length) {
    console.log(`\n═══ דוגמאות להיפוך ═══`);
    for (const v of flip.slice(0, 8)) {
      const t = (db.prepare('SELECT title FROM bill WHERE id = ?').get(v.billId) as { title: string }).title;
      console.log(`  ${t.slice(0, 56)}`);
      console.log(`     ${AXES.get(v.issueId)?.question.slice(0, 56)}`);
      console.log(`     ${v.original} → ${v.verified}`);
    }
  }
  console.log(`\nנכתב: ${path.basename(OUT)} · לא נכתב דבר למסד.`);
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
