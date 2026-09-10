'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { usePeriod, periodToDateRange } from '@/lib/period-context';
import FilterChips from '@/components/FilterChips';

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
  /** הצעת החוק שההצבעה נערכה עליה — קיימת ב-67% מההצבעות */
  billId: number | null;
  billSummary: string | null;
}

function formatDate(iso: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
}

type ViewMode = 'list' | 'cards';

export default function VotesClient() {
  const { period } = usePeriod();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [votes, setVotes] = useState<VoteRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<ViewMode>('list');
  const didMount = useRef(false);

  // Persist view mode; force cards on mobile
  useEffect(() => {
    const saved = localStorage.getItem('kw-view-votes') as ViewMode | null;
    if (saved === 'list' || saved === 'cards') setView(saved);
    if (window.innerWidth < 640) setView('cards');
    didMount.current = true;
  }, []);
  useEffect(() => {
    if (didMount.current) localStorage.setItem('kw-view-votes', view);
  }, [view]);

  // Filters (init from URL)
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [submittedSearch, setSubmittedSearch] = useState(searchParams.get('q') || '');
  const [passedOnly, setPassedOnly] = useState(searchParams.get('passed') === '1');
  const [failedOnly, setFailedOnly] = useState(searchParams.get('failed') === '1');
  const [maxMargin, setMaxMargin] = useState(searchParams.get('maxMargin') || '');

  // Sync filters to URL (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (submittedSearch) params.set('q', submittedSearch);
      if (passedOnly) params.set('passed', '1');
      if (failedOnly) params.set('failed', '1');
      if (maxMargin) params.set('maxMargin', maxMargin);
      const newUrl = params.toString() ? `?${params.toString()}` : '/votes';
      window.history.replaceState({}, '', newUrl);
    }, 300);
    return () => clearTimeout(timer);
  }, [submittedSearch, passedOnly, failedOnly, maxMargin]);

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
        <nav className="flex items-center gap-1 text-sm text-mute mb-6">
          <Link href="/" className="font-medium hover:text-black transition-colors">ראשי</Link>
          <span className="mx-1">›</span>
          <span className="text-black font-medium">הצבעות</span>
        </nav>

        <h1 className="text-4xl font-medium mb-1">הצבעות</h1>
        <p className="text-sm text-mute mb-6">הצבעות מליאה בכנסת ה-25</p>

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
                className="flex-1 bg-transparent text-sm font-medium placeholder:text-mute placeholder:font-normal"
                dir="rtl"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2.5 rounded-xl bg-black text-white text-sm font-medium hover:bg-gray-800 transition-colors shrink-0"
            >
              חיפוש
            </button>
          </form>

          {/* Passed/Failed toggles */}
          <div className="flex gap-1">
            <button
              onClick={handlePassedToggle}
              className={`text-xs font-medium px-3 py-2.5 rounded-xl transition-colors ${passedOnly ? 'bg-accent text-white' : 'bg-gray-100 text-ink-2 hover:bg-gray-200'}`}
            >
              עברו
            </button>
            <button
              onClick={handleFailedToggle}
              className={`text-xs font-medium px-3 py-2.5 rounded-xl transition-colors ${failedOnly ? 'bg-red-500 text-white' : 'bg-gray-100 text-ink-2 hover:bg-gray-200'}`}
            >
              לא עברו
            </button>
          </div>

          {/* Max margin filter */}
          <div className="flex items-center gap-2">
            <span className="text-meta font-medium text-mute shrink-0">הפרש מקסימלי:</span>
            <select
              value={maxMargin}
              onChange={e => handleMarginChange(e.target.value)}
              className="text-xs font-medium px-2 py-2 rounded-xl bg-gray-100 border-0 cursor-pointer hover:bg-gray-200 transition-colors"
            >
              <option value="">כל הפרש</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="5">5</option>
              <option value="10">10</option>
            </select>
          </div>

          {/* View toggle — hidden on mobile (cards always shown on small screens) */}
          <div className="hidden sm:flex items-center gap-1 border border-black/10 rounded-xl p-0.5 mr-auto">
            <button onClick={() => setView('list')} title="רשימה"
              className={`p-2 rounded-lg transition-colors ${view === 'list' ? 'bg-black text-white' : 'text-mute hover:text-black'}`}>
              <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor">
                <rect x="1" y="2" width="14" height="2" rx="1"/><rect x="1" y="7" width="14" height="2" rx="1"/><rect x="1" y="12" width="14" height="2" rx="1"/>
              </svg>
            </button>
            <button onClick={() => setView('cards')} title="כרטיסים"
              className={`p-2 rounded-lg transition-colors ${view === 'cards' ? 'bg-black text-white' : 'text-mute hover:text-black'}`}>
              <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor">
                <rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/>
                <rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/>
              </svg>
            </button>
          </div>
        </div>


        {/* ── Active Filters Display ── */}
        {(() => {
          const filterChips = [];
          if (submittedSearch.trim()) {
            filterChips.push({
              label: `חיפוש: "${submittedSearch}"`,
              onRemove: () => { setSubmittedSearch(''); setSearch(''); }
            });
          }
          if (passedOnly) {
            filterChips.push({
              label: 'הצבעות שעברו',
              onRemove: () => setPassedOnly(false)
            });
          }
          if (failedOnly) {
            filterChips.push({
              label: 'הצבעות שלא עברו',
              onRemove: () => setFailedOnly(false)
            });
          }
          if (maxMargin) {
            filterChips.push({
              label: `הפרש ≤ ${maxMargin}`,
              onRemove: () => handleMarginChange('')
            });
          }
          return filterChips.length > 0 ? (
            <FilterChips
              chips={filterChips}
              onClearAll={() => {
                setSubmittedSearch('');
                setSearch('');
                setPassedOnly(false);
                setFailedOnly(false);
                handleMarginChange('');
              }}
            />
          ) : null;
        })()}
        {/* Total count */}
        {!loading && (
          <div className="text-meta text-mute font-medium mb-3">
            {total.toLocaleString()} הצבעות
          </div>
        )}

        {loading && (
          <div className="py-16 text-center text-mute font-medium animate-pulse">טוען...</div>
        )}

        {!loading && votes.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-mute font-medium mb-4">לא נמצאו הצבעות עם הפילטרים הנוכחיים</p>
            {(submittedSearch || passedOnly || failedOnly || maxMargin) && (
              <button
                onClick={() => {
                  setSearch('');
                  setSubmittedSearch('');
                  setPassedOnly(false);
                  setFailedOnly(false);
                  handleMarginChange('');
                }}
                className="text-sm font-medium text-accent hover:text-accent underline"
              >
                הנקה את כל הפילטרים
              </button>
            )}
          </div>
        )}

        {/* List view — desktop only (hidden on mobile) */}
        {!loading && view === 'list' && (
          <div className="hidden sm:block">
            <div className="grid grid-cols-[1fr_5rem_4rem_4rem_4rem_4.5rem] gap-4 py-3 px-4 text-meta font-medium text-ink-2 mb-2 bg-gray-100 rounded-lg border-b-2 border-gray-300">
              <span>נושא</span>
              <span>תאריך</span>
              <span className="text-center">בעד</span>
              <span className="text-center">נגד</span>
              <span className="text-center">הפרש</span>
              <span className="text-center">סטטוס</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {votes.map(v => (
                /*
                  קודם כל השורה — כותרת, תאריכים ומספרים — הייתה קישור אחד
                  ענק להצבעה. עכשיו יש שני יעדים אמיתיים (ההצבעה והצעת החוק),
                  ולכן שני קישורים נפרדים, וקורא מסך שומע כותרת ולא טור מספרים.
                */
                <div
                  key={v.voteId}
                  className="grid grid-cols-[1fr_5rem_4rem_4rem_4rem_4.5rem] gap-4 py-3 px-4 rounded-card items-center transition-colors bg-surface border border-line hover:border-accent"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/vote/${v.voteId}`}
                      title={v.title}
                      className="block text-ui font-medium text-ink line-clamp-2 leading-snug hover:text-accent transition-colors"
                    >
                      {v.title}
                    </Link>

                    {v.billSummary && (
                      <p className="text-meta text-mute mt-1 line-clamp-2 font-content">{v.billSummary}</p>
                    )}

                    <div className="flex gap-1.5 mt-1.5 flex-wrap items-center">
                      {v.billId && (
                        <Link
                          href={`/bill/${v.billId}`}
                          className="text-meta font-medium text-accent hover:underline"
                        >
                          להצעת החוק ←
                        </Link>
                      )}
                      {v.macroAgenda && (
                        <span className="text-meta text-mute bg-surface-2 px-1.5 py-0.5 rounded-control">{v.macroAgenda}</span>
                      )}
                      {v.microAgenda && (
                        <span className="text-meta font-medium text-accent-ink bg-accent-wash px-2 py-0.5 rounded-control">#{v.microAgenda}</span>
                      )}
                    </div>
                  </div>

                  <span className="text-meta text-mute shrink-0">{formatDate(v.date)}</span>
                  <span className="text-ui font-medium text-pass text-center" data-numeric>{v.totalFor}</span>
                  <span className="text-ui font-medium text-fail text-center" data-numeric>{v.totalAgainst}</span>
                  <span className="text-ui font-medium text-center" data-numeric>{v.margin}</span>
                  <span className={`text-meta font-medium px-2 py-1 rounded-control text-center justify-self-center ${v.isPassed ? 'bg-pass-wash text-pass' : 'bg-fail-wash text-fail'}`}>
                    {v.isPassed ? 'עבר' : 'לא עבר'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cards view — always on mobile, conditionally on desktop */}
        {!loading && (
          <div className={view === 'cards' ? 'block' : 'block sm:hidden'}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {votes.map(v => (
                <div
                  key={v.voteId}
                  className={`rounded-card border p-4 flex flex-col gap-2 transition-colors ${v.isPassed ? 'border-pass/30 bg-pass-wash' : 'border-line bg-surface hover:border-accent'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-meta font-medium px-2 py-0.5 rounded-control ${v.isPassed ? 'bg-pass text-white' : 'bg-fail text-white'}`}>
                      {v.isPassed ? 'עבר' : 'לא עבר'}
                    </span>
                    <span className="text-meta text-mute">{formatDate(v.date)}</span>
                  </div>

                  <Link
                    href={`/vote/${v.voteId}`}
                    title={v.title}
                    className="text-ui font-medium leading-snug text-ink line-clamp-3 hover:text-accent transition-colors"
                  >
                    {v.title}
                  </Link>

                  {v.billSummary && (
                    <p className="text-meta text-mute line-clamp-3 font-content">{v.billSummary}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {v.billId && (
                      <Link href={`/bill/${v.billId}`} className="text-meta font-medium text-accent hover:underline">
                        להצעת החוק ←
                      </Link>
                    )}
                    {v.macroAgenda && <span className="text-meta text-mute bg-surface-2 px-1.5 py-0.5 rounded-control">{v.macroAgenda}</span>}
                  </div>

                  <div className="flex items-center gap-4 mt-auto pt-1 text-meta">
                    <span className="font-medium text-pass" data-numeric>בעד {v.totalFor}</span>
                    <span className="font-medium text-fail" data-numeric>נגד {v.totalAgainst}</span>
                    <span className="text-mute" data-numeric>הפרש {v.margin}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-3 mt-10 items-center bg-accent-wash py-4 px-4 rounded-xl border border-line">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="text-sm font-medium px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent disabled:opacity-30 disabled:bg-gray-300 transition-colors"
            >
              ← הקודם
            </button>
            <div className="flex flex-col items-center gap-1">
              <span className="text-sm font-medium text-ink">
                עמוד {page} מתוך {totalPages}
              </span>
              <span className="text-meta text-mute">
                {total.toLocaleString()} הצבעות בסך הכל
              </span>
            </div>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="text-sm font-medium px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent disabled:opacity-30 disabled:bg-gray-300 transition-colors"
            >
              הבא →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
