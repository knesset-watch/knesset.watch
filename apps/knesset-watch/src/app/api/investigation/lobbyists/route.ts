import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
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
    const lobbyists = db.prepare(`
      SELECT 
        l.id,
        l.first_name || ' ' || l.last_name as name,
        group_concat(c.client_name, ', ') as clients
      FROM lobbyist l
      LEFT JOIN lobbyist_client c ON c.lobbyist_id = l.id
      GROUP BY l.id
      ORDER BY name ASC
      LIMIT 100
    `).all() as any[];

    return NextResponse.json({ lobbyists });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    db.close();
  }
}
