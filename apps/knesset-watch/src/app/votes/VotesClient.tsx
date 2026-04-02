'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePeriod, periodToDateRange } from '@/lib/period-context';

interface VoteRow {
  voteId: number;
  title: string;
  date: string;
  totalFor: number;
  totalAgainst: number;
  totalAbstain: number;
  isPassed: boolean;
  margin: number;
  microAgenda: string | null;
  macroAgenda: string | null;
}

function formatDate(iso: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function VotesClient() {
  const { period } = usePeriod();
  const [votes, setVotes] = useState<VoteRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [passedOnly, setPassedOnly] = useState(false);
  const [failedOnly, setFailedOnly] = useState(false);
  const [maxMargin, setMaxMargin] = useState('');

  const fetchVotes = useCallback((p: number, q: string, passed: boolean, failed: boolean, margin: string, per: typeof period) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p) });
    if (q) params.set('q', q);
    if (passed) params.set('passed', '1');
    if (failed) params.set('failed', '1');
    if (margin) params.set('maxMargin', margin);
    const dateRange = periodToDateRange(per);
    if (dateRange) { params.set('from', dateRange.from); params.set('to', dateRange.to); }

    fetch(`/api/votes-list?${params}`)
      .then(r => r.json())
      .then((d: { votes?: VoteRow[]; total?: number }) => {
        setVotes(d.votes ?? []);
        setTotal(d.total ?? 0);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setPage(1);
  }, [period]);

  useEffect(() => {
    fetchVotes(page, submittedSearch, passedOnly, failedOnly, maxMargin, period);
  }, [page, submittedSearch, passedOnly, failedOnly, maxMargin, period, fetchVotes]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSubmittedSearch(search.trim());
  }

  function handlePassedToggle() {
    setPage(1);
    setPassedOnly(p => !p);
    if (!passedOnly) setFailedOnly(false);
  }

  function handleFailedToggle() {
    setPage(1);
    setFailedOnly(f => !f);
    if (!failedOnly) setPassedOnly(false);
  }

  function handleMarginChange(val: string) {
    setPage(1);
    setMaxMargin(val);
  }

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <nav className="flex items-center gap-1 text-sm text-gray-400 mb-6">
          <Link href="/" className="font-black hover:text-black transition-colors">ראשי</Link>
          <span className="mx-1">›</span>
          <span className="text-black font-black">הצבעות</span>
        </nav>

        <h1 className="text-4xl font-black mb-1">הצבעות</h1>
        <p className="text-sm text-gray-500 mb-6">הצבעות מליאה בכנסת ה-25</p>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6 items-end">
          {/* Search */}
          <form onSubmit={handleSearch} className="flex gap-2 flex-1 min-w-48">
            <div className="flex-1 flex items-center border border-black/20 rounded-xl px-3 py-2.5 bg-gray-50 focus-within:border-black/50 focus-within:bg-white transition-colors">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="חיפוש הצבעה..."
                className="flex-1 bg-transparent text-sm font-black outline-none placeholder:text-gray-400 placeholder:font-normal"
                dir="rtl"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2.5 rounded-xl bg-black text-white text-sm font-black hover:bg-gray-800 transition-colors shrink-0"
            >
              חיפוש
            </button>
          </form>

          {/* Passed/Failed toggles */}
          <div className="flex gap-1">
            <button
              onClick={handlePassedToggle}
              className={`text-xs font-black px-3 py-2.5 rounded-xl transition-colors ${passedOnly ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              עברו
            </button>
            <button
              onClick={handleFailedToggle}
              className={`text-xs font-black px-3 py-2.5 rounded-xl transition-colors ${failedOnly ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              לא עברו
            </button>
          </div>

          {/* Max margin filter */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase text-gray-400 shrink-0">הפרש מקסימלי:</span>
            <select
              value={maxMargin}
              onChange={e => handleMarginChange(e.target.value)}
              className="text-xs font-black px-2 py-2 rounded-xl bg-gray-100 border-0 outline-none cursor-pointer hover:bg-gray-200 transition-colors"
            >
              <option value="">כל הפרש</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="5">5</option>
              <option value="10">10</option>
            </select>
          </div>
        </div>

        {/* Total count */}
        {!loading && (
          <div className="text-[11px] text-gray-400 font-black uppercase mb-3">
            {total.toLocaleString()} הצבעות
          </div>
        )}

        {/* Table header */}
        <div className="grid grid-cols-[1fr_5rem_4rem_4rem_4rem_3rem] gap-4 py-2 px-4 text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">
          <span>נושא</span>
          <span>תאריך</span>
          <span className="text-center">בעד</span>
          <span className="text-center">נגד</span>
          <span className="text-center">הפרש</span>
          <span></span>
        </div>

        {loading && (
          <div className="py-16 text-center text-gray-400 font-black animate-pulse">טוען...</div>
        )}

        {!loading && votes.length === 0 && (
          <div className="py-16 text-center text-gray-400">לא נמצאו הצבעות</div>
        )}

        {!loading && (
          <div className="flex flex-col gap-1.5">
            {votes.map(v => (
              <Link
                key={v.voteId}
                href={`/vote/${v.voteId}`}
                className={`grid grid-cols-[1fr_5rem_4rem_4rem_4rem_3rem] gap-4 py-3 px-4 rounded-xl items-center transition-colors ${v.isPassed ? 'bg-[#F0FDF4] hover:bg-green-100' : 'bg-gray-50 hover:bg-gray-100'}`}
              >
                <div className="min-w-0">
                  <div className="text-sm font-black text-gray-900 line-clamp-2 leading-snug">{v.title}</div>
                  {(v.macroAgenda || v.microAgenda) && (
                    <div className="flex gap-1.5 mt-1 flex-wrap">
                      {v.macroAgenda && (
                        <span className="text-[9px] font-black text-gray-500 bg-gray-200/60 px-1.5 py-0.5 rounded-full">{v.macroAgenda}</span>
                      )}
                      {v.microAgenda && (
                        <span className="text-[9px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">#{v.microAgenda}</span>
                      )}
                    </div>
                  )}
                </div>
                <span className="text-[11px] text-gray-500 shrink-0">{formatDate(v.date)}</span>
                <span className="text-base font-black text-teal-700 text-center">{v.totalFor}</span>
                <span className="text-base font-black text-blue-700 text-center">{v.totalAgainst}</span>
                <span className="text-base font-black text-center">{v.margin}</span>
                <svg className="w-3.5 h-3.5 text-gray-300 shrink-0 justify-self-end rotate-180" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="m6 3 5 5-5 5"/>
                </svg>
              </Link>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-8">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="text-xs font-black px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 disabled:opacity-30 transition-colors"
            >
              הקודם
            </button>
            <span className="text-xs font-black px-3 py-2 text-gray-500">
              עמוד {page} מתוך {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="text-xs font-black px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 disabled:opacity-30 transition-colors"
            >
              הבא
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
