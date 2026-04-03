import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { dbAvailable } from '@/lib/knesset-db';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

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
        (SELECT COUNT(*) FROM bill WHERE publication_date >= ? AND publication_date <= ?) as billsTotal,
        (SELECT COUNT(*) FROM plenary_vote WHERE date >= ? AND date <= ?) as votes
    `).get(from, to, from, to, from, to, from, to, from, to) as {
      mks: number; committees: number; sessions: number; billsPassed: number; billsTotal: number; votes: number;
    };

    return NextResponse.json(row);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    db.close();
  }
}
