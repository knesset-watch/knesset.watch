import { NextResponse } from 'next/server';
import { validateApiAuth } from '@minimal-db/ui/auth-utils';
import { dbAvailable } from '@/lib/knesset-db';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

export async function GET() {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  if (!dbAvailable()) {
    return NextResponse.json({ error: 'Database not available' }, { status: 503 });
  }

  const db = new Database(DB_PATH, { readonly: true });

  try {
    // Get faction stats: members, isCoalition, bills, passed
    const mks = db.prepare(`
      SELECT faction_name, is_coalition, is_current, person_id
      FROM mk_person
    `).all() as any[];

    const billStats = db.prepare(`
      SELECT p.faction_name, COUNT(b.id) as billCount, SUM(b.is_passed) as passedCount
      FROM bill b
      JOIN bill_initiator i ON i.bill_id = b.id
      JOIN mk_person p ON p.person_id = i.mk_id
      GROUP BY p.faction_name
    `).all() as any[];

    const billMap = new Map(billStats.map(s => [s.faction_name, s]));

    const factionMap = new Map<string, any>();

    for (const mk of mks) {
      const name = mk.faction_name || 'עצמאי';
      if (!factionMap.has(name)) {
        factionMap.set(name, {
          name,
          isCoalition: !!mk.is_coalition,
          memberCount: 0,
          currentMemberCount: 0,
          billCount: billMap.get(name)?.billCount || 0,
          passedCount: billMap.get(name)?.passedCount || 0,
        });
      }
      const f = factionMap.get(name);
      f.memberCount++;
      if (mk.is_current) f.currentMemberCount++;
    }

    const factions = Array.from(factionMap.values()).map(f => {
      const rebelStats = db.prepare(`
        SELECT SUM(rebel_count) as totalRebels, COUNT(*) as totalVotes
        FROM vote_faction_stats
        WHERE faction_id = (SELECT faction_id FROM mk_person WHERE faction_name = ? LIMIT 1)
      `).get(f.name) as { totalRebels: number, totalVotes: number };

      return {
        ...f,
        totalRebels: rebelStats?.totalRebels || 0,
        rebellionRate: rebelStats?.totalVotes > 0 ? (rebelStats.totalRebels / (rebelStats.totalVotes * f.memberCount)) * 100 : 0
      };
    }).sort((a, b) => b.currentMemberCount - a.currentMemberCount);

    return NextResponse.json({ factions });
  } catch (error: any) {
    console.error('Factions DB error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    db.close();
  }
}
