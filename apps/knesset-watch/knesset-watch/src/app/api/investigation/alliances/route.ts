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
    // Top co-initiators
    const alliances = db.prepare(`
      SELECT 
        p1.first_name || ' ' || p1.last_name as mk1,
        p2.first_name || ' ' || p2.last_name as mk2,
        COUNT(*) as sharedBills
      FROM bill_initiator i1
      JOIN bill_initiator i2 ON i1.bill_id = i2.bill_id AND i1.mk_id < i2.mk_id
      JOIN mk_person p1 ON p1.person_id = i1.mk_id
      JOIN mk_person p2 ON p2.person_id = i2.mk_id
      GROUP BY mk1, mk2
      HAVING sharedBills > 5
      ORDER BY sharedBills DESC
      LIMIT 50
    `).all() as any[];

    return NextResponse.json({ alliances });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    db.close();
  }
}
