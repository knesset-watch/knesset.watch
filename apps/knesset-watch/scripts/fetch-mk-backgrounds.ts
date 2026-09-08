/**
 * Extract MK professional background and academic degrees from Hebrew Wikipedia.
 *
 *   npx tsx scripts/fetch-mk-backgrounds.ts --limit=5     # ניסוי
 *   npx tsx scripts/fetch-mk-backgrounds.ts               # הכל
 *
 * למה לא Wikidata: השדות P512 (תואר) ו-P812 (תחום) אינם מאוכלסים
 * לח"כים ישראלים — רק 6 מתוך 120 שורות השכלה כוללות תואר בפועל, והשאר
 * מציגות שם מוסד בלבד. 35 ח"כים חסרים עיסוק לגמרי.
 *
 * המידע קיים בוויקיפדיה העברית, אבל רק כפרוזה בסעיף הביוגרפיה ולא
 * בתיבת המידע — בדקתי, אין שם שדות מקצוע או השכלה. לכן LLM ולא regex.
 *
 * הפלט אינו מוצג ישירות: הוא נכתב ל-mk-backgrounds.json לבדיקה, ורק
 * מה שיאושר ייכנס לתצוגה. זה טקסט מיוצר על אנשים אמיתיים.
 */

import fs from 'fs';
import path from 'path';
import profilesData from '../src/lib/mk-profiles.json';

const OUT_PATH = path.join(process.cwd(), 'src', 'lib', 'mk-backgrounds.json');
const MODEL = 'gemini-3.5-flash-lite';

/**
 * ויקיפדיה חוסמת מתחת ל-500ms, אבל 600 לא הספיקו לרצף של 147: הריצה
 * הראשונה דיווחה "אין ערך" על 19 ח"כים, ובבדיקה חוזרת ליאיר לפיד היו
 * 35,223 תווים. זו הייתה חנקה, לא היעדר ערך.
 */
const WIKI_DELAY_MS = 1200;
const MAX_RETRIES = 4;

interface Profile {
  personId: number;
  name: string;
  occupations: string[];
  education: string[];
}

export interface MkBackground {
  personId: number;
  name: string;
  /** מקצועות אזרחיים בלבד — לא תפקידים בכנסת או בממשלה */
  occupations: string[];
  /** תואר אקדמי מלא, למשל "בוגר במשפטים, אוניברסיטת תל אביב" */
  degrees: string[];
  /** המשרה שמילא סמוך לפני הכניסה לכנסת */
  priorRole: string | null;
  confidence: number;
  /** המשפטים שמהם נגזר הניתוח, לבדיקה ידנית */
  evidence: string[];
  source: 'he.wikipedia';
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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const UA = { 'User-Agent': 'knesset.watch/1.0 (research)' };

/**
 * ח"כים ששמם במאגר הכנסת שונה מכותרת הערך בוויקיפדיה.
 *
 * שלושת אלה נכשלו גם בחיפוש: "מירי מרים רגב" נושא שם אמצעי שאינו
 * בכותרת, "אלי כהן" הוא דף פירושונים, ו"סימון" נכתב שם "סימיון".
 */
const TITLE_OVERRIDES: Record<number, string> = {
  12959: 'מירי רגב',
  30083: 'אלי כהן (פוליטיקאי, 1972)',
  30872: 'סימיון מושיאשוילי',
};

/** נחנקנו ולא הצלחנו להתאושש — שונה מהותית מ"אין ערך" */
class Throttled extends Error {}

/**
 * בקשה עם המתנה מתגברת. ויקיפדיה מחזירה טקסט ולא JSON כשהיא חוסמת,
 * וזורקת Throttled אם כל הניסיונות נכשלו — כדי שהקורא לא יטעה ויסיק
 * שלח"כ אין ערך. הגרסה הקודמת החזירה null בשני המקרים, וזה מה שגרם
 * לדיווח השגוי על 19 ח"כים.
 */
async function wikiFetch(url: string): Promise<unknown | null> {
  let blocked = false;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: UA });
      const body = await res.text();
      if (body.startsWith('You are making too many requests')) {
        blocked = true;
        await sleep(WIKI_DELAY_MS * attempt * 3);
        continue;
      }
      return JSON.parse(body);
    } catch {
      await sleep(WIKI_DELAY_MS * attempt * 2);
    }
  }

  if (blocked) throw new Throttled('rate limited by he.wikipedia');
  return null;
}

function extractOf(json: unknown): string | null {
  const pages = (json as { query?: { pages?: Record<string, { extract?: string }> } })?.query?.pages;
  const page = pages ? Object.values(pages)[0] : undefined;
  return page?.extract ?? null;
}

