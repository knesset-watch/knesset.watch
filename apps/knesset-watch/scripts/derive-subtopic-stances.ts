/**
 * Derive one pro/con stance pair for each of the 64 canonical subtopics.
 *
 *   npx tsx scripts/derive-subtopic-stances.ts --limit=3   # ניסוי
 *   npx tsx scripts/derive-subtopic-stances.ts             # כל 64
 *
 * הרקע: הטקסונומיה של זויה (8 נושאים × 8 תתי-נושאים) מסווגת סוגיות אבל
 * אינה נושאת עמדות, והשאלון בנוי כולו סביב שאלה עם שני צדדים. העמדות
 * כן קיימות — ב-issues.fulltext-v1.jsonl, זוג לכל סוגיה בכל חוק.
 *
 * החיבור הוא (bill_id, issue_index), שמופיע בשני הקבצים ונפתר ב-100%
 * מ-8,447 השורות. מכאן שכל תת-נושא מגיע עם 3 עד 719 זוגות עמדות
 * קונקרטיים, והמשימה היא לזקק מהם ניסוח אחד שמשתמש יכול לענות עליו.
 *
 * שורות review_required מסוננות: המערכת של זויה סימנה אותן כסיווג לא
 * בטוח, ואין סיבה שניסוח שיוצג למשתמש יישען עליהן. נותרים 81%.
 */

import fs from 'fs';
import path from 'path';

const CANONICAL_DIR = path.join(process.cwd(), 'data', 'policy-analysis', 'canonical');
const ANALYSIS_PATH = path.join(process.cwd(), 'data', 'policy-analysis', 'issues.fulltext-v1.jsonl');
const OUT_PATH = path.join(process.cwd(), 'data', 'policy-analysis', 'subtopic-stances.json');

const MODEL = 'gemini-3.5-flash-lite';

/**
 * כמה זוגות עמדות נשלחים למודל. תת-נושא גדול מגיע עם מאות, והם חוזרים
 * על עצמם — 40 מייצגים מספיק ומשאירים את הפרומפט קריא.
 */
const SAMPLE_SIZE = 40;

/** מתחת לזה הניסוח נשען על מעט מדי חוקים, ומסומן לבדיקה */
const THIN_THRESHOLD = 10;

interface MappingRow {
  bill_id: number;
  issue_index: number;
  topic: string;
  subtopic: string;
  canonical_issue_name: string;
  review_required: boolean;
}

interface AnalysedBill {
  bill_id: number;
  issues: Array<{ pro_stance: string | null; con_stance: string | null; policy_change: string | null }>;
}

interface StancePair {
  pro: string;
  con: string;
  change: string | null;
  issue: string;
}

