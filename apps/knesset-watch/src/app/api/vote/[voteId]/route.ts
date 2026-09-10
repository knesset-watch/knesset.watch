import { NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import {
  getCachedVoteResults,
  setCachedVoteResults,
  getCachedMkLookup,
  fetchVoteResultsFromKnesset,
  MkResult,
} from '@/lib/vote-cache';
import { getVoteResults, getVoteMeta, dbAvailable } from '@/lib/knesset-db';
import { getVoteDetailFromTurso } from '@/lib/protocols-db';

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
      let meta = getVoteMeta(voteId);
      let rawResults = getVoteResults(voteId);

      /*
        רשימת ההצבעות נקראת מ-Turso ומציגה 1,202 הצבעות שאינן
        ב-knesset.db המקומי. בלי הנפילה הזאת, 1,179 מהן נפתחו כעמוד
        ריק — כותרת ריקה ואפס מצביעים — כי הבדיקה המקומית החזירה null
        והמסלול המשיך בלעדיה.
      */
      if (!meta) {
        const fresh = await getVoteDetailFromTurso(voteId);
        if (fresh) {
          meta = fresh.meta;
          rawResults = fresh.results;
        }
      }

      if (!meta) {
        return NextResponse.json({ error: 'Vote not found' }, { status: 404 });
      }

      // Merge party + coalition info from KV cache if available
      const mkLookup = await getCachedMkLookup();
      const mkResults: Array<MkResult & { slug?: string | null }> = rawResults.map(r => {
        const info = mkLookup?.[String(r.mkId)];
        return {
          mkId: r.mkId,
          slug: r.slug ?? null,
          firstName: r.firstName ?? info?.name?.split(' ')[0] ?? '',
          lastName:  r.lastName  ?? info?.name?.split(' ').slice(1).join(' ') ?? '',
          result: CODE_TO_DESC[r.resultCode] ?? 'נוכח',
          party: info?.party ?? r.factionName ?? undefined,
          isCoalition: info?.isCoalition ?? (r.isCoalition === null ? undefined : r.isCoalition === 1),
        };
      });

      return NextResponse.json({
        voteId,
        title: meta.title,
        date: meta.date,
        totalFor: meta.totalFor,
        totalAgainst: meta.totalAgainst,
        totalAbstain: meta.totalAbstain,
        isPassed: meta.isPassed,
        microAgenda: meta.microAgenda,
        macroAgenda: meta.macroAgenda,
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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
