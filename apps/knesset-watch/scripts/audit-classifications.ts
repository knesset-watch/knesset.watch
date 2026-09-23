/**
 * ביקורת על הסיווגים הקיימים: האם ההצעה באמת שייכת לציר שהיא משויכת
 * אליו, ובצד הנכון?
 *
 * ── למה ──────────────────────────────────────────────────────────────
 *
 * כל השגיאות שהתגלו עד היום היו בסיווג שכבר ישב במסד, וכולן עלו
 * במקרה מתוך בדיקה של משהו אחר:
 *
 *   טיפולי המרה            → בריאות הנפש
 *   "הגדרת פשע שנאה"       → הטרדות מיניות
 *   חמש הצעות כתות פוגעניות → פגיעה בחסרי ישע
 *   תשע הצעות תוצרת מקומית  → הצד ההפוך
 *
 * אין סיבה להניח שאלה היחידות.
 *
 * ── ניטרול ההטיה ─────────────────────────────────────────────────────
 *
 * שתי העמדות מוצגות בלי התוויות "בעד" ו"נגד", והסדר ביניהן מתהפך
 * בכמחצית הצירים לפי hash של המזהה. בלי זה מודל שנוטה לצד המנוסח
 * בחיוב מאשר את עצמו, והביקורת חסרת ערך.
 *
 * הביקורת גם אינה מספרת למודל מה הצד הקיים — היא שואלת מאפס ומשווה
 * אחר כך. אחרת "האם הסיווג הזה נכון?" הוא שאלה מוטה מעצם ניסוחה.
 *
 * ── מה הסקריפט לא עושה ───────────────────────────────────────────────
 *
 * אינו כותב למסד. הפלט הוא JSONL ו-CSV, ורק אחרי שנסתכל על הפילוח
 * נחליט מה לתקן. ביקורת שמסמנת 8% כשגויים היא 490 הצעות, ולהחיל
 * אותה בעיוורון מסוכן יותר מלהשאיר את השגיאות.
 *
 *   npx tsx scripts/audit-classifications.ts            מדגם של 500
 *   npx tsx scripts/audit-classifications.ts --all      הכול
 *   npx tsx scripts/audit-classifications.ts --dry-run  מראה את הפרומפט
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { geminiFetch, geminiUrl, DailyQuotaError } from '../src/lib/gemini-fetch';
import { CLUSTERS } from '../src/lib/axis-clusters';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const OUT = path.join(process.cwd(), 'audit-classifications.jsonl');
const CSV = path.join(process.cwd(), 'audit-classifications.csv');

const all = process.argv.includes('--all');
const dryRun = process.argv.includes('--dry-run');
const SAMPLE = 500;
/** כמה הצעות בבקשה. כולן מאותו ציר, כדי שהעמדות יישלחו פעם אחת. */
const BATCH = 8;

const AXES = new Map(CLUSTERS.flatMap(c => c.questions.map(q => [q.issueId, q] as const)));

interface Row { billId: number; issueId: string; stanceId: string; title: string; change: string }
interface Verdict {
  billId: number; issueId: string;
  /** belongs | wrong-axis | unsure */
  fit: string;
  currentSide: string;
  auditedSide: string | null;
  why?: string;
}

function apiKey(): string {
  for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
    if (line.startsWith('GEMINI_API_KEY=')) return line.slice('GEMINI_API_KEY='.length).trim();
  }
  throw new Error('אין GEMINI_API_KEY ב-.env.local');
}

/** קבוע לכל ציר, כדי שההרצה תהיה ניתנת לשחזור */
function flipped(issueId: string): boolean {
  return parseInt(crypto.createHash('sha256').update(issueId).digest('hex').slice(0, 2), 16) % 2 === 1;
}

