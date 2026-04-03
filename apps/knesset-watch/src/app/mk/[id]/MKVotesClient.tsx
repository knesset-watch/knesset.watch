'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import MKAgendaView from './MKAgendaView';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

type TabView = 'votes' | 'agenda';
type ResultFilter = 'all' | 'בעד' | 'נגד' | 'נמנע' | 'נוכח';

interface Vote {
  Id: number;
  VoteID: number;
  VoteDate: string;
  ResultDesc: string;
  FirstName: string;
  LastName: string;
  Vote?: {
    VoteTitle: string;
    VoteSubject: string;
    IsNoConfidenceInGov: boolean | null;
    ForOptionDesc: string;
    AgainstOptionDesc: string;
  };
}

const RESULT_COLORS: Record<string, string> = {
  'בעד':  'bg-[#16A34A] text-white',
  'נגד':  'bg-[#2563EB] text-white',
  'נמנע': 'bg-amber-100 text-amber-800',
  'נוכח': 'bg-zinc-100 text-zinc-500',
};

const PAGE_SIZE = 50;

export default function MKVotesClient({ mkId }: { mkId: string }) {
  const router = useRouter();
  const [votes, setVotes] = useState<Vote[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mkName, setMkName] = useState<string>('');
  const [tab, setTab] = useState<TabView>('votes');
  const [filter, setFilter] = useState<ResultFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${BASE_PATH}/api/votes?mkId=${mkId}`);
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        setVotes(json.votes ?? []);
        setTotal(json.total ?? json.votes?.length ?? 0);
        if (json.votes?.length > 0) {
          const v = json.votes[0];
          setMkName(`${v.FirstName ?? ''} ${v.LastName ?? ''}`.trim());
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [mkId]);

  const filtered = useMemo(() => {
    let list = votes;
    if (filter !== 'all') list = list.filter(v => v.ResultDesc === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(v =>
        v.Vote?.VoteTitle?.toLowerCase().includes(q) ||
        v.Vote?.VoteSubject?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [votes, filter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageVotes = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Reset to page 1 when filter/search changes
  useEffect(() => { setPage(1); }, [filter, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { 'בעד': 0, 'נגד': 0, 'נמנע': 0, 'נוכח': 0 };
    for (const v of votes) {
      if (v.ResultDesc in c) c[v.ResultDesc]++;
    }
    return c;
  }, [votes]);

  function handleBack() {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push('/');
    }
  }

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-4xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={handleBack}
            className="text-sm font-black px-3 py-1.5 rounded border border-black/10 hover:bg-gray-50 transition-colors"
          >
→ חזרה
          </button>
          <div>
            <h1 className="text-2xl font-black leading-tight">
              {loading ? 'טוען...' : mkName || `חבר כנסת ${mkId}`}
            </h1>
            {!loading && !error && (
              <p className="text-xs text-gray-500 mt-0.5 font-medium">
                {total > votes.length
                  ? `מוצגות ${votes.length} מתוך ${total} הצבעות בכנסת 25`
                  : `${votes.length} הצבעות בכנסת 25`}
              </p>
            )}
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-6">
          {([['votes', 'הצבעות'], ['agenda', 'אג\'נדה']] as [TabView, string][]).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-xs font-black px-4 py-1.5 rounded-lg transition-colors ${tab === t ? 'bg-black text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Agenda tab */}
        {tab === 'agenda' && <MKAgendaView mkId={mkId} />}

        {/* Votes tab */}
        {tab === 'votes' && loading && (
          <div className="py-32 text-center text-xl font-black animate-pulse opacity-20">טוען הצבעות...</div>
        )}

        {tab === 'votes' && error && (
          <div className="p-8 text-center text-red-600 font-black">{error}</div>
        )}

        {tab === 'votes' && !loading && !error && (
          <>
            {/* Summary badges */}
            <div className="flex flex-wrap gap-2 mb-6">
              {(['all', 'בעד', 'נגד', 'נמנע', 'נוכח'] as ResultFilter[]).map(f => {
                const count = f === 'all' ? votes.length : counts[f];
                const active = filter === f;
                const color = f === 'all'
                  ? active ? 'bg-black text-white' : 'bg-zinc-100 text-zinc-700'
                  : active
                    ? RESULT_COLORS[f]
                    : 'bg-zinc-100 text-zinc-600';
                return (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`text-xs font-black px-3 py-1.5 rounded-full transition-colors ${color}`}
                  >
                    {f === 'all' ? 'הכל' : f} {count > 0 && <span className="opacity-70">({count})</span>}
                  </button>
                );
              })}
            </div>

            {/* Search */}
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="חיפוש לפי נושא..."
              className="w-full mb-4 px-4 py-2 text-sm border border-black/10 rounded-lg bg-gray-50 focus:outline-none focus:ring-1 focus:ring-black/20"
            />

            {/* Vote list */}
            <div className="flex flex-col gap-1.5">
              {pageVotes.length === 0 ? (
                <div className="py-16 text-center text-gray-400 font-black">אין תוצאות</div>
              ) : pageVotes.map(v => (
                <div
                  key={v.Id}
                  className="flex items-start gap-3 py-3 px-4 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  <span className={`shrink-0 mt-0.5 text-[11px] font-black px-2 py-1 rounded-full ${RESULT_COLORS[v.ResultDesc] ?? 'bg-zinc-100 text-zinc-500'}`}>
                    {v.ResultDesc}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold leading-snug text-gray-900">
                      <Link
                        href={`/vote/${v.VoteID}`}
                        prefetch={false}
                        className="hover:underline"
                      >
                        {v.Vote?.VoteTitle || '—'}
                      </Link>
                    </p>
                    {v.Vote?.VoteSubject && v.Vote.VoteSubject !== v.Vote.VoteTitle && (
                      <p className="text-xs text-gray-500 mt-0.5 leading-snug">{v.Vote.VoteSubject}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-[11px] text-gray-500 font-medium tabular-nums">
                    {new Date(v.VoteDate).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-8">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="text-sm font-black px-3 py-1.5 rounded border border-black/10 disabled:opacity-30 hover:bg-gray-50 transition-colors"
                >
                  הקודם
                </button>
                <span className="text-sm font-black text-gray-500">
                  {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="text-sm font-black px-3 py-1.5 rounded border border-black/10 disabled:opacity-30 hover:bg-gray-50 transition-colors"
                >
                  הבא
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
