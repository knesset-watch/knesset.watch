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
  init_date: string | null;
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
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <nav className="flex items-center gap-1 text-sm text-gray-400 mb-6">
          <Link href="/" className="font-black hover:text-black transition-colors">ראשי</Link>
          <span className="mx-1">›</span>
          <span className="text-black font-black">חוקים</span>
        </nav>

        <h1 className="text-4xl font-black mb-1">חוקים</h1>
        <p className="text-sm text-gray-500 mb-6">כל הצעות החוק של הכנסת ה-25</p>

        {/* Filters */}
        <div className="flex flex-col gap-3 mb-6">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש לפי כותרת, נושא..."
            className="w-full text-sm px-4 py-2.5 rounded-full border border-black/10 bg-gray-50 focus:outline-none focus:border-black/30"
            dir="rtl"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setPassedOnly(!passedOnly)}
              className={`text-xs font-black px-3 py-1.5 rounded-full transition-colors ${passedOnly ? 'bg-black text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              עברו בלבד
            </button>
            <div className="flex items-center gap-1 border border-black/10 rounded-xl p-0.5 mr-auto">
              <button onClick={() => setView('list')} title="רשימה"
                className={`p-1.5 rounded-lg transition-colors ${view === 'list' ? 'bg-black text-white' : 'text-gray-400 hover:text-black'}`}>
                <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                  <rect x="1" y="2" width="14" height="2" rx="1"/><rect x="1" y="7" width="14" height="2" rx="1"/><rect x="1" y="12" width="14" height="2" rx="1"/>
                </svg>
              </button>
              <button onClick={() => setView('cards')} title="כרטיסים"
                className={`p-1.5 rounded-lg transition-colors ${view === 'cards' ? 'bg-black text-white' : 'text-gray-400 hover:text-black'}`}>
                <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                  <rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/>
                  <rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Count */}
        <div className="text-xs text-gray-500 font-medium mb-3">
          {total.toLocaleString()} הצ&quot;ח {page > 0 || bills.length < total ? `· עמוד ${page + 1} מתוך ${totalPages}` : ''}
        </div>

        {/* Bills list */}
        <div className={`transition-opacity ${loading ? 'opacity-40' : ''}`}>
          {view === 'list' && (
            <div className="flex flex-col gap-1.5">
              {bills.map(b => {
                const isExpanded = expandedBills.has(b.id);
                return (
                  <div key={b.id} className="rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors">
                    <div className="flex items-start justify-between gap-2 px-4 pt-3 pb-1">
                      <Link href={`/bill/${b.id}`} className="text-sm font-bold leading-snug text-gray-900 hover:text-teal-700 transition-colors">{b.title}</Link>
                      <div className="flex items-center gap-1 shrink-0">
                        {b.doc_url && (
                          <a href={b.doc_url} target="_blank" rel="noopener noreferrer"
                            className="text-[11px] font-black text-gray-400 hover:text-black border border-gray-200 hover:border-gray-400 px-1.5 py-0.5 rounded transition-colors">
                            PDF
                          </a>
                        )}
                        {b.summary && (
                          <button onClick={() => toggleBill(b.id)}
                            className="text-[11px] font-black text-gray-400 hover:text-black border border-gray-200 hover:border-gray-400 px-1.5 py-0.5 rounded transition-colors">
                            {isExpanded ? '▲' : '▼'}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 px-4 pb-3 flex-wrap">
                      <span className={`text-[11px] font-black px-2 py-0.5 rounded-full ${b.is_passed ? 'bg-[#16A34A] text-white' : 'bg-gray-200 text-gray-500'}`}>
                        {b.is_passed ? 'עבר' : (b.status_desc ?? 'בתהליך')}
                      </span>
                      {b.init_date && <span className="text-[11px] text-gray-500">{b.init_date}</span>}
                      {b.initiators?.map(i => (
                        <EntityTooltip key={i.person_id} href={`/mk/${i.slug ?? i.person_id}`} type="mk" id={i.slug ?? i.person_id}
                          className="text-[11px] font-bold text-teal-700 hover:underline">
                          {i.first_name} {i.last_name}
                        </EntityTooltip>
                      ))}
                      {b.macro_agenda && <span className="text-[11px] font-black text-white bg-black px-1.5 py-0.5 rounded-full">{b.macro_agenda}</span>}
                      {b.committee_name && (
                        <EntityTooltip href={`/committee/${encodeURIComponent(b.committee_name)}`} type="committee" id={b.committee_name}
                          className="text-[11px] font-black text-gray-400 border border-gray-200 hover:border-gray-400 px-1.5 py-0.5 rounded-full transition-colors">
                          {b.committee_name}
                        </EntityTooltip>
                      )}
                      {b.subtype && <span className="text-[11px] text-gray-500">{b.subtype}</span>}
                    </div>
                    {b.summary && isExpanded && (
                      <div className="px-4 pb-3 border-t border-black/5 pt-2">
                        <p className="text-xs text-gray-600 leading-relaxed">{b.summary}</p>
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
                <Link key={b.id} href={`/bill/${b.id}`} className="rounded-2xl border border-black/8 p-4 hover:border-black/20 hover:bg-gray-50 transition-colors flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className={`shrink-0 text-[11px] font-black px-2 py-0.5 rounded-full ${b.is_passed ? 'bg-[#16A34A] text-white' : 'bg-gray-100 text-gray-500'}`}>
                      {b.is_passed ? 'עבר' : (b.status_desc ?? 'בתהליך')}
                    </span>
                    {b.doc_url && (
                      <a href={b.doc_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                        className="text-[11px] font-black text-gray-400 hover:text-black border border-gray-200 hover:border-gray-400 px-1.5 py-0.5 rounded transition-colors">
                        PDF
                      </a>
                    )}
                  </div>
                  <p className="text-sm font-bold leading-snug text-gray-900 line-clamp-3">{b.title}</p>
                  {b.summary && <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-2">{b.summary}</p>}
                  <div className="flex items-center gap-1.5 flex-wrap mt-auto pt-1">
                    {b.init_date && <span className="text-[11px] text-gray-500">{b.init_date}</span>}
                    {b.macro_agenda && <span className="text-[11px] font-black text-white bg-black px-1.5 py-0.5 rounded-full">{b.macro_agenda}</span>}
                    {b.committee_name && <span className="text-[11px] text-gray-500 border border-gray-200 px-1.5 py-0.5 rounded-full">{b.committee_name}</span>}
                    {b.initiators?.slice(0, 2).map(i => (
                      <span key={i.person_id} className="text-[11px] font-bold text-teal-700">{i.first_name} {i.last_name}</span>
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
              className="text-sm font-black px-4 py-2 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-30 transition-colors"
            >
              הקודם
            </button>
            <span className="text-sm text-gray-500">{page + 1} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="text-sm font-black px-4 py-2 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-30 transition-colors"
            >
              הבא
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
