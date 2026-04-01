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

  const db = new Database(DB_PATH, { readonly: true });
  try {
    const row = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM mk_person WHERE is_current = 1) as mks,
        (SELECT COUNT(*) FROM committee) as committees,
        (SELECT COUNT(*) FROM committee_session) as sessions,
        (SELECT COUNT(*) FROM bill WHERE is_passed = 1) as billsPassed
    `).get() as { mks: number; committees: number; sessions: number; billsPassed: number };

    return NextResponse.json(row);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    db.close();
  }
}
