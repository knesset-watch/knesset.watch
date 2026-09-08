/**
 * Extract policy axes for each subtopic, iteratively.
 *
 *   npx tsx scripts/extract-subtopic-axes.ts --limit=2    # ניסוי
 *   npx tsx scripts/extract-subtopic-axes.ts              # כל 64
 *   npx tsx scripts/extract-subtopic-axes.ts --resume     # המשך
 *
 * למה איטרטיבי ולא ציר אחד לתת-נושא: תת-נושא אינו מחלוקת אחת. "בתי ספר
 * וגיל הרך" מכיל 139 סוגיות קנוניות שנחלקות לפחות לשתי מחלוקות נפרדות —
 * התניית תקצוב בדרישות ממלכתיות, והיקף הרגולציה. שאלה אחת כיסתה 51%
 * בלבד; שתיים כיסו 94%.
 *
 * הכישלון הקודם היה חמור יותר: השאלה נגזרה מ-40 העמדות הראשונות לפי
 * סדר הקובץ, שהן שכנות ולכן דומות זו לזו. התוצאה הייתה שאלה על מעונות
 * יום חינם עבור תת-נושא של 253 חוקים על תקצוב, שכר מורים והערכה. כאן
 * הדגימה אקראית מכל הבריכה שטרם כוסתה.
 *
 * הסיווג ברמת הסוגיה הקנונית ולא ברמת החוק — הצעה של זויה. כל סוגיה
 * שייכת לתת-נושא אחד בדיוק (אימתתי: 0 חריגים), החוקים יורשים ממנה,
 * ושני חוקים באותו אשכול לא יכולים לקבל צדדים סותרים.
 */

import fs from 'fs';
import path from 'path';

const CANONICAL_DIR = path.join(process.cwd(), 'data', 'policy-analysis', 'canonical');
const ANALYSIS_PATH = path.join(process.cwd(), 'data', 'policy-analysis', 'issues.fulltext-v1.jsonl');
const AXES_PATH = path.join(process.cwd(), 'data', 'policy-analysis', 'subtopic-axes.json');
const ORIENTATION_PATH = path.join(process.cwd(), 'data', 'policy-analysis', 'canonical-orientation.jsonl');

const MODEL = 'gemini-3.5-flash-lite';

/** תקרה קשיחה. מעבר לשלושה צירים השאלון נעשה ארוך מכדי שמישהו יסיים אותו. */
const MAX_AXES = 5;

/** מתחת לזה לא שווה לגזור ציר נוסף — הוא ייצג מעט מדי */
const MIN_POOL = 10;

/** כמה סוגיות נשלחות לגזירת ציר. אקראי, לא רצף. */
const SAMPLE_SIZE = 45;

const CLASSIFY_BATCH = 8;

interface MappingRow {
  bill_id: number;
  issue_index: number;
  topic: string;
  subtopic: string;
  canonical_issue_id: string;
  canonical_issue_name: string;
  review_required: boolean;
}

interface AnalysedBill {
  bill_id: number;
  issues: Array<{ pro_stance: string | null; policy_change: string | null }>;
}

interface CanonicalIssue {
  id: string;
  name: string;
  stance: string;
}

export interface Axis {
  topic: string;
  subtopic: string;
  axisIndex: number;
  question: string;
  proLabel: string;
  conLabel: string;
  /** כמה סוגיות קנוניות נפלו על הציר */
  covered: number;
  poolSize: number;
}

export interface OrientationRow {
  canonical_issue_id: string;
  topic: string;
  subtopic: string;
  axis_index: number;
  side: 'PRO' | 'CON';
}

function loadEnvLocal(): void {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

function readJsonl<T>(file: string): T[] {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T);
}

