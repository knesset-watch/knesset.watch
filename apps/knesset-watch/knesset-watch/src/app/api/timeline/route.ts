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
    // Count bills by month and macro_agenda
    const spikes = db.prepare(`
      SELECT 
        strftime('%Y-%m', publication_date) as month,
        macro_agenda as agenda,
        COUNT(*) as count
      FROM bill
      WHERE publication_date IS NOT NULL AND macro_agenda IS NOT NULL
      GROUP BY month, agenda
      ORDER BY month ASC
    `).all() as any[];

    return NextResponse.json({ timeline: spikes });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    db.close();
  }
}
