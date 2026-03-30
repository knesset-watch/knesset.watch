import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import Database from 'better-sqlite3';
import path from 'path';
import {
  getMkPerson,
  getMkBills,
  getMkBillTopics,
  getMkQueries,
  getMkPositions,
  getMkVoteStats,
  getMkWithMajorityVotes,
  getMkAgendaStats,
  dbAvailable,
} from '@/lib/knesset-db';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
export const dynamic = 'force-dynamic';

// Current K25 coalition faction IDs (same source as persons/route.ts)
const COALITION_FACTION_IDS = new Set([1095, 1096, 1101, 1105, 1106, 1107, 1108]);

export async function GET(request: Request) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const mkIdStr = searchParams.get('mkId');
  if (!mkIdStr || !/^\d+$/.test(mkIdStr)) {
    return NextResponse.json({ error: 'mkId required' }, { status: 400 });
  }
  const mkId = parseInt(mkIdStr, 10);

  try {
    const person            = getMkPerson(mkId);
    const bills             = dbAvailable() ? getMkBills(mkId)             : [];
    const billTopics        = dbAvailable() ? getMkBillTopics(mkId)        : [];
    const queries           = dbAvailable() ? getMkQueries(mkId)           : [];
    const positions         = dbAvailable() ? getMkPositions(mkId)         : [];
    const voteStats         = getMkVoteStats(mkId);
    const withMajorityVotes = dbAvailable() ? getMkWithMajorityVotes(mkId) : [];
    const agendaStats       = dbAvailable() ? getMkAgendaStats(mkId)       : [];

    // Forensic Investigation stats
    const db = new Database(DB_PATH, { readonly: true });
    const rebellion = db.prepare(`
      SELECT COUNT(*) as cnt
      FROM mk_vote_result r
      JOIN mk_person p ON p.person_id = r.mk_id
      JOIN vote_faction_stats s ON s.vote_id = r.vote_id AND s.faction_id = p.faction_id
      WHERE r.mk_id = ? AND r.result_code IN (7, 8) AND r.result_code != s.majority_code
    `).get(mkId) as { cnt: number };

    const attendance = db.prepare(`
      SELECT COUNT(*) as cnt FROM committee_attendance WHERE mk_id = ?
    `).get(mkId) as { cnt: number };

    // List of specific rebelled votes
    const rebelledVotes = db.prepare(`
      SELECT 
        pv.id as voteId,
        pv.title,
        pv.date,
        r.result_code as resultCode,
        s.majority_code as factionMajority
      FROM mk_vote_result r
      JOIN plenary_vote pv ON pv.id = r.vote_id
      JOIN mk_person p ON p.person_id = r.mk_id
      JOIN vote_faction_stats s ON s.vote_id = r.vote_id AND s.faction_id = p.faction_id
      WHERE r.mk_id = ? AND r.result_code IN (7, 8) AND r.result_code != s.majority_code
      ORDER BY pv.date DESC
      LIMIT 20
    `).all(mkId) as any[];

    db.close();

    const isCoalition = person?.factionId != null
      ? COALITION_FACTION_IDS.has(person.factionId)
      : null;

    return NextResponse.json({
      firstName:   person?.firstName   ?? '',
      lastName:    person?.lastName    ?? '',
      factionName: person?.factionName ?? null,
      isCoalition,
      voteStats,
      majorityAlignment: voteStats?.majorityAlignment ?? null,
      bills,
      billTopics,
      queries,
      positions,
      agendaStats,
      rebellionCount: rebellion?.cnt ?? 0,
      attendanceCount: attendance?.cnt ?? 0,
      rebelledVotes,
      // Votes where MK voted with the winning side.
      // For opposition: these are the "crossed the aisle" anomalies.
      // For coalition: these are routine — journalist looks at the inverse (not exposed here yet).
      withMajorityVotes,
    });
  } catch (err: any) {
    console.error('mk-profile error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