function buildPrompt(issueId: string, bills: Row[]): string {
  const axis = AXES.get(issueId)!;
  const flip = flipped(issueId);
  const first = flip ? axis.stances[1] : axis.stances[0];
  const second = flip ? axis.stances[0] : axis.stances[1];
  const list = bills.map(b => `[${b.billId}] ${b.title}\n     ${b.change.slice(0, 240)}`).join('\n\n');
  return `שאלת מדיניות:
${axis.question}

עמדה 1: ${first.label}

עמדה 2: ${second.label}

להלן הצעות חוק מהכנסת ה-25:

${list}

לכל הצעה, שתי שאלות:

א. האם ההצעה באמת נופלת על שאלת המדיניות הזו?
   "belongs"    — כן, זו המחלוקת שההצעה מכריעה בה
   "wrong-axis" — לא, ההצעה עוסקת בשאלה אחרת
   "unsure"     — לא ברור

ב. אם כן — איזו משתי העמדות היא מקדמת בפועל? 1 או 2, ו-0 אם אף אחת.

כללים:
- החלט לפי מה שההצעה משנה בחוק, לא לפי הכותרת ולא לפי מי יזם אותה.
- הצעה שמטילה חובת דיווח, פיקוח או מגבלה על גוף — מקדמת את העמדה
  שמצמצמת את כוחו של אותו גוף, גם אם היא מרחיבה את החוק שמסדיר אותו.
- קרבת נושא אינה שייכות. הצעה יכולה לעסוק באותו תחום ובשאלה אחרת
  לגמרי, וזה "wrong-axis".

שתי טעויות הפוכות שכדאי להימנע מהן, כלומר פסילה של שיוך תקין:

  שאלה מורכבת מסתפקת בחלק אחד. "האם להחמיר ענישה ולקבוע עונשי
  מינימום?" היא שתי דרישות חלופיות ולא מצטברות. הצעה שמכפילה את
  העונש המרבי ואינה קובעת עונש מינימום — "belongs". היא נופלת על
  החלק הראשון, וזה מספיק.

  ציר רחב מחזיק בצדק הצעות שנושאן הספציפי שונה. הצעה להחמרת ענישה
  על התעללות בבעלי חיים שייכת גם לציר על ענישה וגם לציר על בעלי
  חיים; ששניהם נכונים אינו הופך אף אחד מהם לשגוי. השאלה אינה "על
  מה ההצעה?" אלא "האם היא מכריעה בוויכוח שהציר מתאר?".

  הציר נמדד לפי המטרה, לא לפי המנגנון. ניסוח העמדה נותן דוגמאות
  ולא רשימה סגורה. "יש להרחיב את הסבסוד והמענים החברתיים
  והתזונתיים בבתי הספר כדי לצמצם פערים" — הסעות חינם לתלמידים
  שגרים רחוק הן בדיוק סבסוד כזה, גם שאינן הזנה. "belongs".

"wrong-axis" נשמר למקרים שבהם ההצעה אינה מכריעה בוויכוח הזה כלל —
כמו הצעה על הסדרת ענף הפוקר תחת ציר של ענישה פלילית.

החזר JSON בלבד:
{"results":[{"billId":123,"fit":"belongs","position":1,"why":"נימוק קצר"}]}`;
}

async function askAxis(issueId: string, bills: Row[], key: string): Promise<Verdict[] | null> {
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
    const p = JSON.parse(m[0]) as { results?: Array<Record<string, unknown>> };
    const flip = flipped(issueId);
    const byId = new Map(bills.map(b => [b.billId, b]));
    return (p.results ?? []).flatMap(r => {
      const b = byId.get(Number(r.billId));
      if (!b) return [];
      const pos = Number(r.position);
      const side = (pos === 1 || pos === 2)
        ? ((pos === 1) === !flip ? 'pro' : 'con')
        : null;
      const fit = ['belongs', 'wrong-axis', 'unsure'].includes(String(r.fit)) ? String(r.fit) : 'unsure';
      return [{
        billId: b.billId, issueId,
        fit,
        currentSide: b.stanceId.endsWith('_pro') ? 'pro' : 'con',
        auditedSide: side,
        why: r.why ? String(r.why) : undefined,
      }];
    });
  } catch { return null; }
}

