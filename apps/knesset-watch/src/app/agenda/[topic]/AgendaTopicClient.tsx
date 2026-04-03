'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { getAgenda } from '@/lib/agendas';
import { VoteSummary, MkResult } from '@/lib/vote-cache';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

type TabView = 'votes' | 'by-mk' | 'by-party';
type CoalitionFilter = 'all' | 'coalition' | 'opposition';

interface VoteWithResults extends VoteSummary {
  results?: MkResult[];
  resultsLoading?: boolean;
  resultsError?: string;
}

const RESULT_COLORS: Record<string, string> = {
  'בעד':  'bg-[#16A34A] text-white',
  'נגד':  'bg-[#2563EB] text-white',
  'נמנע': 'bg-amber-100 text-amber-800',
  'נוכח': 'bg-zinc-100 text-zinc-500',
};

function pct(num: number, denom: number): string {
  if (denom === 0) return '—';
  return Math.round((num / denom) * 100) + '%';
}

function formatDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: '2-digit' });
}

interface MkAggregate {
  mkId: number;
  firstName: string;
  lastName: string;
  party: string;
  isCoalition: boolean | undefined;
  for: number;
  against: number;
  abstain: number;
  present: number;
}

interface PartyAggregate {
  party: string;
  isCoalition: boolean | undefined;
  for: number;
  against: number;
  abstain: number;
  present: number;
}

