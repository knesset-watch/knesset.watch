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
  const ministryName = decodeURIComponent(name);

  let db: InstanceType<typeof Database> | null = null;
  try {
    db = new Database(DB_PATH, { readonly: true });

    const totalMinisters = (db.prepare(`
      SELECT COUNT(DISTINCT mk_id) as cnt FROM mk_position WHERE ministry = ?
    `).get(ministryName) as { cnt: number }).cnt;

    if (totalMinisters === 0) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const currentMinister = (db.prepare(`
      SELECT mp.first_name || ' ' || mp.last_name as name
      FROM mk_position pos
      JOIN mk_person mp ON mp.person_id = pos.mk_id
      WHERE pos.ministry = ? AND pos.is_current = 1
        AND (pos.duty_desc LIKE 'שר%' OR pos.duty_desc LIKE 'שרת%'
          OR pos.duty_desc LIKE 'השר%' OR pos.duty_desc LIKE 'השרה%')
      ORDER BY pos.start_date DESC LIMIT 1
    `).get(ministryName) as { name: string } | undefined)?.name ?? null;

    const billCount = (db.prepare(`
      SELECT COUNT(*) as cnt FROM bill WHERE committee_name = ?
    `).get(ministryName) as { cnt: number }).cnt;

    return NextResponse.json({
      name: ministryName,
      currentMinister,
      totalMinisters,
      billCount,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  } finally {
    db?.close();
  }
}
