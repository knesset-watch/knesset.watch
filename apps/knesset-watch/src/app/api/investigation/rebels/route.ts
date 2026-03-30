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
    // Find MKs with the highest rebellion count
    // Rebellion = ResultCode (7/8) != Faction's MajorityCode for that vote
    const rebels = db.prepare(`
      SELECT 
        p.person_id as id,
        p.first_name || ' ' || p.last_name as name,
        p.faction_name as faction,
        COUNT(*) as rebellionCount
      FROM mk_vote_result r
      JOIN mk_person p ON p.person_id = r.mk_id
      JOIN vote_faction_stats s ON s.vote_id = r.vote_id AND s.faction_id = p.faction_id
      WHERE r.result_code IN (7, 8) 
        AND r.result_code != s.majority_code
      GROUP BY p.person_id
      ORDER BY rebellionCount DESC
      LIMIT 20
    `).all() as any[];

    return NextResponse.json({ rebels });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    db.close();
  }
}
