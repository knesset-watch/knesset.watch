/**
 * מציאת בית חדש להצעות שהביקורת פסלה את הציר שלהן.
 *
 * ── הכלל המרכזי ──────────────────────────────────────────────────────
 *
 * מהימנות לפני כיסוי. שיוך שגוי גרוע מיתמות: הוא מזכה ח"כ על עבודה
 * שלא עשה ומופיע בדירוג שמישהי עשויה לפעול לפיו, בעוד הצעה יתומה רק
 * אינה נספרת. לכן שיוך שנפסל בביקורת ולא נמצא לו בית חדש — יימחק.
 *
 * (זו החלטה של דינה, אחרי שהצעתי את ההפך. ההצעה שלי הייתה להשאיר
 * שיוך פגום כדי לא לאבד כיסוי, והיא דחתה אותה בצדק.)
 *
 * כאן מחפשים ציר חלופי מתוך 182 הקיימים, ורק ביטחון גבוה מחליף.
 * מה שלא נמצא לו בית מסומן למחיקה בשלב ההחלה.
 *
 * ── תופעת לוואי שצריך למדוד לפני ההחלה ───────────────────────────────
 *
 * מחיקת שיוכים יכולה להוריד ציר מתחת ל-MIN_BILLS_PER_ISSUE, ואז הוא
 * נעלם מהשאלון כולו — לא רק ההצעות שלו. שלב ההחלה חייב לדווח אילו
 * צירים ייעלמו לפני שנוגעים במסד.
 *
 * ── מה הסקריפט עושה ולא עושה ─────────────────────────────────────────
 *
 * אינו כותב למסד. הפלט הוא JSONL ו-CSV עם הצעת ההחלפה, וההחלה היא
 * שלב נפרד שנעשה רק אחרי שנסתכל על הפילוח.
 *
 * הצד אינו נקבע כאן. הוא נקבע ב-verify-match-sides, שמציג את שתי
 * העמדות בלי שמן ובסדר מתחלף — הדרך היחידה שהוכיחה את עצמה.
 *
 *   npx tsx scripts/rehome-wrong-axis.ts            כל מה שנפסל
 *   npx tsx scripts/rehome-wrong-axis.ts --limit 200
 *   npx tsx scripts/rehome-wrong-axis.ts --dry-run
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { geminiFetch, geminiUrl, DailyQuotaError } from '../src/lib/gemini-fetch';
import { CLUSTERS } from '../src/lib/axis-clusters';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
/*
  ברירת המחדל היא הקובץ המסונן — רק שיוכים ששני פרומפטים שונים פסלו.
  פסילה של פרומפט אחד בלבד אינה מספיקה: ההשוואה בין הסבבים הראתה 454
  כאלה, והן בדיוק פסילות השווא שהתיקון בפרומפט הסיר.
*/
const inArg = process.argv.indexOf('--input');
const AUDIT = path.join(process.cwd(),
  inArg >= 0 ? process.argv[inArg + 1] : 'audit-stable.jsonl');
const OUT = path.join(process.cwd(), 'rehome-suggestions.jsonl');
const CSV = path.join(process.cwd(), 'rehome-suggestions.csv');

const dryRun = process.argv.includes('--dry-run');
const limArg = process.argv.indexOf('--limit');
const LIMIT = limArg >= 0 ? Number(process.argv[limArg + 1]) : Infinity;
const BATCH = 10;

const AXES = CLUSTERS.flatMap(c => c.questions.map(q => ({ id: q.issueId, q: q.question })));
const AX_Q = new Map(AXES.map(a => [a.id, a.q]));

interface Audit { billId: number; issueId: string; fit: string }
interface Rehome {
  billId: number;
  oldIssueId: string;
  newIssueId: string | null;
  confidence?: string;
  why?: string;
}

function apiKey(): string {
  for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
    if (line.startsWith('GEMINI_API_KEY=')) return line.slice('GEMINI_API_KEY='.length).trim();
  }
  throw new Error('אין GEMINI_API_KEY ב-.env.local');
}

function buildPrompt(bills: Array<{ id: number; title: string; change: string; oldQ: string }>): string {
  const axisList = AXES.map(a => `${a.id} | ${a.q}`).join('\n');
  const billList = bills.map(b =>
    `[${b.id}] ${b.title}\n     ${b.change.slice(0, 240)}\n     (משויכת כעת ל: ${b.oldQ})`).join('\n\n');
  return `להלן צירי המחלוקת הקיימים באתר:

${axisList}

והלן הצעות חוק שהשיוך הנוכחי שלהן עלה לבדיקה:

${billList}

לכל הצעה: לאיזה ציר מהרשימה היא באמת שייכת?

כללים:
- הציר הנוכחי הוא אפשרות לגיטימית. אם אחרי שקילה הוא עדיין המתאים
  ביותר, בחר בו — זו תשובה תקפה ולא כישלון.
- שייך רק אם ההצעה באמת עוסקת במחלוקת שהציר מתאר. קרבת נושא אינה מספיקה.
- הרבה הצעות הן מנהליות או טכניות ואינן נופלות על שום מחלוקת פוליטית.
  לאלה החזר issueId: null. זו תשובה נכונה ולא כישלון.
- החלט לפי מה שההצעה משנה בחוק, לא לפי הכותרת ולא לפי מי יזם אותה.

confidence:
  "high"   — המחלוקת שהציר מתאר היא בדיוק מה שההצעה מכריעה בו
  "medium" — שייכת אך לא במרכז הציר
  "low"    — קשר רופף. במקרה כזה עדיף issueId: null

החזר JSON בלבד:
{"matches":[{"billId":123,"issueId":"ax_xxx","confidence":"high","why":"נימוק קצר"},{"billId":124,"issueId":null}]}`;
}