async function main(): Promise<void> {
  const db = new Database(DB_PATH, { readonly: true });

  const rows = db.prepare(`
    SELECT c.bill_id AS billId, c.issue_id AS issueId, c.stance_id AS stanceId,
           b.title AS title,
           COALESCE((SELECT policy_change FROM bill_policy_issue WHERE bill_id = b.id LIMIT 1),'') AS change
    FROM bill_political_classification c JOIN bill b ON b.id = c.bill_id
    ORDER BY c.issue_id, c.bill_id`).all() as Row[];
  const live = rows.filter(r => AXES.has(r.issueId));
  console.log(`שיוכים במסד : ${rows.length}`);
  console.log(`על צירים חיים: ${live.length}`);
  if (rows.length !== live.length) {
    console.log(`⚠ ${rows.length - live.length} שיוכים מצביעים על ציר שאינו בשאלון — מחוץ לביקורת`);
  }

  /* מדגם שיטתי, פרוס על כל הצירים, ניתן לשחזור */
  const step = Math.max(1, Math.floor(live.length / SAMPLE));
  const work = all ? live : live.filter((_, i) => i % step === 0).slice(0, SAMPLE);
  console.log(all ? `\nמבקר את כל ${work.length}` : `\nמדגם שיטתי: ${work.length} (כל ה-${step}-ית)`);

  const byAxis = new Map<string, Row[]>();
  for (const r of work) {
    if (!byAxis.has(r.issueId)) byAxis.set(r.issueId, []);
    byAxis.get(r.issueId)!.push(r);
  }
  console.log(`על ${byAxis.size} צירים · סדר העמדות מתהפך ב-${[...byAxis.keys()].filter(flipped).length} מהם\n`);

  if (dryRun) {
    const [id, bs] = [...byAxis][0];
    console.log(buildPrompt(id, bs.slice(0, 3)).slice(0, 1500));
    db.close();
    return;
  }

  const done = new Map<string, Verdict>();
  const k = (v: { billId: number; issueId: string }) => `${v.billId}|${v.issueId}`;
  if (fs.existsSync(OUT)) {
    for (const line of fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean)) {
      const v = JSON.parse(line) as Verdict;
      done.set(k(v), v);
    }
    if (done.size) console.log(`${done.size} כבר בקובץ\n`);
  }

  const key = apiKey();
  let i = 0, quota = false;
  for (const [issueId, bs] of byAxis) {
    if (quota) break;
    for (let j = 0; j < bs.length && !quota; j += BATCH) {
      const batch = bs.slice(j, j + BATCH).filter(b => !done.has(k(b)));
      if (!batch.length) continue;
      i += batch.length;
      process.stdout.write(`\r  ${i}/${work.length} ...      `);
      let res: Verdict[] | null = null;
      try { res = await askAxis(issueId, batch, key); } catch (e) {
        if (e instanceof DailyQuotaError) { console.log('\nהמכסה נגמרה. מה שנבדק נשמר.'); quota = true; break; }
        throw e;
      }
      if (!res) continue;
      for (const v of res) { fs.appendFileSync(OUT, JSON.stringify(v) + '\n'); done.set(k(v), v); }
      await new Promise(r => setTimeout(r, 600));
    }
  }
  process.stdout.write('\n');

  const audited = work.map(r => done.get(k(r))).filter((v): v is Verdict => !!v);
  const belongs = audited.filter(v => v.fit === 'belongs');
  const wrongAxis = audited.filter(v => v.fit === 'wrong-axis');
  const unsure = audited.filter(v => v.fit === 'unsure');
  const sideFlip = belongs.filter(v => v.auditedSide && v.auditedSide !== v.currentSide);
  const ok = belongs.filter(v => v.auditedSide === v.currentSide);

  console.log('\n═══ תוצאת הביקורת ═══');
  console.log(`  נבדקו          : ${audited.length}`);
  console.log(`  תקינים לגמרי   : ${ok.length}  (${Math.round(ok.length / (audited.length || 1) * 100)}%)`);
  console.log(`  ציר שגוי       : ${wrongAxis.length}  (${Math.round(wrongAxis.length / (audited.length || 1) * 100)}%)`);
  console.log(`  צד הפוך        : ${sideFlip.length}  (${Math.round(sideFlip.length / (audited.length || 1) * 100)}%)`);
  console.log(`  לא ברור        : ${unsure.length}`);
  if (!all && audited.length) {
    const rate = (wrongAxis.length + sideFlip.length) / audited.length;
    console.log(`\n  בהשלכה ל-${live.length} השיוכים: כ-${Math.round(rate * live.length)} בעייתיים`);
  }

  const byIssue = new Map<string, number>();
  for (const v of [...wrongAxis, ...sideFlip]) byIssue.set(v.issueId, (byIssue.get(v.issueId) ?? 0) + 1);
  if (byIssue.size) {
    console.log('\n═══ צירים עם הכי הרבה בעיות ═══');
    for (const [id, n] of [...byIssue].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`  ${String(n).padStart(3)} · ${AXES.get(id)?.question.slice(0, 58)}`);
    }
  }

  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  const lines = [['bill_id', 'כותרת', 'הציר הנוכחי', 'שייך?', 'הצד הנוכחי', 'הצד לפי הביקורת', 'נימוק']
    .map(esc).join(',')];
  const titles = new Map(work.map(r => [r.billId, r.title]));
  for (const v of audited) {
    if (v.fit === 'belongs' && v.auditedSide === v.currentSide) continue;
    lines.push([v.billId, titles.get(v.billId), AXES.get(v.issueId)?.question,
      v.fit, v.currentSide, v.auditedSide ?? '', v.why].map(esc).join(','));
  }
  fs.writeFileSync(CSV, '﻿' + lines.join('\n') + '\n');
  console.log(`\nנכתב: ${path.basename(CSV)} (${lines.length - 1} בעייתיים) · לא נכתב דבר למסד.`);
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
