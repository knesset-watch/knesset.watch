import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const { name } = await params;
  const committeeName = decodeURIComponent(name);

  let db: InstanceType<typeof Database> | null = null;
  try {
    db = new Database(DB_PATH, { readonly: true });

    const committee = db.prepare(`
      SELECT c.id, c.name,
             COUNT(cs.id) as session_count,
             MAX(cs.date) as last_date
      FROM committee c
      LEFT JOIN committee_session cs ON cs.committee_id = c.id
      WHERE c.name = ?
      GROUP BY c.id
      ORDER BY session_count DESC
      LIMIT 1
    `).get(committeeName) as { id: number; name: string; session_count: number; last_date: string | null } | undefined;

    if (!committee) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const memberCount = (db.prepare(`
      SELECT COUNT(DISTINCT pos.mk_id) as cnt
      FROM mk_position pos
      JOIN mk_person mp ON mp.person_id = pos.mk_id
      WHERE pos.committee_id = ? AND pos.is_current = 1 AND mp.is_current = 1
    `).get(committee.id) as { cnt: number }).cnt;

    return NextResponse.json({
      name: committee.name,
      sessionCount: committee.session_count,
      lastDate: committee.last_date,
      memberCount,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  } finally {
    db?.close();
  }
}
