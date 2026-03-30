import { NextResponse } from 'next/server';
import { validateApiAuth } from '@minimal-db/ui/auth-utils';
import {
  getCachedVoteResults,
  setCachedVoteResults,
  getCachedMkLookup,
  fetchVoteResultsFromKnesset,
  MkResult,
} from '@/lib/vote-cache';
import { getVoteResults, getVoteMeta, dbAvailable } from '@/lib/knesset-db';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ voteId: string }> },
) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const { voteId: voteIdStr } = await params;
  const voteId = parseInt(voteIdStr, 10);
  if (isNaN(voteId)) {
    return NextResponse.json({ error: 'Invalid voteId' }, { status: 400 });
  }

  const CODE_TO_DESC: Record<number, MkResult['result']> = {
    6: 'נוכח', 7: 'בעד', 8: 'נגד', 9: 'נמנע',
  };

  try {
    // ── Fast path: local SQLite DB ──────────────────────────────────────────
    if (dbAvailable()) {
      const meta = getVoteMeta(voteId);
      const rawResults = getVoteResults(voteId);

      // Merge party + coalition info from KV cache if available
      const mkLookup = await getCachedMkLookup();
      const mkResults: MkResult[] = rawResults.map(r => {
        const info = mkLookup?.[String(r.mkId)];
        return {
          mkId: r.mkId,
          firstName: info?.name?.split(' ')[0] ?? '',
          lastName:  info?.name?.split(' ').slice(1).join(' ') ?? '',
          result: CODE_TO_DESC[r.resultCode] ?? 'נוכח',
          party: info?.party,
          isCoalition: info?.isCoalition,
        };
      });

      return NextResponse.json({
        voteId,
        title: meta?.title ?? '',
        date: meta?.date ?? '',
        totalFor: meta?.totalFor ?? 0,
        totalAgainst: meta?.totalAgainst ?? 0,
        totalAbstain: meta?.totalAbstain ?? 0,
        isPassed: meta?.isPassed ?? false,
        microAgenda: meta?.microAgenda,
        macroAgenda: meta?.macroAgenda,
        mkResults,
        fromDb: true,
      });
    }

    // ── Fallback: KV cache → live Knesset API ───────────────────────────────
    let cached = await getCachedVoteResults(voteId);

    if (!cached) {
      const fresh = await fetchVoteResultsFromKnesset(voteId);
      await setCachedVoteResults(voteId, fresh);
      cached = fresh;
    }

    const mkLookup = await getCachedMkLookup();
    let mkResults: MkResult[] = cached.mkResults;

    if (mkLookup) {
      mkResults = mkResults.map(mk => {
        const info = mkLookup[String(mk.mkId)];
        if (!info) return mk;
        return { ...mk, party: info.party, isCoalition: info.isCoalition };
      });
    }

    return NextResponse.json({
      voteId,
      title: cached.title,
      date: cached.date,
      mkResults,
    });
  } catch (err: any) {
    console.error('vote results fetch error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
