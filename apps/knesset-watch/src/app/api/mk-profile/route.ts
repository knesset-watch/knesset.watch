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

    // Committee activity — which committees this MK participated in
    const committeeActivity = (db.prepare(`
      SELECT c.name as committee_name, COUNT(*) as session_count
      FROM committee_attendance ca
      JOIN committee_session cs ON cs.id = ca.session_id
      JOIN committee c ON c.id = cs.committee_id
      WHERE ca.mk_id = ?
      GROUP BY c.id
      ORDER BY session_count DESC
      LIMIT 12
    `).all(mkId) as Array<{ committee_name: string; session_count: number }>).map(row => {
      const recentSessions = db.prepare(`
        SELECT cs.id, cs.date, cs.title
        FROM committee_attendance ca
        JOIN committee_session cs ON cs.id = ca.session_id
        JOIN committee c ON c.id = cs.committee_id
        WHERE ca.mk_id = ? AND c.name = ?
        ORDER BY cs.date DESC
        LIMIT 3
      `).all(mkId, row.committee_name) as Array<{ id: number; date: string; title: string | null }>;
      return {
        committeeName: row.committee_name,
        sessionCount: row.session_count,
        recentSessions,
      };
    });

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
      committeeActivity,
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
