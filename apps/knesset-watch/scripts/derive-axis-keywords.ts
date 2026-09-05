/**
 * Derive a short keyword label for each policy axis.
 *
 *   npx tsx scripts/derive-axis-keywords.ts --limit=5   # ניסוי
 *   npx tsx scripts/derive-axis-keywords.ts             # כל 166
 *
 * למה: השאלון בנוי היום כמשפך — בוחרים תחום, ומקבלים את השאלות שהמערכת
 * בחרה בתוכו. זה מפספס: משתמשת שבחרה "חינוך" קיבלה שאלה על סנקציות
 * רגולטוריות ולא ראתה כלל את השאלה על חובת לימודי ליבה, שהיא בדיוק
 * הנושא שהיה אכפת לה ממנו — ותשובתה לשאלה שכן הוצגה ייחסה לה עמדה
 * שאולי אינה שלה.
 *
 * הפתרון הוא ענן מילות מפתח: המשתמשת סורקת ובוחרת מה מעניין אותה,
 * ורק אז נשאלת השאלה המלאה כדי לקבוע כיוון. שאלת הציר עצמה ארוכה מדי
 * לתגית — 80 תווים בממוצע — ולכן נדרשת תווית של 2 עד 4 מילים.
 *
 * הפלט נכתב לקובץ נפרד ואינו נוגע ב-axis-catalog.json, כדי שהשאלון
 * הקיים ימשיך לעבוד כמו שהוא.
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data', 'policy-analysis');
const CATALOG_PATH = path.join(DATA_DIR, 'axis-catalog.json');
const OUT_PATH = path.join(DATA_DIR, 'axis-keywords.json');

const MODEL = 'gemini-3.5-flash-lite';
const BATCH = 8;

interface CatalogAxis {
  issueId: string;
  topic: string;
  subtopic: string;
  question: string;
  stances: Array<{ id: string; label: string }>;
  billCount: number;
}

export interface AxisKeyword {
  issueId: string;
  topic: string;
  subtopic: string;
  /** 2-4 מילים, מה שמופיע כתגית בענן */
  keyword: string;
  question: string;
  billCount: number;
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

function escapeHebrewQuotes(s: string): string {
  return s.replace(/([֐-׿])"([֐-׿])/g, '$1\\"$2');
}

const RULES = `אתה מנסח תגית קצרה לשאלת מדיניות, לענן מילות מפתח בשאלון.

כללים:

- 2 עד 4 מילים. לא משפט, לא שאלה, בלי סימן שאלה.
- שם הנושא שבמחלוקת, לא הכיוון. "לימודי ליבה" ולא "חובת לימודי ליבה".
- מה שאזרח היה מחפש. "מעונות יום" ולא "חינוך לגיל הרך הבלתי פורמלי".
- ספציפי מספיק כדי להבדיל בין שאלות שכנות באותו תחום. "שכר מורים"
  ו"מבחני הערכה" ולא "מערכת החינוך" פעמיים.
- בלי "האם", "רגולציה על", "הסדרת", "מדיניות".
- בלי שמות ח"כים או מפלגות.

דוגמאות:
  "האם לחייב את כל מוסדות החינוך הממומנים ללמד לימודי ליבה?"
     → לימודי ליבה
  "האם להחמיר את הענישה ולקבוע עונשי מינימום כדי להילחם בפשיעה?"
     → עונשי מינימום
  "האם על המדינה להרחיב את הסבסוד לשירותים רפואיים וטכנולוגיות?"
     → סבסוד שירותי בריאות

החזר JSON תקין בלבד: {"keyword":"..."}

מרכאה כפולה עברית בתוך מילה שוברת JSON. השתמש בגרש ״ או השמט.`;

async function derive(axis: CatalogAxis, apiKey: string): Promise<string | null> {
  const prompt = [
    RULES,
    '',
    '────────',
    `תחום: ${axis.topic} ▸ ${axis.subtopic}`,
    `השאלה: ${axis.question}`,
    '────────',
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

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') return null;

  const cleaned = text.replace(/^```(?:json)?/gm, '').replace(/```$/gm, '').trim();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    try {
      parsed = JSON.parse(escapeHebrewQuotes(cleaned));
    } catch {
      return null;
    }
  }

  const kw = typeof parsed?.keyword === 'string' ? parsed.keyword.trim() : null;
  return kw && kw.length > 0 ? kw : null;
}

/**
 * מהדק תגית ארוכה ל-3 מילים לכל היותר.
 *
 * שתי סיבות לאורך: תגית שיצאה בת ארבע מילים, ותגית שהתנגשה עם אחרת
 * וקיבלה את תת-הנושא בסוגריים. במקרה השני נשלחת גם התגית המתחרה, כדי
 * שההבחנה תיעשה בניסוח ולא בהוספת סיומת מכוערת.
 */
async function tighten(
  row: AxisKeyword,
  sibling: string | null,
  apiKey: string,
): Promise<string | null> {
  const prompt = [
    'קצר את התגית הבאה ל-3 מילים לכל היותר, בלי לאבד את הנושא.',
    '',
    'כללים: שם הנושא שבמחלוקת ולא הכיוון. בלי סוגריים, בלי "האם",',
    'בלי "רגולציה על" או "הסדרת". מה שאזרח היה מחפש.',
    sibling
      ? `\nחשוב: קיימת תגית אחרת בשם "${sibling}". התגית שלך חייבת להיות שונה ממנה בבירור.`
      : '',
    '',
    '────────',
    `התגית הנוכחית: ${row.keyword}`,
    `השאלה המלאה: ${row.question}`,
    `תחום: ${row.topic} ▸ ${row.subtopic}`,
    '────────',
    '',
    'החזר JSON בלבד: {"keyword":"..."}',
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
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') return null;

  try {
    const kw = JSON.parse(text.replace(/^```(?:json)?/gm, '').replace(/```$/gm, '').trim());
    return typeof kw?.keyword === 'string' && kw.keyword.trim() ? kw.keyword.trim() : null;
  } catch {
    return null;
  }
}

const MAX_WORDS = 3;

async function runTighten(apiKey: string): Promise<void> {
  const rows = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')) as AxisKeyword[];

  /** בסיס התגית לפני סיומת ההבחנה, כדי לזהות מי התנגש עם מי */
  const base = (s: string) => s.replace(/\s*\(.*\)$/, '');
  const byBase = new Map<string, AxisKeyword[]>();
  for (const r of rows) {
    const b = base(r.keyword);
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b)!.push(r);
  }

  const targets = rows.filter(r => r.keyword.split(/\s+/).length > MAX_WORDS);
  console.log(`tightening ${targets.length} keywords\n`);

  let changed = 0;
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async r => {
        const group = byBase.get(base(r.keyword)) ?? [];
        const sibling = group.find(o => o.issueId !== r.issueId)?.keyword ?? null;
        try {
          return await tighten(r, sibling ? base(sibling) : null, apiKey);
        } catch {
          return null;
        }
      }),
    );

    results.forEach((kw, j) => {
      const r = batch[j];
      if (!kw) {
        console.log(`  ✗ ${r.keyword}`);
        return;
      }
      console.log(`  ${r.keyword.padEnd(46)} → ${kw}`);
      r.keyword = kw;
      changed++;
    });
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(rows, null, 2), 'utf8');
  const words = rows.map(r => r.keyword.split(/\s+/).length);
  console.log(`\nDone. tightened ${changed}`);
  console.log(`  מילים לתגית — מקס' ${Math.max(...words)}   מעל ${MAX_WORDS}: ${words.filter(w => w > MAX_WORDS).length}`);
}