export interface SubtopicStance {
  topic: string;
  subtopic: string;
  /** ניסוח קצר של שאלת המדיניות שהתת-נושא מגלם */
  question: string;
  proLabel: string;
  conLabel: string;
  /** כמה חוקים עמדו בבסיס הניסוח */
  billCount: number;
  /** נשען על מעט מדי חוקים — להציג בזהירות */
  thin: boolean;
  confidence: number;
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

/** מרכאה עברית בתוך מילה סוגרת מחרוזת JSON באמצע */
function escapeHebrewQuotes(s: string): string {
  return s.replace(/([֐-׿])"([֐-׿])/g, '$1\\"$2');
}

function parseJson(text: string): Record<string, unknown> | null {
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

const RULES = `אתה מנסח שאלת מדיניות אחת עבור שאלון ציבורי.

אתה מקבל שם של תת-נושא, ורשימת עמדות בעד ונגד שנוסחו מנוסחי חוק
אמיתיים שסווגו לתת-הנושא הזה. המשימה: לזקק מהן שאלה אחת ושתי עמדות.

מה שנדרש:

1. question — שאלת המדיניות שהתת-נושא מגלם, במשפט אחד. ניסוח שאזרח
   מבין בלי רקע משפטי. לא שם של חוק ולא מונח מקצועי.
2. proLabel — העמדה התומכת בשינוי, במשפט קצר בגוף ראשון או בלשון
   עמדה. "בעד הרחבת..." או "תמיכה ב...".
3. conLabel — העמדה הנגדית. חייבת להיות ההיפך הממשי של proLabel ולא
   ניסוח חלש שלה.

כללים מחייבים:

- שתי העמדות חייבות להיות לגיטימיות ומנוסחות בכבוד. אל תנסח את אחת
  מהן כך שברור שהיא הנכונה. זהו שאלון, לא טיעון.
- הישען על העמדות שקיבלת ואל תמציא ציר מחלוקת שאינו עולה מהן.
- אם העמדות שקיבלת מפוזרות על כמה מחלוקות שונות, בחר את הציר שחוזר
  בהכי הרבה מהן וציין confidence נמוך.
- קצר. עד 12 מילים לכל עמדה, עד 15 לשאלה.
- אל תזכיר מספרי חוקים, שמות ח"כים או מפלגות.
- confidence בין 0 ל-1: עד כמה העמדות שקיבלת מתלכדות לציר אחד.

החזר JSON תקין בלבד, בלי גדרות קוד ובלי טקסט מסביב.

לגבי מרכאות: בעברית מרכאה כפולה היא חלק מהמילה (צה״ל, בג״ץ). היא
שוברת מחרוזת JSON. השתמש בגרש הכפול העברי ״ או השמט אותו.`;

const SHAPE = `{
  "question": "<שאלת המדיניות>",
  "proLabel": "<העמדה בעד>",
  "conLabel": "<העמדה נגד>",
  "confidence": <0..1>
}`;

async function derive(
  topic: string,
  subtopic: string,
  pairs: StancePair[],
  apiKey: string,
): Promise<Record<string, unknown> | null> {
  const sample = pairs.slice(0, SAMPLE_SIZE);
  const rendered = sample
    .map((p, i) => `${i + 1}. [${p.issue}]\n   בעד: ${p.pro}\n   נגד: ${p.con}`)
    .join('\n');

  const prompt = [
    RULES,
    '',
    'מבנה הפלט:',
    SHAPE,
    '',
    '────────',
    `נושא-על: ${topic}`,
    `תת-נושא: ${subtopic}`,
    `מספר החוקים בתת-הנושא: ${pairs.length}`,
    '',
    'העמדות שנוסחו מנוסחי החוק:',
    rendered,
    '────────',
    '',
    'החזר JSON בלבד.',
  ].join('\n');

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

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 140)}`);
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === 'string' ? parseJson(text) : null;
}

async function main() {
  loadEnvLocal();
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing from .env.local');

  const limitArg = process.argv.slice(2).find(a => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : null;

  const mapping = readJsonl<MappingRow>(path.join(CANONICAL_DIR, 'bill-issue-mapping.jsonl'));
  const analysed = readJsonl<AnalysedBill>(ANALYSIS_PATH);
  const byBill = new Map(analysed.map(b => [b.bill_id, b]));

  /**
   * הקיבוץ מתעלם מ-review_required: אלה סיווגים שהמערכת של זויה סימנה
   * כלא בטוחים, ואין סיבה שניסוח שיוצג למשתמש יישען עליהם.
   */
  const groups = new Map<string, { topic: string; subtopic: string; pairs: StancePair[] }>();

  for (const row of mapping) {
    if (row.review_required) continue;

    const bill = byBill.get(row.bill_id);
    const issue = bill?.issues[row.issue_index];
    if (!issue?.pro_stance || !issue.con_stance) continue;

    const key = `${row.topic} ${row.subtopic}`;
    if (!groups.has(key)) groups.set(key, { topic: row.topic, subtopic: row.subtopic, pairs: [] });
    groups.get(key)!.pairs.push({
      pro: issue.pro_stance,
      con: issue.con_stance,
      change: issue.policy_change,
      issue: row.canonical_issue_name,
    });
  }

  const all = [...groups.values()].sort(
    (a, b) => a.topic.localeCompare(b.topic) || b.pairs.length - a.pairs.length,
  );
  const targets = limit ? all.slice(0, limit) : all;

  console.log(`deriving stances for ${targets.length} subtopics\n`);

  const out: SubtopicStance[] = [];
  let failed = 0;

  for (const [i, g] of targets.entries()) {
    const counter = `${(i + 1).toString().padStart(2)}/${targets.length}`;
    try {
      const parsed = await derive(g.topic, g.subtopic, g.pairs, apiKey);
      if (!parsed) throw new Error('unparseable JSON');

      const entry: SubtopicStance = {
        topic: g.topic,
        subtopic: g.subtopic,
        question: String(parsed.question ?? ''),
        proLabel: String(parsed.proLabel ?? ''),
        conLabel: String(parsed.conLabel ?? ''),
        billCount: g.pairs.length,
        thin: g.pairs.length < THIN_THRESHOLD,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      };
      out.push(entry);

      const flag = entry.thin ? ' ⚠ מעט חוקים' : '';
      console.log(`  ${counter}  ${g.subtopic} (${g.pairs.length})${flag}`);
      console.log(`         ${entry.question}`);
      console.log(`         בעד: ${entry.proLabel}`);
      console.log(`         נגד: ${entry.conLabel}`);
    } catch (err) {
      failed++;
      console.log(`  ${counter}  ${g.subtopic} ✗ ${(err as Error).message}`);
    }
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), 'utf8');

  console.log('\nDone.');
  console.log(`  derived: ${out.length}`);
  console.log(`  failed:  ${failed}`);
  console.log(`  thin (<${THIN_THRESHOLD} bills): ${out.filter(o => o.thin).length}`);
  console.log(`  low confidence (<0.7): ${out.filter(o => o.confidence < 0.7).length}`);
  console.log(`\n  ${path.relative(process.cwd(), OUT_PATH)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
