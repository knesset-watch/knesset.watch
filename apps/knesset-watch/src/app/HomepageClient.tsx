'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePeriod, periodToDateRange } from '@/lib/period-context';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Stats {
  mks: number;
  committees: number;
  sessions: number;
  billsPassed: number;
  billsTotal: number;
  votes: number;
}

function relativeDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'היום';
  if (diffDays === 1) return 'אתמול';
  if (diffDays < 7) return `לפני ${diffDays} ימים`;
  if (diffDays < 30) return `לפני ${Math.floor(diffDays / 7)} שבועות`;
  if (diffDays < 365) return `לפני ${Math.floor(diffDays / 30)} חודשים`;
  return `לפני ${Math.floor(diffDays / 365)} שנים`;
}

interface RecentBill {
  id: number;
  title: string;
  date: string | null;
  macroAgenda: string | null;
}

const SECTIONS = [
  { label: 'ח"כים', sublabel: 'חברי הכנסת ה-25', href: '/mks', icon: '👤' },
  { label: 'ועדות', sublabel: 'דיונים ופרוטוקולים', href: '/committees', icon: '🏛' },
  { label: 'חוקים', sublabel: 'הצעות חוק ומעקב', href: '/bills', icon: '📋' },
  { label: 'פרוטוקולים', sublabel: 'חיפוש בתוך הדיונים', href: '/protocols', icon: '🔍' },
  { label: 'שרים', sublabel: 'חברי הממשלה', href: '/ministers', icon: '⭐' },
  { label: 'הצבעות', sublabel: 'הצבעות מליאה', href: '/votes', icon: '🗳' },
];

export default function HomepageClient() {
  const [query, setQuery] = useState('');
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentBills, setRecentBills] = useState<RecentBill[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { period } = usePeriod();

  const fetchData = useCallback(async () => {
    const dateRange = periodToDateRange(period);
    const params = new URLSearchParams();
    if (dateRange) { params.set('from', dateRange.from); params.set('to', dateRange.to); }
    const qs = params.toString() ? `?${params}` : '';
    fetch(`${BASE_PATH}/api/homepage-stats${qs}`).then(r => r.json()).then(setStats).catch(() => {});
    fetch(`${BASE_PATH}/api/pulse${qs}`).then(r => r.json()).then(d => setRecentBills(d.bills?.slice(0, 6) ?? [])).catch(() => {});
  }, [period]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.length >= 2) router.push(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      {/* Hero */}
      <div className="max-w-3xl mx-auto px-6 pt-20 pb-14 text-center">
        <h1 className="text-5xl font-black tracking-tighter mb-3">כנסת ווטש</h1>
        <p className="text-base text-gray-500 mb-10 leading-relaxed">
          שקיפות נתוני הכנסת ה-25 בזמן אמת — הצבעות, פרוטוקולים, חוקים, ח&quot;כים וועדות במקום אחד.
        </p>

        {/* Search */}
        <form onSubmit={handleSearch} className="flex items-center gap-2 max-w-xl mx-auto">
          <div className="flex-1 flex items-center border border-black/20 rounded-xl px-4 py-3 bg-gray-50 focus-within:border-black/50 focus-within:bg-white transition-colors">
            <svg className="w-4 h-4 text-gray-400 shrink-0 ml-2" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="6.5" cy="6.5" r="4.5"/><path d="m10 10 4 4"/>
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="חפשו ח&quot;כ, ועדה, חוק..."
              className="flex-1 bg-transparent text-sm font-black outline-none placeholder:text-gray-400 placeholder:font-normal"
              dir="rtl"
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={query.trim().length < 2}
            className="px-5 py-3 rounded-xl bg-black text-white text-sm font-black disabled:opacity-30 hover:bg-gray-800 transition-colors shrink-0"
          >
            חיפוש
          </button>
        </form>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="max-w-3xl mx-auto px-6 mb-14">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Link href="/mks"
              className="rounded-2xl border border-black/8 p-5 hover:border-black/20 hover:bg-gray-50 transition-colors text-center">
              <div className="text-3xl font-black">{stats.mks}</div>
              <div className="text-[11px] text-gray-400 font-black uppercase tracking-wide mt-1">ח&quot;כים</div>
            </Link>
            <Link href="/committees"
              className="rounded-2xl border border-black/8 p-5 hover:border-black/20 hover:bg-gray-50 transition-colors text-center">
              <div className="text-3xl font-black">{stats.committees}</div>
              <div className="text-[11px] text-gray-400 font-black uppercase tracking-wide mt-1">ועדות</div>
              <div className="text-[10px] text-gray-300 mt-0.5">{stats.sessions.toLocaleString()} ישיבות</div>
            </Link>
            <Link href="/bills?passedOnly=true"
              className="rounded-2xl border border-black/8 p-5 hover:border-black/20 hover:bg-gray-50 transition-colors text-center">
              <div className="text-3xl font-black text-teal-700">{stats.billsPassed.toLocaleString()}</div>
              <div className="text-[11px] text-gray-400 font-black uppercase tracking-wide mt-1">חוקים עברו</div>
              {stats.billsTotal > 0 && (
                <div className="text-[10px] text-gray-300 mt-0.5">מתוך {stats.billsTotal.toLocaleString()} הצ&quot;ח</div>
              )}
            </Link>
            <Link href="/votes"
              className="rounded-2xl border border-black/8 p-5 hover:border-black/20 hover:bg-gray-50 transition-colors text-center">
              <div className="text-3xl font-black">{stats.votes?.toLocaleString() ?? '—'}</div>
              <div className="text-[11px] text-gray-400 font-black uppercase tracking-wide mt-1">הצבעות מליאה</div>
            </Link>
          </div>
        </div>
      )}

      {/* Section cards */}
      <div className="max-w-3xl mx-auto px-6 mb-14">
        <div className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-4">מקטעים</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {SECTIONS.map(s => (
            <Link key={s.href} href={s.href}
              className="rounded-2xl border border-black/8 p-5 hover:border-black/20 hover:bg-gray-50 transition-colors group">
              <div className="text-2xl mb-2">{s.icon}</div>
              <div className="text-base font-black group-hover:text-teal-700 transition-colors">{s.label}</div>
              <div className="text-xs text-gray-400 mt-0.5">{s.sublabel}</div>
            </Link>
          ))}
        </div>
      </div>

      {/* Recently passed laws */}
      {recentBills.length > 0 && (
        <div className="max-w-3xl mx-auto px-6 pb-20">
          <div className="flex items-center justify-between mb-4">
            <div className="text-[11px] font-black text-gray-400 uppercase tracking-widest">חוקים שעברו לאחרונה</div>
            <Link href="/bills?passedOnly=true" className="text-[11px] font-black text-teal-700 hover:underline">כל החוקים ←</Link>
          </div>
          <div className="flex flex-col gap-1.5">
            {recentBills.map(b => (
              <Link key={b.id} href={`/bill/${b.id}`}
                className="flex items-start gap-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors px-4 py-3">
                <span className="shrink-0 text-[10px] font-black bg-teal-500 text-white px-2 py-0.5 rounded-full mt-0.5">עבר</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-gray-900 leading-snug line-clamp-2">{b.title}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {b.date && <span className="text-[10px] text-gray-400">{relativeDate(b.date)}</span>}
                    {b.macroAgenda && <span className="text-[10px] font-black text-white bg-black px-1.5 py-0.5 rounded-full">{b.macroAgenda}</span>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
