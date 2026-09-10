import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { dbAvailable } from '@/lib/knesset-db';
import { getRecentPassedBillsFromTurso } from '@/lib/protocols-db';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

/**
 * החוקים האחרונים שהתקבלו.
 *
 * שני תיקונים מול הגרסה הקודמת:
 *
 * 1. count החזיר את אורך הרשימה אחרי LIMIT 8, כלומר תמיד 8. העמוד הציג
 *    את המספר הזה בגופן ענק תחת הכותרת "חוקים שעברו סופית", בעוד המספר
 *    האמיתי הוא 502. עכשיו total נספר בנפרד מהרשימה המוצגת.
 *
 * 2. הנתונים נקראים מ-Turso, שמגיע ל-26.7.2026 מול 26.3.2026 מקומית.
 *    אם Turso אינו זמין, נופלים למסד המקומי.
 */
export async function GET(request: Request) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;

  try {
    const turso = await getRecentPassedBillsFromTurso({ from, to, limit: 8 });
    if (turso) {
      return NextResponse.json({ ...turso, source: 'turso' });
    }

    if (!dbAvailable()) {
      return NextResponse.json({ error: 'Database not available' }, { status: 503 });
    }

    const db = new Database(DB_PATH, { readonly: true });
    try {
      const conds = ['is_passed = 1', 'publication_date IS NOT NULL'];
      const args: string[] = [];
      if (from) { conds.push('publication_date >= ?'); args.push(from); }
      if (to)   { conds.push('publication_date <= ?'); args.push(to); }
      const where = `WHERE ${conds.join(' AND ')}`;

      const total = (db
        .prepare(`SELECT COUNT(*) AS cnt FROM bill ${where}`)
        .get(...args) as { cnt: number }).cnt;

      const rows = db.prepare(`
        SELECT id, title, publication_date
        FROM bill ${where}
        ORDER BY publication_date DESC, id DESC
        LIMIT 8
      `).all(...args) as Array<{ id: number; title: string; publication_date: string }>;

      return NextResponse.json({
        total,
        bills: rows.map(b => ({ id: b.id, title: b.title, date: b.publication_date })),
        newest: rows[0]?.publication_date ?? null,
        source: 'local',
      });
    } finally {
      db.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Pulse error:', message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