function escapeHebrewQuotes(s: string): string {
  return s.replace(/([֐-׿])"([֐-׿])/g, '$1\\"$2');
}

async function gen(prompt: string, apiKey: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') return null;

  const cleaned = text.replace(/^```(?:json)?/gm, '').replace(/```$/gm, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    try {
      return JSON.parse(escapeHebrewQuotes(cleaned));
    } catch {
      return null;
    }
  }
}

const DERIVE_RULES = `אתה מנסח ציר מחלוקת אחד עבור שאלון ציבורי.

אתה מקבל עמדות שנוסחו מהצעות חוק אמיתיות באותו תחום. נסח ציר אחד
שמכסה כמה שיותר מהן. אם יש כמה מחלוקות שונות, בחר את הרווחת ביותר —
לשאר ייגזר ציר נפרד בהמשך, אז אל תמתח את הציר כדי לכלול הכול.

כללים:

- question — שאלה שאזרח מבין בלי רקע משפטי, עד 15 מילים.
- proLabel — העמדה התומכת בשינוי, עד 12 מילים.
- conLabel — ההיפך הממשי, לא ניסוח חלש. עד 12 מילים.
- שתי העמדות לגיטימיות ומנוסחות בכבוד. זהו שאלון, לא טיעון.
- בלי שמות ח"כים, מפלגות או מספרי חוקים.

החזר JSON תקין בלבד: {"question":"...","proLabel":"...","conLabel":"..."}

מרכאה כפולה עברית בתוך מילה (צה״ל) שוברת JSON. השתמש בגרש ״ או השמט.`;

const CLASSIFY_RULES = `קבע לאיזה צד של הציר עמדת החוק נוטה.

PRO  — תומכת בעמדה A
CON  — תומכת בעמדה B
OFF  — אינה נופלת על הציר הזה כלל

OFF אינו מוצא אחרון אלא תשובה נכונה ושכיחה — לשאריות ייגזר ציר משלהן.
אל תמתח את הציר כדי שיתאים.

החזר JSON בלבד: {"side":"PRO"|"CON"|"OFF"}`;

async function deriveAxis(
  subtopic: string,
  pool: CanonicalIssue[],
  apiKey: string,
): Promise<{ question: string; proLabel: string; conLabel: string } | null> {
  const sample = [...pool].sort(() => Math.random() - 0.5).slice(0, SAMPLE_SIZE);
  const rendered = sample.map((x, i) => `${i + 1}. ${x.stance.slice(0, 170)}`).join('\n');

  const parsed = await gen(
    [DERIVE_RULES, '', '────────', `תחום: ${subtopic}`, '', 'העמדות:', rendered, '────────'].join('\n'),
    apiKey,
  );
  if (!parsed?.question || !parsed.proLabel || !parsed.conLabel) return null;

  return {
    question: String(parsed.question),
    proLabel: String(parsed.proLabel),
    conLabel: String(parsed.conLabel),
  };
}

async function classifyPool(
  axis: { question: string; proLabel: string; conLabel: string },
  pool: CanonicalIssue[],
  apiKey: string,
): Promise<{ on: Array<{ issue: CanonicalIssue; side: 'PRO' | 'CON' }>; off: CanonicalIssue[] }> {
  const on: Array<{ issue: CanonicalIssue; side: 'PRO' | 'CON' }> = [];
  const off: CanonicalIssue[] = [];

  for (let i = 0; i < pool.length; i += CLASSIFY_BATCH) {
    const batch = pool.slice(i, i + CLASSIFY_BATCH);
    const results = await Promise.all(
      batch.map(async x => {
        const prompt = [
          CLASSIFY_RULES,
          '',
          '────────',
          `שאלה: ${axis.question}`,
          `A = ${axis.proLabel}`,
          `B = ${axis.conLabel}`,
          '',
          `עמדת החוק: ${x.stance.slice(0, 320)}`,
          '────────',
        ].join('\n');
        try {
          const r = await gen(prompt, apiKey);
          const side = String(r?.side ?? 'OFF');
          return side === 'PRO' || side === 'CON' ? side : 'OFF';
        } catch {
          return 'OFF';
        }
      }),
    );
    results.forEach((side, j) => {
      if (side === 'OFF') off.push(batch[j]);
      else on.push({ issue: batch[j], side });
    });
  }

  return { on, off };
}

async function main() {
  loadEnvLocal();
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing from .env.local');

  const argv = process.argv.slice(2);
  const limitArg = argv.find(a => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : null;
  const resume = argv.includes('--resume');

  const mapping = readJsonl<MappingRow>(path.join(CANONICAL_DIR, 'bill-issue-mapping.jsonl'));
  const analysed = readJsonl<AnalysedBill>(ANALYSIS_PATH);
  const byBill = new Map(analysed.map(b => [b.bill_id, b]));

  /** סוגיה קנונית אחת לכל אשכול, עם העמדה של החוק הראשון שמייצג אותה */
  const bySubtopic = new Map<string, { topic: string; issues: CanonicalIssue[] }>();
  const seen = new Set<string>();

  for (const m of mapping) {
    if (m.review_required || seen.has(m.canonical_issue_id)) continue;
    const iss = byBill.get(m.bill_id)?.issues[m.issue_index];
    if (!iss?.pro_stance) continue;

    seen.add(m.canonical_issue_id);
    if (!bySubtopic.has(m.subtopic)) bySubtopic.set(m.subtopic, { topic: m.topic, issues: [] });
    bySubtopic.get(m.subtopic)!.issues.push({
      id: m.canonical_issue_id,
      name: m.canonical_issue_name,
      stance: iss.pro_stance,
    });
  }

  const doneSubtopics = new Set<string>();
  const existingAxes: Axis[] = [];
  if (resume && fs.existsSync(AXES_PATH)) {
    for (const a of JSON.parse(fs.readFileSync(AXES_PATH, 'utf8')) as Axis[]) {
      existingAxes.push(a);
      doneSubtopics.add(a.subtopic);
    }
    console.log(`resuming — ${doneSubtopics.size} subtopics already done`);
  }

  const all = [...bySubtopic.entries()].filter(([sub]) => !doneSubtopics.has(sub));
  const targets = limit ? all.slice(0, limit) : all;

  console.log(`extracting axes for ${targets.length} subtopics\n`);

  const axes: Axis[] = [...existingAxes];
  const orientation = fs.createWriteStream(ORIENTATION_PATH, {
    flags: resume ? 'a' : 'w',
    encoding: 'utf8',
  });

  let totalIssues = 0;
  let totalCovered = 0;

  for (const [subtopic, { topic, issues }] of targets) {
    console.log(`${subtopic}  (${issues.length} סוגיות)`);
    totalIssues += issues.length;

    let pool = issues;
    let covered = 0;

    for (let axisIndex = 1; axisIndex <= MAX_AXES && pool.length >= MIN_POOL; axisIndex++) {
      let axis;
      try {
        axis = await deriveAxis(subtopic, pool, apiKey);
      } catch {
        axis = null;
      }
      if (!axis) {
        console.log(`  ציר ${axisIndex}: ✗ גזירה נכשלה`);
        break;
      }

      const { on, off } = await classifyPool(axis, pool, apiKey);

      axes.push({
        topic,
        subtopic,
        axisIndex,
        question: axis.question,
        proLabel: axis.proLabel,
        conLabel: axis.conLabel,
        covered: on.length,
        poolSize: pool.length,
      });

      for (const { issue, side } of on) {
        orientation.write(
          `${JSON.stringify({
            canonical_issue_id: issue.id,
            topic,
            subtopic,
            axis_index: axisIndex,
            side,
          } satisfies OrientationRow)}\n`,
        );
      }

      covered += on.length;
      const pct = Math.round((on.length / pool.length) * 100);
      console.log(`  ציר ${axisIndex}: ${axis.question}`);
      console.log(`          ${on.length}/${pool.length} (${pct}%)  נותרו ${off.length}`);

      pool = off;
      if (on.length === 0) break;
    }

    totalCovered += covered;
    console.log(`  → כיסוי ${covered}/${issues.length} (${Math.round((covered / issues.length) * 100)}%)\n`);

    fs.writeFileSync(AXES_PATH, JSON.stringify(axes, null, 2), 'utf8');
  }

  orientation.end();

  console.log('Done.');
  console.log(`  subtopics: ${targets.length}`);
  console.log(`  axes:      ${axes.length}`);
  console.log(`  coverage:  ${totalCovered.toLocaleString()}/${totalIssues.toLocaleString()} (${Math.round((totalCovered / totalIssues) * 100)}%)`);
  console.log(`\n  ${path.relative(process.cwd(), AXES_PATH)}`);
  console.log(`  ${path.relative(process.cwd(), ORIENTATION_PATH)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
