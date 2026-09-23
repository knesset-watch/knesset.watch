import type { NextRequest } from 'next/server';
import { getTursoClient } from '@/lib/turso-db';

/**
 * תקרות שימוש לנתיב ה-AI.
 *
 * כל שאלה פתוחה עולה כסף אמיתי אצל ספק המודל. כל עוד האתר מאחורי
 * סיסמה זה תיאורטי; ברגע שהוא ציבורי, תיבת השאלות פתוחה לכל מי שיש
 * לו דפדפן, וההוצאה אינה חסומה בשום מקום בקוד.
 *
 * ההגנה הקיימת הייתה לפי כתובת IP בלבד — 10 בקשות לדקה ו-100 ליום.
 * זה מגן מפני משתמש בודד טורדני ולא מגן על הארנק: כתובת IP היא
 * המשאב הזול ביותר באינטרנט, ומאה שאלות מאלף כתובות הן מאה אלף
 * שאלות. לכן נוספה כאן תקרה גלובלית — סכום כל השאלות מכולם.
 *
 * נכשל סגור, במכוון.
 *
 *   Turso לא מוגדר כלל  → מרשים. זה פיתוח מקומי.
 *   Turso מוגדר ונכשל   → חוסמים. שומר שספירה שנשברה לא תיפתח
 *                         לבלי־סוף בדיוק ברגע שהיא הכי נחוצה.
 *
 * כל התקרות ניתנות לשינוי בקובץ הסביבה בלי לגעת בקוד.
 */

/** מפתחות שמורים בעמודת client_ip. כתובת IP לעולם אינה נראית כך. */
const GLOBAL_DAY = '__all__';
const GLOBAL_MONTH = '__month__';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * ברירות המחדל נגזרו מהתחזית: 100 עד 1,000 שאלות בחודש, כלומר עד
 * 33 ביום. התקרה היומית נותנת פי שלושה מזה, והחודשית פי 1.2 מהקצה
 * העליון — מספיק רחב לשימוש אמיתי, צר מספיק שתקלה לא תגיע למאות
 * דולרים.
 *
 * לפי מחיר gemini-3.8-flash (‎$0.75 לקלט, ‎$3.75 לפלט למיליון) ובערך
 * 1.4 סנט לשאלה: 100 ביום ≈ ‎$1.40, 1,200 בחודש ≈ ‎$17.
 */
export const BUDGET = {
  globalDaily: envInt('ASK_DAILY_BUDGET', 100),
  globalMonthly: envInt('ASK_MONTHLY_BUDGET', 1200),
  perIpDaily: envInt('ASK_IP_DAILY', 20),
  perIpPerMinute: envInt('ASK_IP_PER_MINUTE', 5),
} as const;

export type BudgetVerdict =
  | { allowed: true; globalRemaining: number }
  | { allowed: false; reason: 'global-daily' | 'global-monthly' | 'ip-daily' | 'unavailable' };

/**
 * כתובת המבקש.
 *
 * x-forwarded-for הוא רשימה: הערך הראשון הוא מה שהלקוח טען, וכל אחד
 * אחריו נוסף על ידי פרוקסי בדרך. לוקחים את הראשון כי זו הכתובת
 * המשמעותית ביותר שיש, אבל היא ניתנת לזיוף — וזו בדיוק הסיבה שהתקרה
 * הגלובלית קיימת ואינה נשענת עליה.
 */
export function clientIp(request: NextRequest | Request): string {
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real;
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || '127.0.0.1';
}

/** מגדיל מונה ומחזיר את ערכו אחרי ההגדלה, בפעולה אטומית אחת. */
async function bump(
  client: NonNullable<ReturnType<typeof getTursoClient>>,
  period: string,
  bucket: string,
): Promise<number> {
  const result = await client.execute({
    sql: `
      INSERT INTO api_daily_usage (usage_date, client_ip, request_count)
      VALUES (?, ?, 1)
      ON CONFLICT(usage_date, client_ip)
      DO UPDATE SET request_count = request_count + 1
      RETURNING request_count
    `,
    args: [period, bucket],
  });
  return Number(result.rows[0]?.request_count ?? 0);
}