/**
 * הכותרת האמיתית של הערך, כשהשם מהמאגר אינו תואם.
 *
 * "ישראל כץ" נכשל כי הערך נמצא תחת "ישראל כ״ץ (הליכוד)" — גרשיים בשם
 * המשפחה ופירוש נוסף בסוגריים. redirects=1 אינו עוזר כאן: זו כותרת
 * אחרת ולא הפניה. הסינון על שם פרטי מונע קפיצה לאדם אחר לגמרי.
 */
async function searchTitle(name: string): Promise<string | null> {
  const first = name.split(' ')[0];
  const url =
    'https://he.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=5' +
    `&srsearch=${encodeURIComponent(`${name} חבר הכנסת`)}`;

  const json = await wikiFetch(url);
  const hits = (json as { query?: { search?: Array<{ title: string; size: number }> } })?.query?.search ?? [];

  const match = hits.find(h => h.title.startsWith(first) && h.size > 3000);
  return match?.title ?? null;
}

/** הערך המלא, לא רק הפתיח — הרקע המקצועי יושב בסעיף הביוגרפיה */
async function wikipediaArticle(title: string, personId?: number): Promise<string | null> {
  const byTitle = (t: string) =>
    'https://he.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1' +
    `&redirects=1&format=json&titles=${encodeURIComponent(t)}`;

  const override = personId !== undefined ? TITLE_OVERRIDES[personId] : undefined;
  if (override) return extractOf(await wikiFetch(byTitle(override)));

  const direct = extractOf(await wikiFetch(byTitle(title)));
  if (direct && direct.length >= 400) return direct;

  await sleep(WIKI_DELAY_MS);
  const found = await searchTitle(title);
  if (!found) return direct;

  await sleep(WIKI_DELAY_MS);
  return extractOf(await wikiFetch(byTitle(found))) ?? direct;
}

const PROMPT_RULES = `אתה מחלץ רקע תעסוקתי ואקדמי של חבר כנסת מתוך ערך ויקיפדיה.

מה לחלץ:
1. occupations — מה האדם עשה לפני או מחוץ לכנסת. שני סוגים נכללים:
   א. מקצוע אזרחי: עורך דין, רופאה, מהנדס, מורה, עיתונאי, איש עסקים.
   ב. תפקיד ציבורי או ארגוני משמעותי שאינו בכנסת ואינו בממשלה: יו״ר
      אגודת סטודנטים, יו״ר התאחדות, ראש עיר, מנכ״ל ארגון, יו״ר עמותה,
      מזכ״ל תנועה. גם אם אינו "מקצוע", הוא הרקע שהביא את האדם לכנסת.
2. degrees — תארים אקדמיים, בנוסח "בוגר במשפטים, אוניברסיטת תל אביב".
   רק תואר שמצוין במפורש. שם מוסד בלי תואר אינו תואר.
3. priorRole — המשרה שמילא סמוך לפני הכניסה לכנסת, אם מצוינת.

כללים מחייבים:

- אל תכלול תפקידים בתוך הכנסת: חבר כנסת, יו״ר ועדה, יו״ר סיעה, סגן
  יושב ראש. הם נובעים מעצם החברות ואינם מקצוע.
- אל תכלול תפקידי ממשלה: שר, סגן שר, ראש ממשלה. הם פוליטיים.
- תפקיד ציבורי מחוץ לכנסת כן נכלל: ראש עיר, מנכ״ל משרד ממשלתי, שגריר,
  ראש המטה הכללי — זה ניסיון ניהולי אמיתי.
- "מנהל כללי" בלי שם הארגון חסר ערך. כתוב "מנכ״ל בנק הפועלים" או השמט.
- שירות צבאי סדיר אינו מקצוע. קריירה צבאית ארוכה או דרגת קצונה בכירה כן.
- עיסוק זמני מהנעורים שאינו מייצג את הרקע — עבודת סטודנט, עבודה
  מזדמנת, תפקיד שנמשך זמן קצר לפני עשורים — אינו נכלל. "חוטב עצים"
  אצל מי שהיה אלוף בצה״ל הוא רעש, לא רקע. הכלל: האם אדם סביר היה מציג
  את זה כרקע שלו היום.
- אם אין מידע — החזר מערך ריק. אל תנחש ואל תשלים מהידע הכללי שלך.
- evidence — המשפטים מהערך שעליהם התבססת, מילה במילה.
- confidence בין 0 ל-1.

החזר JSON תקין בלבד, בלי גדרות קוד ובלי טקסט מסביב.

לגבי מרכאות: בעברית מרכאה כפולה היא חלק מהמילה (צה״ל, מנכ״ל). היא
שוברת מחרוזת JSON. השתמש בגרש הכפול העברי ״ או השמט אותו.`;

