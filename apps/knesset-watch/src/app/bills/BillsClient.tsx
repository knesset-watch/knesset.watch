'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { usePeriod, periodToDateRange } from '@/lib/period-context';
import EntityTooltip from '@/components/EntityTooltip';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const PAGE_SIZE = 50;

interface Bill {
  id: number;
  title: string;
  subtype: string;
  is_passed: number;
  status_desc: string | null;
  committee_name: string | null;
  summary: string | null;
  doc_url: string | null;
  micro_agenda: string | null;
  macro_agenda: string | null;
  /** התקציר מ-bill_policy_analysis — bill.summary ריק ב-100% מהשורות */
  analysisSummary: string | null;
  init_date: string | null;
  publication_date: string | null;
  initiators: Array<{ person_id: number; first_name: string; last_name: string; slug: string | null }>;
}

type ViewMode = 'list' | 'cards';

export default function BillsClient() {
  const { period } = usePeriod();
  const [bills, setBills] = useState<Bill[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [passedOnly, setPassedOnly] = useState(false);
  const [view, setView] = useState<ViewMode>('list');
  const [expandedBills, setExpandedBills] = useState<Set<number>>(new Set());
  const didMount = useRef(false);

  // Persist view mode
  useEffect(() => {
    const saved = localStorage.getItem('kw-view-bills') as ViewMode | null;
    if (saved === 'list' || saved === 'cards') setView(saved);
    didMount.current = true;
  }, []);
  useEffect(() => {
    if (didMount.current) localStorage.setItem('kw-view-bills', view);
  }, [view]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [debouncedSearch, passedOnly, period]);

  const fetchBills = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    });
    if (passedOnly) params.set('passedOnly', 'true');
    if (debouncedSearch) params.set('q', debouncedSearch);
    const dateRange = periodToDateRange(period);
    if (dateRange) { params.set('from', dateRange.from); params.set('to', dateRange.to); }

    try {
      const res = await fetch(`${BASE_PATH}/api/bills?${params}`);
      const data = await res.json() as { bills?: Bill[]; total?: number };
      setBills(data.bills ?? []);
      setTotal(data.total ?? 0);
    } catch { /* ignore */ }
    setLoading(false);
  }, [page, passedOnly, debouncedSearch, period]);

  useEffect(() => { fetchBills(); }, [fetchBills]);

  const toggleBill = (id: number) => setExpandedBills(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="min-h-screen bg-paper" dir="rtl">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <nav className="flex items-center gap-1 text-ui text-mute mb-6">
          <Link href="/" className="font-medium hover:text-ink transition-colors">ראשי</Link>
          <span className="mx-1">›</span>
          <span className="text-ink font-medium">חוקים</span>
        </nav>

        <h1 className="text-4xl font-medium mb-1">חוקים</h1>
        <p className="text-ui text-mute mb-6">כל הצעות החוק של הכנסת ה-25</p>

        {/* Filters */}
        <div className="flex flex-col gap-3 mb-6">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש לפי כותרת, נושא..."
            className="w-full text-ui px-4 py-2.5 rounded-full border border-line bg-line focus:border-mute"
            dir="rtl"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setPassedOnly(!passedOnly)}
              className={`text-meta font-medium px-4 py-2.5 rounded-full transition-colors ${passedOnly ? 'bg-navy-deep text-white' : 'bg-line text-ink-2 hover:bg-line'}`}
            >
              עברו בלבד
            </button>
            <div className="hidden sm:flex items-center gap-1 border border-line rounded-card p-0.5 mr-auto">
              <button onClick={() => setView('list')} title="רשימה"
                className={`p-2 rounded-control transition-colors ${view === 'list' ? 'bg-navy-deep text-white' : 'text-mute hover:text-ink'}`}>
                <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor">
                  <rect x="1" y="2" width="14" height="2" rx="1"/><rect x="1" y="7" width="14" height="2" rx="1"/><rect x="1" y="12" width="14" height="2" rx="1"/>
                </svg>
              </button>
              <button onClick={() => setView('cards')} title="כרטיסים"
                className={`p-2 rounded-control transition-colors ${view === 'cards' ? 'bg-navy-deep text-white' : 'text-mute hover:text-ink'}`}>
                <svg viewBox="0 0 16 16" className="w-4 h-4" fill="currentColor">
                  <rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/>
                  <rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Count */}
        <div className="text-meta text-mute font-medium mb-3">
          {total.toLocaleString()} הצ&quot;ח {page > 0 || bills.length < total ? `· עמוד ${page + 1} מתוך ${totalPages}` : ''}
        </div>

        {/* Bills list */}
        <div className={`transition-opacity ${loading ? 'opacity-40' : ''}`}>
          {view === 'list' && (
            <div className="flex flex-col gap-1.5">
              {bills.map(b => {
                const isExpanded = expandedBills.has(b.id);
                return (
                  <div key={b.id} className="rounded-card bg-surface hover:bg-surface-2 transition-colors">
                    <div className="flex items-start justify-between gap-2 px-4 pt-3 pb-1">
                      <Link href={`/bill/${b.id}`} className="text-ui font-bold leading-snug text-ink hover:text-accent transition-colors">{b.title}</Link>
                      <div className="flex items-center gap-1 shrink-0">
                        {b.analysisSummary && (
                          <button onClick={() => toggleBill(b.id)}
                            className="text-meta font-medium text-mute hover:text-ink border border-line hover:border-mute px-2 py-1 rounded transition-colors">
                            {isExpanded ? '▲' : '▼'}
                          </button>
                        )}
                      </div>
                    </div>
                    {b.analysisSummary && !isExpanded && (
                      <p className="px-4 pb-2 text-meta text-mute font-content line-clamp-2">
                        {b.analysisSummary}
                      </p>
                    )}

                    <div className="flex items-center gap-2 px-4 pb-3 flex-wrap">
                      <span className={`text-meta font-medium px-2 py-0.5 rounded-full ${b.is_passed ? 'bg-pass text-white' : 'bg-warn-wash text-warn'}`}>
                        {b.is_passed ? 'עבר' : (b.status_desc ?? 'בתהליך')}
                      </span>
                      {b.publication_date && <span className="text-meta text-mute">{b.publication_date.slice(0, 10)}</span>}
                      {b.initiators?.map(i => (
                        <EntityTooltip key={i.person_id} href={`/mk/${i.slug ?? i.person_id}`} type="mk" id={i.slug ?? i.person_id}
                          className="text-meta font-bold text-accent hover:underline">
                          {i.first_name} {i.last_name}
                        </EntityTooltip>
                      ))}
                      {b.macro_agenda && <span className="text-meta font-medium text-white bg-navy-deep px-1.5 py-0.5 rounded-full">{b.macro_agenda}</span>}
                      {b.committee_name && (
                        <EntityTooltip href={`/committee/${encodeURIComponent(b.committee_name)}`} type="committee" id={b.committee_name}
                          className="text-meta font-medium text-mute border border-line hover:border-mute px-1.5 py-0.5 rounded-full transition-colors">
                          {b.committee_name}
                        </EntityTooltip>
                      )}
                      {b.subtype && <span className="text-meta text-mute">{b.subtype}</span>}
                    </div>
                    {b.analysisSummary && isExpanded && (
                      <div className="px-4 pb-3 border-t border-line-soft pt-2">
                        <p className="text-meta text-ink-2 leading-relaxed">{b.analysisSummary}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {view === 'cards' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {bills.map(b => (
                <Link key={b.id} href={`/bill/${b.id}`} className="rounded-card border border-line p-4 hover:border-line hover:bg-surface-2 transition-colors flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className={`shrink-0 text-meta font-medium px-2 py-0.5 rounded-full ${b.is_passed ? 'bg-pass text-white' : 'bg-warn-wash text-warn'}`}>
                      {b.is_passed ? 'עבר' : (b.status_desc ?? 'בתהליך')}
                    </span>
                  </div>
                  <p className="text-ui font-bold leading-snug text-ink line-clamp-3">{b.title}</p>
                  {b.analysisSummary && <p className="text-meta text-mute leading-relaxed line-clamp-2">{b.analysisSummary}</p>}
                  <div className="flex items-center gap-1.5 flex-wrap mt-auto pt-1">
                    {b.publication_date && <span className="text-meta text-mute">{b.publication_date.slice(0, 10)}</span>}
                    {b.macro_agenda && <span className="text-meta font-medium text-white bg-navy-deep px-1.5 py-0.5 rounded-full">{b.macro_agenda}</span>}
                    {b.committee_name && <span className="text-meta text-mute border border-line px-1.5 py-0.5 rounded-full">{b.committee_name}</span>}
                    {b.initiators?.slice(0, 2).map(i => (
                      <span key={i.person_id} className="text-meta font-bold text-accent">{i.first_name} {i.last_name}</span>
                    ))}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-8">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="text-ui font-medium px-4 py-2 rounded-full bg-line text-ink-2 hover:bg-line disabled:opacity-30 transition-colors"
            >
              הקודם
            </button>
            <span className="text-ui text-mute">{page + 1} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="text-ui font-medium px-4 py-2 rounded-full bg-line text-ink-2 hover:bg-line disabled:opacity-30 transition-colors"
            >
              הבא
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
