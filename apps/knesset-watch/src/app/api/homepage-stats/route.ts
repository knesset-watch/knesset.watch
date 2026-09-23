import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { dbAvailable, dbPath } from '@/lib/knesset-db';
import { getHeadlineCountsFromTurso } from '@/lib/protocols-db';
import Database from 'better-sqlite3';

// הנתיב נפתר מרכזית; cwd של פונקציה סרברלס אינו תיקיית האפליקציה
const DB_PATH = dbPath() ?? '';

/** כמה חודשים אחורה נמדדת המגמה בכרטיסים */
const TREND_MONTHS = 18;

/**
 * ממלא חודשים חסרים באפסים, כדי שהגרף הזעיר יראה שקט אמיתי ולא
 * ידלג עליו. מחזיר מערך באורך TREND_MONTHS שמסתיים בחודש האחרון שיש בו נתון.
 */
function toSeries(rows: Array<{ month: string; n: number }>): number[] {
  if (rows.length === 0) return [];
  const byMonth = new Map(rows.map(r => [r.month, r.n]));
  const last = rows[rows.length - 1].month;
  const [ly, lm] = last.split('-').map(Number);

  const out: number[] = [];
  for (let i = TREND_MONTHS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(ly, lm - 1 - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push(byMonth.get(key) ?? 0);
  }
  return out;
}

export async function GET(request: Request) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  if (!dbAvailable()) {
    return NextResponse.json({ error: 'Database not available' }, { status: 503 });
  }

  const url = new URL(request.url);
  const from = url.searchParams.get('from') ?? '2022-11-15';
  const to   = url.searchParams.get('to')   ?? '9999-12-31';

  const db = new Database(DB_PATH, { readonly: true });
  try {
    const row = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM mk_person WHERE is_current = 1) as mks,
        (SELECT COUNT(DISTINCT c.name) FROM committee c
           JOIN committee_session cs ON cs.committee_id = c.id
           WHERE cs.date >= ? AND cs.date <= ?) as committees,
        (SELECT COUNT(*) FROM committee_session WHERE date >= ? AND date <= ?) as sessions,
        (SELECT COUNT(*) FROM bill WHERE is_passed = 1 AND publication_date >= ? AND publication_date <= ?) as billsPassed,
        (SELECT COUNT(*) FROM plenary_vote WHERE date >= ? AND date <= ?) as votes
    `).get(from, to, from, to, from, to, from, to) as {
      mks: number; committees: number; sessions: number; billsPassed: number; votes: number;
    };

    /*
      billsTotal נספר בנפרד ובלי טווח תאריכים, במכוון.

      קודם הוא היה COUNT(*) FROM bill WHERE publication_date BETWEEN ...,
      אבל publication_date נכתב רק כשחוק מתפרסם ברשומות — כלומר רק
      לחוקים שעברו. התוצאה הייתה billsTotal == billsPassed, ודף הבית
      הציג "503 חוקים עברו, מתוך 503 הצעות", כאילו כל הצעה מתקבלת.

      init_date, שהיה אמור להחזיק את תאריך ההגשה, ריק בכל 7,296 השורות.
      לכן אין דרך לסנן הצעות לפי זמן, והמספר הוא הסך הכולל.
    */
    const billsTotal = (db.prepare('SELECT COUNT(*) AS n FROM bill').get() as { n: number }).n;

    /*
      סדרות חודשיות לגרף הזעיר בכרטיס. הן מוסיפות את מה שהמספר לבדו
      אינו אומר — אם הקצב עולה או יורד.
    */
    const monthly = (sql: string) =>
      toSeries(db.prepare(sql).all(from, to) as Array<{ month: string; n: number }>);

    const trends = {
      votes: monthly(`
        SELECT strftime('%Y-%m', date) AS month, COUNT(*) AS n
        FROM plenary_vote WHERE date >= ? AND date <= ?
        GROUP BY month ORDER BY month`),
      billsPassed: monthly(`
        SELECT strftime('%Y-%m', publication_date) AS month, COUNT(*) AS n
        FROM bill WHERE is_passed = 1 AND publication_date >= ? AND publication_date <= ?
        GROUP BY month ORDER BY month`),
      sessions: monthly(`
        SELECT strftime('%Y-%m', date) AS month, COUNT(*) AS n
        FROM committee_session WHERE date >= ? AND date <= ?
        GROUP BY month ORDER BY month`),
    };

    /*
      Turso הוא המקור המעודכן. בלעדיו דף הבית הראה 6,358 הצבעות בזמן
      שעמוד ההצבעות הראה 7,537 — שני מספרים לאותו נתון.
      mks נשאר מקומי; mk_person זהה בשני המסדים.
    */
    const fresh = await getHeadlineCountsFromTurso(from, to);
    const merged = fresh ? { ...row, ...fresh } : row;

    // הסך הכולל שלנו גובר גם על Turso, שסופר אותו באותה דרך שגויה
    return NextResponse.json({ ...merged, billsTotal, trends, trendMonths: TREND_MONTHS });
  } catch (error: unknown) {
    console.error('homepage-stats error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    db.close();
  }
}