async function askBatch(bills: Array<{ id: number; title: string; change: string; oldQ: string }>,
  key: string, label: string): Promise<Array<Partial<Rehome>> | null> {
  const res = await geminiFetch(
    geminiUrl('generateContent', key),
    {
      contents: [{ parts: [{ text: buildPrompt(bills) }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json', maxOutputTokens: 16384 },
    },
    { retries: 0, timeoutMs: 120_000, label },
  );
  if (!res.ok) { console.log(` ✗ ${res.status}`); return null; }
  const body = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  };
  const cand = body.candidates?.[0];
  if (cand?.finishReason && cand.finishReason !== 'STOP') { console.log(` ✗ ${cand.finishReason}`); return null; }
  const m = ((cand?.content?.parts ?? []).map(p => p.text ?? '').join('')).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const p = JSON.parse(m[0]) as { matches?: Array<Record<string, unknown>> };
    const valid = new Set(AXES.map(a => a.id));
    const ids = new Set(bills.map(b => b.id));
    return (p.matches ?? []).flatMap(r => {
      const billId = Number(r.billId);
      if (!ids.has(billId)) return [];
      const newId = r.issueId ? String(r.issueId) : null;
      if (newId && !valid.has(newId)) return [];
      const conf = ['high', 'medium', 'low'].includes(String(r.confidence)) ? String(r.confidence) : undefined;
      return [{ billId, newIssueId: newId, confidence: newId ? conf : undefined, why: r.why ? String(r.why) : undefined }];
    });
  } catch { return null; }
}

async function main(): Promise<void> {
  const db = new Database(DB_PATH, { readonly: true });

  if (!fs.existsSync(AUDIT)) {
    console.error('✗ audit-classifications.jsonl לא קיים. הריצי קודם audit-classifications.ts');
    db.close(); process.exit(1);
  }
  const wrong = fs.readFileSync(AUDIT, 'utf8').split('\n').filter(Boolean)
    .map(l => JSON.parse(l) as Audit)
    .filter(a => a.fit === 'wrong-axis' && AX_Q.has(a.issueId));
  console.log(`שיוכים שנפסלו בביקורת: ${wrong.length}`);

  const done = new Map<string, Rehome>();
  const k = (b: number, i: string) => `${b}|${i}`;
  if (fs.existsSync(OUT)) {
    for (const line of fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean)) {
      const r = JSON.parse(line) as Rehome;
      done.set(k(r.billId, r.oldIssueId), r);
    }
    if (done.size) console.log(`${done.size} כבר בקובץ`);
  }

  const todo = wrong.filter(w => !done.has(k(w.billId, w.issueId))).slice(0, LIMIT);
  console.log(`לטיפול: ${todo.length}\n`);

  const load = (w: Audit) => {
    const r = db.prepare(`SELECT b.title AS title,
        (SELECT policy_change FROM bill_policy_issue WHERE bill_id = b.id LIMIT 1) AS change
      FROM bill b WHERE b.id = ?`).get(w.billId) as { title: string; change: string | null };
    return { id: w.billId, title: r?.title ?? '', change: r?.change ?? '', oldQ: AX_Q.get(w.issueId)! };
  };

  if (dryRun) {
    console.log(buildPrompt(todo.slice(0, 2).map(load)).slice(-1400));
    console.log(`\n--dry-run — ${Math.ceil(todo.length / BATCH)} בקשות היו נשלחות.`);
    db.close();
    return;
  }

  const key = apiKey();
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    process.stdout.write(`\r  ${i + batch.length}/${todo.length}      `);
    let res: Array<Partial<Rehome>> | null = null;
    try { res = await askBatch(batch.map(load), key, `rehome-${i}`); } catch (e) {
      if (e instanceof DailyQuotaError) { console.log('\nהמכסה נגמרה. מה שנמצא נשמר.'); break; }
      throw e;
    }
    if (!res) continue;
    for (const w of batch) {
      const r = res.find(x => x.billId === w.billId);
      const rec: Rehome = {
        billId: w.billId, oldIssueId: w.issueId,
        newIssueId: r?.newIssueId ?? null,
        confidence: r?.confidence, why: r?.why,
      };
      fs.appendFileSync(OUT, JSON.stringify(rec) + '\n');
      done.set(k(w.billId, w.issueId), rec);
    }
    await new Promise(r => setTimeout(r, 700));
  }
  process.stdout.write('\n');

  const all = [...done.values()];
  const found = all.filter(r => r.newIssueId);
  const high = found.filter(r => r.confidence === 'high');
  console.log('\n═══ תוצאה ═══');
  console.log(`  נבדקו        : ${all.length}`);
  console.log(`  נמצא בית חדש : ${found.length}  (${Math.round(found.length / (all.length || 1) * 100)}%)`);
  console.log(`    מהם גבוה   : ${high.length}   ← מועמדים להחלפה`);
  console.log(`  ללא בית      : ${all.length - found.length}  ← יימחקו`);

  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  const lines = [['bill_id', 'כותרת', 'הציר הנוכחי', 'הציר המוצע', 'ביטחון', 'נימוק'].map(esc).join(',')];
  for (const r of all) {
    const t = (db.prepare('SELECT title FROM bill WHERE id = ?').get(r.billId) as { title: string } | undefined)?.title;
    lines.push([r.billId, t, AX_Q.get(r.oldIssueId),
      r.newIssueId ? AX_Q.get(r.newIssueId) : '(לא נמצא — תימחק)',
      r.confidence ?? '', r.why].map(esc).join(','));
  }
  fs.writeFileSync(CSV, '﻿' + lines.join('\n') + '\n');
  console.log(`\nנכתב: ${path.basename(CSV)} · לא נכתב דבר למסד.`);
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