async function main() {
  loadEnvLocal();
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing from .env.local');

  if (process.argv.slice(2).includes('--tighten')) {
    await runTighten(apiKey);
    return;
  }

  const limitArg = process.argv.slice(2).find(a => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : null;

  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8')) as CatalogAxis[];

  /** רק צירים שמוצגים בפועל — מתחת ל-5 חוקים הם מסוננים בתצוגה ממילא */
  const eligible = catalog.filter(a => a.billCount >= 5);
  const targets = limit ? eligible.slice(0, limit) : eligible;

  console.log(`deriving keywords for ${targets.length} axes\n`);

  const out: AxisKeyword[] = [];
  let failed = 0;

  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async a => {
        try {
          return await derive(a, apiKey);
        } catch {
          return null;
        }
      }),
    );

    results.forEach((keyword, j) => {
      const a = batch[j];
      if (!keyword) {
        failed++;
        console.log(`  ✗ ${a.question.slice(0, 60)}`);
        return;
      }
      out.push({
        issueId: a.issueId,
        topic: a.topic,
        subtopic: a.subtopic,
        keyword,
        question: a.question,
        billCount: a.billCount,
      });
      console.log(`  ${keyword.padEnd(28)} ← ${a.question.slice(0, 55)}`);
    });
  }

  /**
   * תגיות זהות בין צירים שונים היו נראות למשתמש כרשימה מקולקלת. כשהן
   * מתנגשות, השנייה מקבלת את תת-הנושא כהבחנה.
   */
  const seen = new Map<string, number>();
  for (const row of out) {
    const count = seen.get(row.keyword) ?? 0;
    if (count > 0) row.keyword = `${row.keyword} (${row.subtopic})`;
    seen.set(row.keyword, count + 1);
  }

  out.sort((a, b) => b.billCount - a.billCount);
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), 'utf8');

  console.log('\nDone.');
  console.log(`  keywords: ${out.length}`);
  console.log(`  failed:   ${failed}`);
  console.log(`  duplicates disambiguated: ${[...seen.values()].filter(n => n > 1).length}`);
  console.log(`\n  ${path.relative(process.cwd(), OUT_PATH)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
