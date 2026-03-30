import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { getAgenda } from '@/lib/agendas';
import {
  getCachedAgendaVotes,
  setCachedAgendaVotes,
  fetchAgendaVotesFromKnesset,
} from '@/lib/vote-cache';
import { searchVotesByKeywords, dbAvailable } from '@/lib/knesset-db';
import Database from 'better-sqlite3';
import path from 'path';

export async function GET(request: Request) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const topicId = searchParams.get('topic');
  const type = searchParams.get('type'); // 'macro' or 'keyword' (default)

  if (!topicId) {
    return NextResponse.json({ error: 'topic is required' }, { status: 400 });
  }

  try {
    if (type === 'macro') {
      if (!dbAvailable()) return NextResponse.json({ error: 'Database not available' }, { status: 503 });
      const db = new Database(path.join(process.cwd(), 'knesset.db'), { readonly: true });
      const votes = db.prepare(`
        SELECT id as voteId, title, date, total_for as totalFor, total_against as totalAgainst, total_abstain as totalAbstain, is_passed as isPassed
        FROM plenary_vote
        WHERE macro_agenda = ?
        ORDER BY date DESC
      `).all(topicId);
      db.close();
      return NextResponse.json({ topicId, votes, fromDb: true });
    }

    const agenda = getAgenda(topicId);
    if (!agenda) {
      return NextResponse.json({ error: `Unknown topic: ${topicId}` }, { status: 404 });
    }

    // Local DB is fastest — use it when available (after initial seed)
    if (dbAvailable()) {
      const votes = searchVotesByKeywords(agenda.keywords);
      return NextResponse.json({ topicId, votes, fromDb: true });
    }

    // Fallback: KV cache, then live Knesset API
    const cached = await getCachedAgendaVotes(topicId);
    if (cached) {
      return NextResponse.json({
        topicId,
        votes: cached.votes,
        lastFetched: cached.lastFetched,
        fromCache: true,
      });
    }

    const votes = await fetchAgendaVotesFromKnesset(agenda.keywords);
    const lastFetched = Date.now();
    await setCachedAgendaVotes(topicId, { votes, lastFetched });

    return NextResponse.json({ topicId, votes, lastFetched, fromCache: false });
  } catch (err: any) {
    console.error('agenda-votes fetch error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
