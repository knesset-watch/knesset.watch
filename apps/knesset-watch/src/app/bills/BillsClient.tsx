'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePeriod } from '@/lib/period-context';
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

export default function BillsClient() {
  const { period } = usePeriod();
  const [bills, setBills] = useState<Bill[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [passedOnly, setPassedOnly] = useState(false);
  const [expandedBills, setExpandedBills] = useState<Set<number>>(new Set());

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
    if (period !== 'all') params.set('year', period);

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
          </div>
        </div>

        {/* Count */}
        <div className="text-xs text-gray-400 font-medium mb-3">
          {total.toLocaleString()} הצ&quot;ח {page > 0 || bills.length < total ? `· עמוד ${page + 1} מתוך ${totalPages}` : ''}
        </div>

        {/* Bills list */}
        <div className={`flex flex-col gap-1.5 transition-opacity ${loading ? 'opacity-40' : ''}`}>
          {bills.map(b => {
            const isExpanded = expandedBills.has(b.id);
            return (
              <div key={b.id} className="rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors">
                <div className="flex items-start gap-3 px-4 py-3">
                  <span className={`shrink-0 mt-0.5 text-[10px] font-black px-2 py-0.5 rounded-full ${b.is_passed ? 'bg-[#16A34A] text-white' : 'bg-gray-200 text-gray-500'}`}>
                    {b.is_passed ? 'עבר' : 'הוגש'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/bill/${b.id}`} className="text-sm font-bold leading-snug text-gray-900 hover:text-teal-700 transition-colors">{b.title}</Link>
                      <div className="flex items-center gap-1 shrink-0">
                        {b.doc_url && (
                          <a href={b.doc_url} target="_blank" rel="noopener noreferrer"
                            className="text-[10px] font-black text-gray-400 hover:text-black border border-gray-200 hover:border-gray-400 px-1.5 py-0.5 rounded transition-colors">
                            PDF
                          </a>
                        )}
                        {b.summary && (
                          <button onClick={() => toggleBill(b.id)}
                            className="text-[10px] font-black text-gray-400 hover:text-black border border-gray-200 hover:border-gray-400 px-1.5 py-0.5 rounded transition-colors">
                            {isExpanded ? '▲' : '▼'}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {b.init_date && <span className="text-[10px] text-gray-400">{b.init_date}</span>}
                      {b.initiators?.map(i => (
                        <EntityTooltip key={i.person_id} href={`/mk/${i.slug ?? i.person_id}`} type="mk" id={i.slug ?? i.person_id}
                          className="text-[10px] font-bold text-teal-700 hover:underline">
                          {i.first_name} {i.last_name}
                        </EntityTooltip>
                      ))}
                      {b.macro_agenda && <span className="text-[10px] font-black text-white bg-black px-1.5 py-0.5 rounded-full">{b.macro_agenda}</span>}
                      {b.committee_name && (
                        <EntityTooltip href={`/committee/${encodeURIComponent(b.committee_name)}`} type="committee" id={b.committee_name}
                          className="text-[10px] font-black text-gray-400 border border-gray-200 hover:border-gray-400 px-1.5 py-0.5 rounded-full transition-colors">
                          {b.committee_name}
                        </EntityTooltip>
                      )}
                      {b.subtype && <span className="text-[10px] text-gray-400">{b.subtype}</span>}
                    </div>
                  </div>
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