/**
 * בודק את שלוש התקרות ומקדם את כל המונים.
 *
 * הבדיקה אינה מוקדמת אלא נספרת: כל קריאה מגדילה, ולכן בקשה שנחסמה
 * עדיין נספרת. זה מכוון — מי שמפציץ את הנתיב לא יקבל ספירה חינם.
 */
export async function checkAskBudget(request: NextRequest): Promise<BudgetVerdict> {
  const client = getTursoClient();

  // אין Turso — פיתוח מקומי, אין מה להגן עליו
  if (!client) return { allowed: true, globalRemaining: BUDGET.globalDaily };

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const ip = clientIp(request);

  try {
    const [dayTotal, monthTotal, ipTotal] = await Promise.all([
      bump(client, today, GLOBAL_DAY),
      bump(client, month, GLOBAL_MONTH),
      bump(client, today, ip),
    ]);

    if (monthTotal > BUDGET.globalMonthly) {
      console.error(`[budget] התקרה החודשית נגמרה: ${monthTotal}/${BUDGET.globalMonthly}`);
      return { allowed: false, reason: 'global-monthly' };
    }
    if (dayTotal > BUDGET.globalDaily) {
      console.error(`[budget] התקרה היומית נגמרה: ${dayTotal}/${BUDGET.globalDaily}`);
      return { allowed: false, reason: 'global-daily' };
    }
    if (ipTotal > BUDGET.perIpDaily) {
      return { allowed: false, reason: 'ip-daily' };
    }

    return { allowed: true, globalRemaining: Math.max(0, BUDGET.globalDaily - dayTotal) };
  } catch (error) {
    /*
      נכשל סגור. ספירה שאי אפשר לקרוא היא ספירה שאי אפשר לסמוך עליה,
      ותקלה במסד אינה סיבה לפתוח את הארנק לרווחה.
    */
    console.error('[budget] בדיקת התקרה נכשלה, חוסמים:', error instanceof Error ? error.message : error);
    return { allowed: false, reason: 'unavailable' };
  }
}

/**
 * מה המשתמשת רואה.
 *
 * תקרה שנגמרה אינה תקלה — שום דבר לא נשבר ואין מה לתקן. לכן ההודעה
 * אומרת שלושה דברים ובסדר הזה: מה קרה, מתי זה חוזר, ומה עובד בינתיים.
 * החלק השלישי הוא החשוב: מי שהגיע לשאול שאלה אחת לא צריך להסיק
 * שהאתר מקולקל וללכת.
 *
 * kind מפריד בין השניים כדי שהממשק יציג הודעה ולא אזהרה אדומה.
 */
export interface BudgetNotice {
  kind: 'quota' | 'error';
  message: string;
}

export function budgetNotice(
  reason: Exclude<BudgetVerdict, { allowed: true }>['reason'],
): BudgetNotice {
  switch (reason) {
    case 'global-monthly':
      return {
        kind: 'quota',
        message:
          'נגמרו השאלות לחודש הזה. המכסה משותפת לכל המבקרים באתר, ' +
          'והיא מתחדשת ב-1 בחודש. בינתיים כל השאר פתוח — השאלון, ' +
          'החיפוש והפרוטוקולים.',
      };
    case 'global-daily':
      return {
        kind: 'quota',
        message:
          'נגמרו השאלות להיום. המכסה משותפת לכל המבקרים באתר, והיא ' +
          'מתחדשת מחר. בינתיים כל השאר פתוח — השאלון, החיפוש ' +
          'והפרוטוקולים.',
      };
    case 'ip-daily':
      return {
        kind: 'quota',
        message:
          `הגעת ל-${BUDGET.perIpDaily} שאלות היום, שזו המכסה לכל מבקר. ` +
          'היא מתחדשת מחר. בינתיים אפשר להמשיך בשאלון ובחיפוש.',
      };
    case 'unavailable':
      return {
        kind: 'error',
        message: 'שירות השאלות אינו זמין כרגע. כל שאר האתר עובד כרגיל.',
      };
  }
}
