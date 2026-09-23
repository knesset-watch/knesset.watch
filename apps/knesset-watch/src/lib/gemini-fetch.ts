/**
 * קריאה ל-Gemini עם ניסיון חוזר ועם תקרת זמן.
 *
 * הרקע: /api/ask עשה ארבע קריאות נפרדות ל-Gemini בכל שאלה — שכתוב
 * השאילתה, הקשר חדשותי, הצעות המשך, והתשובה עצמה — ואף אחת מהן לא
 * ניסתה שוב ולא הוגבלה בזמן. 503 של Gemini פירושו "המודל עמוס כרגע",
 * והוא חולף: זו בדיוק השגיאה שהניסיון החוזר קיים בשבילה. בלעדיו
 * המשתמשת קיבלה "שגיאה בשירות ה-AI: Gemini 503" ונתקעה.
 *
 * בלי תקרת זמן היה גרוע יותר: קריאה תלויה החזיקה את כל הבקשה פתוחה
 * עד שהדפדפן ויתר, וזה נראה כמו "איטי מאוד" ולא כמו תקלה.
 *
 * מה חוזר ומה לא:
 *   408 429 500 502 503 504   חולף — מנסים שוב
 *   400 401 403 404           תקלה אצלנו — אין טעם לנסות
 *
 * ההשהיה גדלה פי שניים בכל סיבוב, עם jitter כדי ששתי בקשות מקבילות
 * לא יחזרו יחד. Retry-After מהשרת גובר על החישוב שלנו.
 */

/**
 * הדגם שהאתר מדבר איתו.
 *
 * היה gemini-3.5-flash בארבעה מקומות מקודדים קשיח. Google סימנה אותו
 * כ-legacy, והוא גם עולה כפול מהדור הנוכחי:
 *
 *   3.5-flash   $1.50 לקלט, $9.00 לפלט, למיליון טוקנים
 *   3.8-flash   $0.75 לקלט, $3.75 לפלט (עד 31.12.2026)
 *
 * המכסה החינמית נמדדת PerProjectPerModel — לכל דגם מכסה משלו — ולכן
 * מעבר דגם גם מאפס את המונה היומי.
 *
 * לשינוי: GEMINI_MODEL בקובץ הסביבה, בלי לגעת בקוד.
 */
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";

/** בונה כתובת לדגם הפעיל. המפתח נשאר אצל הקורא. */
export function geminiUrl(method: string, key: string, params = ""): string {
  return (
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${GEMINI_MODEL}:${method}?key=${key}${params}`
  );
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

/**
 * 429 אינו סוג אחד.
 *
 * מגבלת דקה חולפת תוך שניות וכדאי לנסות שוב. מגבלה יומית לא — 
 * GenerateRequestsPerDayPerProjectPerModel-FreeTier עומדת על 20 בקשות,
 * והיא מתאפסת בחצות בשעון האוקיינוס השקט. ניסיון חוזר עליה רק מאריך
 * את ההמתנה של המשתמשת לפני אותה תשובה שלילית.
 *
 * Gemini מחזיר retryDelay של שנייה אחת גם למכסה היומית, ולכן אי אפשר
 * לסמוך עליו — צריך להסתכל על quotaId.
 */
export class DailyQuotaError extends Error {
  constructor(public readonly quotaValue?: string) {
    super("DAILY_QUOTA");
    this.name = "DailyQuotaError";
  }
}

interface QuotaViolation { quotaId?: string; quotaValue?: string }

function dailyQuotaViolation(body: string): QuotaViolation | null {
  try {
    const parsed = JSON.parse(body) as {
      error?: { details?: Array<{ "@type"?: string; violations?: QuotaViolation[] }> };
    };
    for (const detail of parsed.error?.details ?? []) {
      if (!detail["@type"]?.includes("QuotaFailure")) continue;
      for (const v of detail.violations ?? []) {
        if (v.quotaId?.includes("PerDay")) return v;
      }
    }
  } catch {
    /* גוף שאינו JSON — מתייחסים אליו כאל 429 רגיל */
  }
  return null;
}

export interface GeminiFetchOptions {
  /** כמה ניסיונות חוזרים אחרי הראשון. ברירת מחדל 2, כלומר עד 3 קריאות */
  retries?: number;
  /** תקרת זמן לכל ניסיון בנפרד */
  timeoutMs?: number;
  /** השהיה ראשונה; מוכפלת בכל סיבוב */
  baseDelayMs?: number;
  /** לזיהוי בלוג — איזו מהקריאות נכשלה */
  label?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Retry-After מגיע כשניות או כתאריך. מוגבל ל-10 שניות כדי לא לתלות בקשה. */
function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 10_000);
  const when = Date.parse(raw);
  if (Number.isNaN(when)) return null;
  return Math.min(Math.max(when - Date.now(), 0), 10_000);
}

/**
 * מחזיר את ה-Response המוצלח, או את האחרון שנכשל אחרי שנגמרו הניסיונות —
 * כדי שהקורא יוכל להחליט בעצמו אם ליפול בחן או לזרוק.
 * זורק רק כשהרשת עצמה נכשלה או שהזמן נגמר בכל הניסיונות.
 */
export async function geminiFetch(
  url: string,
  body: unknown,
  options: GeminiFetchOptions = {},
): Promise<Response> {
  const {
    retries = 2,
    timeoutMs = 20_000,
    baseDelayMs = 400,
    label = 'gemini',
  } = options;

  let lastError: unknown = null;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      // 400, 800, 1600... בתוספת עד 250ms אקראיים
      const backoff = baseDelayMs * 2 ** (attempt - 1) + Math.random() * 250;
      const wait = lastResponse ? (retryAfterMs(lastResponse) ?? backoff) : backoff;
      await sleep(wait);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (res.ok) return res;

      /*
        קוראים את הגוף תמיד, משתי סיבות: בלעדיו החיבור נשאר תפוס
        ב-keep-alive והניסיון הבא מחכה לשקע פנוי, ובתוכו נמצא הפירוט
        שמבדיל בין מגבלת דקה למגבלה יומית.
      */
      const errorBody = await res.text().catch(() => '');

      // מכסה יומית — נבדק לפני כל שיקול אחר, כולל בניסיון האחרון
      if (res.status === 429) {
        const daily = dailyQuotaViolation(errorBody);
        if (daily) {
          console.error(`[${label}] המכסה היומית נגמרה (${daily.quotaValue ?? '?'} בקשות)`);
          throw new DailyQuotaError(daily.quotaValue);
        }
      }

      if (!RETRYABLE.has(res.status) || attempt === retries) {
        console.error(`[${label}] ${res.status} — לא מנסים שוב`);
        return new Response(errorBody, { status: res.status, headers: res.headers });
      }

      lastResponse = res;
      console.warn(`[${label}] ${res.status}, ניסיון ${attempt + 1}/${retries + 1}`);
    } catch (error) {
      // מכסה יומית אינה ניתנת לניסיון חוזר; עוברת החוצה כמו שהיא
      if (error instanceof DailyQuotaError) throw error;

      lastError = error;
      const aborted = error instanceof Error && error.name === 'AbortError';
      console.warn(
        `[${label}] ${aborted ? `חריגה מ-${timeoutMs}ms` : 'כשל רשת'}, ניסיון ${attempt + 1}/${retries + 1}`,
      );
      if (attempt === retries) break;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`[${label}] כל ${retries + 1} הניסיונות נכשלו`);
}