export default function AgendaTopicClient({ topic }: { topic: string }) {
  const router = useRouter();
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const isMacro = searchParams?.get('type') === 'macro';
  const agenda = isMacro ? { id: topic, label: decodeURIComponent(topic), keywords: [] } : getAgenda(topic);

  const [votes, setVotes] = useState<VoteWithResults[]>([]);
  const [votesLoading, setVotesLoading] = useState(true);
  const [votesError, setVotesError] = useState<string | null>(null);

  const [tab, setTab] = useState<TabView>('votes');
  const [coalFilter, setCoalFilter] = useState<CoalitionFilter>('all');
  const [expandedVote, setExpandedVote] = useState<number | null>(null);
  const [mkSort, setMkSort] = useState<'name' | 'party' | 'support'>('support');

  // Step 1: load vote list
  useEffect(() => {
    if (!agenda) return;
    setVotesLoading(true);
    setVotesError(null);
    const url = isMacro 
      ? `${BASE_PATH}/api/agenda-votes?topic=${topic}&type=macro`
      : `${BASE_PATH}/api/agenda-votes?topic=${topic}`;

    fetch(url)
      .then(r => r.json())
      .then(json => {
        if (json.error) throw new Error(json.error);
        const list: VoteWithResults[] = (json.votes ?? []).map((v: VoteSummary) => ({
          ...v,
          resultsLoading: true,
        }));
        setVotes(list);
        setVotesLoading(false);
        // Step 2: fetch results for each vote
        return list;
      })
      .then(list => {
        list.forEach(v => {
          fetch(`${BASE_PATH}/api/vote/${v.voteId}`)
            .then(r => r.json())
            .then(json => {
              if (json.error) throw new Error(json.error);
              setVotes(prev =>
                prev.map(pv =>
                  pv.voteId === v.voteId
                    ? { ...pv, results: json.mkResults, title: json.title || pv.title, date: json.date || pv.date, resultsLoading: false }
                    : pv
                )
              );
            })
            .catch(e => {
              setVotes(prev =>
                prev.map(pv =>
                  pv.voteId === v.voteId
                    ? { ...pv, resultsLoading: false, resultsError: e.message }
                    : pv
                )
              );
            });
        });
      })
      .catch(e => {
        setVotesError(e.message);
        setVotesLoading(false);
      });
  }, [topic, agenda]);

  // ── Derived data ──────────────────────────────────────────────────────────────

  const votesWithResults = useMemo(() => votes.filter(v => v.results), [votes]);

  // Compute per-vote coalition/opposition support %
  function computeVoteStats(results: MkResult[]) {
    const coal = results.filter(r => r.isCoalition === true);
    const opp  = results.filter(r => r.isCoalition === false);
    const coalFor = coal.filter(r => r.result === 'בעד').length;
    const oppFor  = opp.filter(r => r.result === 'בעד').length;
    const coalVoting = coal.filter(r => r.result === 'בעד' || r.result === 'נגד').length;
    const oppVoting  = opp.filter(r => r.result === 'בעד' || r.result === 'נגד').length;
    return { coalFor, oppFor, coalVoting, oppVoting };
  }

  // Aggregate by MK across all votes
  const mkAggregates = useMemo(() => {
    const map = new Map<number, MkAggregate>();
    for (const vote of votesWithResults) {
      for (const r of vote.results!) {
        if (coalFilter === 'coalition' && r.isCoalition !== true) continue;
        if (coalFilter === 'opposition' && r.isCoalition !== false) continue;
        const existing = map.get(r.mkId);
        if (existing) {
          if (r.result === 'בעד')  existing.for++;
          if (r.result === 'נגד')  existing.against++;
          if (r.result === 'נמנע') existing.abstain++;
          if (r.result === 'נוכח') existing.present++;
        } else {
          map.set(r.mkId, {
            mkId: r.mkId,
            firstName: r.firstName,
            lastName: r.lastName,
            party: r.party ?? '—',
            isCoalition: r.isCoalition,
            for:     r.result === 'בעד'  ? 1 : 0,
            against: r.result === 'נגד'  ? 1 : 0,
            abstain: r.result === 'נמנע' ? 1 : 0,
            present: r.result === 'נוכח' ? 1 : 0,
          });
        }
      }
    }
    return Array.from(map.values());
  }, [votesWithResults, coalFilter]);

  const sortedMks = useMemo(() => {
    const list = [...mkAggregates];
    if (mkSort === 'name') {
      list.sort((a, b) => a.lastName.localeCompare(b.lastName, 'he'));
    } else if (mkSort === 'party') {
      list.sort((a, b) => a.party.localeCompare(b.party, 'he'));
    } else {
      // support: % for out of for+against
      list.sort((a, b) => {
        const ra = a.for + a.against > 0 ? a.for / (a.for + a.against) : -1;
        const rb = b.for + b.against > 0 ? b.for / (b.for + b.against) : -1;
        return rb - ra;
      });
    }
    return list;
  }, [mkAggregates, mkSort]);

  // Aggregate by party
  const partyAggregates = useMemo(() => {
    const map = new Map<string, PartyAggregate>();
    for (const vote of votesWithResults) {
      for (const r of vote.results!) {
        if (coalFilter === 'coalition' && r.isCoalition !== true) continue;
        if (coalFilter === 'opposition' && r.isCoalition !== false) continue;
        const party = r.party ?? '—';
        const existing = map.get(party);
        if (existing) {
          if (r.result === 'בעד')  existing.for++;
          if (r.result === 'נגד')  existing.against++;
          if (r.result === 'נמנע') existing.abstain++;
          if (r.result === 'נוכח') existing.present++;
        } else {
          map.set(party, {
            party,
            isCoalition: r.isCoalition,
            for:     r.result === 'בעד'  ? 1 : 0,
            against: r.result === 'נגד'  ? 1 : 0,
            abstain: r.result === 'נמנע' ? 1 : 0,
            present: r.result === 'נוכח' ? 1 : 0,
          });
        }
      }
    }
    // Sort: coalition first, then by support %
    return Array.from(map.values()).sort((a, b) => {
      if (a.isCoalition !== b.isCoalition) {
        return (b.isCoalition ? 1 : 0) - (a.isCoalition ? 1 : 0);
      }
      const ra = a.for + a.against > 0 ? a.for / (a.for + a.against) : -1;
      const rb = b.for + b.against > 0 ? b.for / (b.for + b.against) : -1;
      return rb - ra;
    });
  }, [votesWithResults, coalFilter]);

  // ── Render helpers ────────────────────────────────────────────────────────────

  function handleBack() {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push('/agendas');
    }
  }

  if (!agenda) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center" dir="rtl">
        <p className="text-red-600 font-black">נושא לא נמצא: {topic}</p>
      </div>
    );
  }

  const resultsLoaded = votes.filter(v => !v.resultsLoading).length;
  const allResultsLoaded = votes.length > 0 && resultsLoaded === votes.length;

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-5xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={handleBack}
            className="text-sm font-black px-3 py-1.5 rounded border border-black/10 hover:bg-gray-50 transition-colors"
          >
            → חזרה
          </button>
          <div>
            <h1 className="text-2xl font-black leading-tight">{agenda.label}</h1>
            {!votesLoading && (
              <p className="text-xs text-gray-500 mt-0.5 font-medium">
                {votes.length} הצבעות
                {!allResultsLoaded && votes.length > 0 && (
                  <span className="mr-2 animate-pulse">
                    · טוען תוצאות {resultsLoaded}/{votes.length}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>

        {votesLoading && (
          <div className="py-32 text-center text-xl font-black animate-pulse opacity-20">טוען הצבעות...</div>
        )}

        {votesError && (
          <div className="p-8 text-center text-red-600 font-black">{votesError}</div>
        )}

        {!votesLoading && !votesError && votes.length === 0 && (
          <div className="py-16 text-center text-gray-400 font-black">לא נמצאו הצבעות בנושא זה</div>
        )}

        {!votesLoading && !votesError && votes.length > 0 && (
          <>
            {/* Tab bar + filter */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <div className="flex gap-1">
                {([['votes', 'הצבעות'], ['by-mk', 'לפי ח"כ'], ['by-party', 'לפי סיעה']] as [TabView, string][]).map(([t, label]) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`text-xs font-black px-3 py-1.5 rounded-lg transition-colors ${tab === t ? 'bg-black text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab !== 'votes' && (
                <div className="flex gap-1">
                  {([['all', 'הכל'], ['coalition', 'קואליציה'], ['opposition', 'אופוזיציה']] as [CoalitionFilter, string][]).map(([f, label]) => (
                    <button
                      key={f}
                      onClick={() => setCoalFilter(f)}
                      className={`text-xs font-black px-3 py-1.5 rounded-full transition-colors ${
                        coalFilter === f
                          ? f === 'coalition' ? 'bg-[#16A34A] text-white'
                            : f === 'opposition' ? 'bg-[#2563EB] text-white'
                            : 'bg-black text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── Tab: votes list ─────────────────────────────────────────── */}
            {tab === 'votes' && (
              <div className="flex flex-col gap-1.5">
                <div className="grid grid-cols-[1fr_6rem_6rem] text-[11px] font-black uppercase text-gray-400 px-4 pb-1 gap-2">
                  <span>כותרת</span>
                  <span className="text-center">קואליציה</span>
                  <span className="text-center">אופוזיציה</span>
                </div>

                {votes.map(v => {
                  const stats = v.results ? computeVoteStats(v.results) : null;
                  const isExpanded = expandedVote === v.voteId;

                  return (
                    <div key={v.voteId}>
                      <button
                        onClick={() => setExpandedVote(isExpanded ? null : v.voteId)}
                        className="w-full grid grid-cols-[1fr_6rem_6rem] items-center gap-2 py-3 px-4 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors text-right"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-bold leading-snug text-gray-900 truncate">{v.title || '—'}</p>
                          <p className="text-[11px] text-gray-500 font-medium mt-0.5">{formatDate(v.date)}</p>
                        </div>

                        {v.resultsLoading ? (
                          <>
                            <span className="text-xs text-gray-300 text-center animate-pulse">...</span>
                            <span className="text-xs text-gray-300 text-center animate-pulse">...</span>
                          </>
                        ) : stats ? (
                          <>
                            <span className="text-xs font-black text-center text-[#16A34A]">
                              {pct(stats.coalFor, stats.coalVoting)}
                            </span>
                            <span className="text-xs font-black text-center text-[#2563EB]">
                              {pct(stats.oppFor, stats.oppVoting)}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-xs text-red-400 text-center">שגיאה</span>
                            <span />
                          </>
                        )}
                      </button>

                      {/* Expanded MK results */}
                      {isExpanded && v.results && (
                        <div className="mx-2 mb-2 rounded-xl border border-black/5 overflow-hidden">
                          <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-4 py-2 text-[11px] font-black uppercase text-gray-400 bg-gray-50 border-b border-black/5">
                            <span>שם</span>
                            <span>סיעה</span>
                            <span>תוצאה</span>
                          </div>
                          {v.results.map(r => (
                            <div
                              key={r.mkId}
                              className={`grid grid-cols-[1fr_auto_auto] gap-2 px-4 py-2 text-sm border-b border-black/3 last:border-0 ${r.isCoalition === true ? 'bg-[#F0FDF4]/40' : r.isCoalition === false ? 'bg-[#EFF6FF]/40' : 'bg-white'}`}
                            >
                              <span className="font-bold">{r.firstName} {r.lastName}</span>
                              <span className="text-xs text-gray-500 font-medium">{r.party ?? '—'}</span>
                              <span className={`text-[11px] font-black px-2 py-0.5 rounded-full ${RESULT_COLORS[r.result] ?? 'bg-zinc-100 text-zinc-500'}`}>
                                {r.result}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Tab: by MK ─────────────────────────────────────────────── */}
            {tab === 'by-mk' && (
              <>
                {/* Sort controls */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[11px] font-black uppercase text-gray-400">מיון:</span>
                  {([['support', 'תמיכה'], ['party', 'סיעה'], ['name', 'שם']] as ['support' | 'party' | 'name', string][]).map(([s, label]) => (
                    <button
                      key={s}
                      onClick={() => setMkSort(s)}
                      className={`text-xs font-black px-2 py-1 rounded transition-colors ${mkSort === s ? 'bg-black text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {sortedMks.length === 0 ? (
                  <div className="py-16 text-center text-gray-400 font-black">
                    {allResultsLoaded ? 'אין נתונים' : 'טוען תוצאות...'}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <div className="grid grid-cols-[1fr_6rem_4rem_4rem_4rem_5rem] text-[11px] font-black uppercase text-gray-400 px-3 pb-1 gap-1">
                      <span>שם</span>
                      <span>סיעה</span>
                      <span className="text-center">בעד</span>
                      <span className="text-center">נגד</span>
                      <span className="text-center">נמנע</span>
                      <span className="text-center">% תמיכה</span>
                    </div>
                    {sortedMks.map(mk => {
                      const voting = mk.for + mk.against;
                      return (
                        <div
                          key={mk.mkId}
                          className={`grid grid-cols-[1fr_6rem_4rem_4rem_4rem_5rem] items-center gap-1 py-2 px-3 rounded-lg text-sm ${mk.isCoalition === true ? 'bg-[#F0FDF4]/50' : mk.isCoalition === false ? 'bg-[#EFF6FF]/50' : 'bg-gray-50'}`}
                        >
                          <span className="font-bold truncate">{mk.firstName} {mk.lastName}</span>
                          <span className="text-xs text-gray-500 font-medium truncate">{mk.party}</span>
                          <span className="text-center text-xs font-black text-[#16A34A]">{mk.for}</span>
                          <span className="text-center text-xs font-black text-[#2563EB]">{mk.against}</span>
                          <span className="text-center text-xs font-medium text-amber-700">{mk.abstain}</span>
                          <span className="text-center text-xs font-black">
                            {voting > 0 ? pct(mk.for, voting) : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {/* ── Tab: by party ──────────────────────────────────────────── */}
            {tab === 'by-party' && (
              <>
                {partyAggregates.length === 0 ? (
                  <div className="py-16 text-center text-gray-400 font-black">
                    {allResultsLoaded ? 'אין נתונים' : 'טוען תוצאות...'}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <div className="grid grid-cols-[1fr_5rem_4rem_4rem_4rem_5rem] text-[11px] font-black uppercase text-gray-400 px-3 pb-1 gap-1">
                      <span>סיעה</span>
                      <span>מעמד</span>
                      <span className="text-center">בעד</span>
                      <span className="text-center">נגד</span>
                      <span className="text-center">נמנע</span>
                      <span className="text-center">% תמיכה</span>
                    </div>
                    {partyAggregates.map(p => {
                      const voting = p.for + p.against;
                      return (
                        <div
                          key={p.party}
                          className={`grid grid-cols-[1fr_5rem_4rem_4rem_4rem_5rem] items-center gap-1 py-2.5 px-3 rounded-lg ${p.isCoalition === true ? 'bg-[#F0FDF4]/50' : p.isCoalition === false ? 'bg-[#EFF6FF]/50' : 'bg-gray-50'}`}
                        >
                          <span className="text-sm font-black">{p.party}</span>
                          <span className={`text-[11px] font-black px-2 py-0.5 rounded-full w-fit ${p.isCoalition === true ? 'bg-[#16A34A] text-white' : p.isCoalition === false ? 'bg-[#2563EB] text-white' : 'bg-zinc-200 text-zinc-600'}`}>
                            {p.isCoalition === true ? 'קואליציה' : p.isCoalition === false ? 'אופוזיציה' : '—'}
                          </span>
                          <span className="text-center text-sm font-black text-[#16A34A]">{p.for}</span>
                          <span className="text-center text-sm font-black text-[#2563EB]">{p.against}</span>
                          <span className="text-center text-sm font-medium text-amber-700">{p.abstain}</span>
                          <span className="text-center text-sm font-black">
                            {voting > 0 ? pct(p.for, voting) : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