const SHAPE = `{
  "occupations": ["<מקצוע>"],
  "degrees": ["<תואר, מוסד>"],
  "priorRole": "<משרה קודמת או null>",
  "evidence": ["<משפט מהערך>"],
  "confidence": <0..1>
}`;

/** מרכאה עברית בתוך מילה סוגרת מחרוזת JSON באמצע — אותו באג כמו בניתוח החוקים */
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

async function extract(
  name: string,
  article: string,
  apiKey: string,
): Promise<Record<string, unknown> | null> {
  const prompt = [
    PROMPT_RULES,
    '',
    'מבנה הפלט:',
    SHAPE,
    '',
    '────────',
    `שם: ${name}`,
    '',
    'הערך:',
    article.slice(0, 12000),
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

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === 'string' ? parseJson(text) : null;
}

async function main() {
  loadEnvLocal();
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing from .env.local');

  const argv = process.argv.slice(2);
  const limitArg = argv.find(a => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : null;
  const retryMissing = argv.includes('--retry-missing');

  const profiles = profilesData as Profile[];

  /**
   * --retry-missing מריץ רק את מי שאינו בקובץ. הרצה חוזרת של כל 147
   * הייתה משלמת שוב על 127 שהצליחו, ומסכנת אותם בחנקה חדשה.
   */
  const existing: MkBackground[] = retryMissing && fs.existsSync(OUT_PATH)
    ? (JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')) as MkBackground[])
    : [];
  const have = new Set(existing.map(e => e.personId));

  const pool = retryMissing ? profiles.filter(p => !have.has(p.personId)) : profiles;
  const targets = limit ? pool.slice(0, limit) : pool;

  if (retryMissing) console.log(`already have ${existing.length}, retrying ${targets.length}\n`);
  else console.log(`fetching backgrounds for ${targets.length} MKs\n`);

  const out: MkBackground[] = [...existing];
  let noArticle = 0;
  let failed = 0;
  let throttled = 0;

  for (const [i, p] of targets.entries()) {
    const counter = `${(i + 1).toString().padStart(3)}/${targets.length}`;

    let article: string | null;
    try {
      article = await wikipediaArticle(p.name, p.personId);
    } catch (err) {
      if (err instanceof Throttled) {
        throttled++;
        console.log(`  ${counter}  ${p.name} ⏳ נחסם — לא נסרק`);
        await sleep(WIKI_DELAY_MS * 5);
        continue;
      }
      throw err;
    }
    await sleep(WIKI_DELAY_MS);

    if (!article || article.length < 400) {
      noArticle++;
      console.log(`  ${counter}  ${p.name} — אין ערך`);
      continue;
    }

    try {
      const parsed = await extract(p.name, article, apiKey);
      if (!parsed) throw new Error('unparseable JSON');

      const entry: MkBackground = {
        personId: p.personId,
        name: p.name,
        occupations: Array.isArray(parsed.occupations) ? (parsed.occupations as string[]) : [],
        degrees: Array.isArray(parsed.degrees) ? (parsed.degrees as string[]) : [],
        priorRole: typeof parsed.priorRole === 'string' ? parsed.priorRole : null,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
        evidence: Array.isArray(parsed.evidence) ? (parsed.evidence as string[]).slice(0, 3) : [],
        source: 'he.wikipedia',
      };
      out.push(entry);

      const shown = [...entry.occupations, ...entry.degrees].slice(0, 3).join(' · ') || '—';
      console.log(`  ${counter}  ${p.name} → ${shown}`);
    } catch (err) {
      failed++;
      console.log(`  ${counter}  ${p.name} ✗ ${(err as Error).message}`);
    }
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), 'utf8');

  console.log('\nDone.');
  console.log(`  extracted:  ${out.length}`);
  console.log(`  no article: ${noArticle}`);
  console.log(`  throttled:  ${throttled}   ← לא נבדקו, להריץ שוב עם --retry-missing`);
  console.log(`  failed:     ${failed}`);
  console.log(`  with occupations: ${out.filter(o => o.occupations.length > 0).length}`);
  console.log(`  with degrees:     ${out.filter(o => o.degrees.length > 0).length}`);
  console.log(`\n  ${path.relative(process.cwd(), OUT_PATH)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
