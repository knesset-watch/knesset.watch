import { NextResponse } from 'next/server';
import { validateApiAuth } from '@minimal-db/ui/auth-utils';
import { dbAvailable } from '@/lib/knesset-db';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

export async function GET() {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  if (!dbAvailable()) return NextResponse.json({ error: 'Database not available' }, { status: 503 });

  const db = new Database(DB_PATH, { readonly: true });

  try {
    // Top attendees vs potential total sessions
    const stats = db.prepare(`
      SELECT 
        p.person_id as id,
        p.first_name || ' ' || p.last_name as name,
        p.faction_name as faction,
        COUNT(a.session_id) as attendedCount
      FROM mk_person p
      LEFT JOIN committee_attendance a ON a.mk_id = p.person_id
      WHERE p.is_current = 1
      GROUP BY p.person_id
      ORDER BY attendedCount DESC
      LIMIT 50
    `).all() as any[];

    return NextResponse.json({ attendance: stats });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    db.close();
  }
}
