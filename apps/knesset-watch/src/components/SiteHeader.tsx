'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useRef, useCallback } from 'react';
import { usePeriod, PERIOD_SHORTCUTS, periodLabel } from '@/lib/period-context';

interface SearchHit {
  type: 'mk' | 'committee' | 'bill';
  id: string;
  title: string;
  subtitle: string | null;
  url: string;
}

const TYPE_LABEL: Record<string, string> = {
  mk: 'ח"כ',
  committee: 'ועדה',
  bill: 'חוק',
};

function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (query.length < 2) { setResults([]); setOpen(false); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) return;
        const data = await res.json() as { results: SearchHit[] };
        setResults(data.results ?? []);
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function navigate(url: string) {
    setOpen(false);
    setQuery('');
    router.push(url);
  }

  return (
    <div ref={containerRef} className="relative w-32 sm:w-48 md:w-64">
      <div className="flex items-center border border-black/15 rounded-lg px-2.5 py-1 bg-gray-50 focus-within:border-black/40 transition-colors">
        <svg className="w-3.5 h-3.5 text-gray-400 shrink-0 ml-1.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="6.5" cy="6.5" r="4.5"/>
          <path d="m10 10 4 4"/>
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') { setOpen(false); setQuery(''); }
            if (e.key === 'Enter' && query.trim().length >= 2) {
              setOpen(false);
              setQuery('');
              router.push(`/search?q=${encodeURIComponent(query.trim())}`);
            }
          }}
          placeholder="חיפוש..."
          className="flex-1 bg-transparent text-xs font-black outline-none placeholder:text-gray-400 placeholder:font-normal min-w-0"
          dir="rtl"
        />
        {loading && (
          <svg className="w-3 h-3 text-gray-400 animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full mt-1 right-0 w-72 bg-white border border-black/10 rounded-xl shadow-xl overflow-hidden z-50" dir="rtl">
          {results.slice(0, 8).map(hit => (
            <button
              key={`${hit.type}-${hit.id}`}
              onClick={() => navigate(hit.url)}
              className="w-full text-right flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors"
            >
              <span className="text-[11px] font-black uppercase tracking-widest text-gray-400 w-7 shrink-0 text-center">
                {TYPE_LABEL[hit.type] ?? hit.type}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-black truncate">{hit.title}</div>
                {hit.subtitle && <div className="text-[11px] text-gray-500 truncate">{hit.subtitle}</div>}
              </div>
            </button>
          ))}
          <button
            onClick={() => { setOpen(false); setQuery(''); router.push(`/search?q=${encodeURIComponent(query.trim())}`); }}
            className="w-full text-center px-3 py-2 border-t border-black/5 text-[11px] font-black text-teal-700 hover:bg-gray-50 transition-colors"
          >
            ראה את כל התוצאות ←
          </button>
        </div>
      )}
      {open && results.length === 0 && !loading && query.length >= 2 && (
        <div className="absolute top-full mt-1 right-0 w-64 bg-white border border-black/10 rounded-xl shadow-xl p-3 text-xs text-gray-500 text-center z-50">
          לא נמצאו תוצאות
        </div>
      )}
    </div>
  );
}

// ── Calendar helpers ──────────────────────────────────────────────────────────

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
// Sunday=0 in JS; Hebrew week starts Sunday
function firstWeekday(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}
function toDateStr(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
const HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const HE_DOW = ['א','ב','ג','ד','ה','ו','ש'];

function PeriodSelector() {
  const { period, setPeriod } = usePeriod();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const now = new Date();
  const [viewYear, setViewYear]   = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [hoverDate, setHoverDate]   = useState<string | null>(null);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setRangeStart(null);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  }

  function handleDayClick(dateStr: string) {
    if (!rangeStart) {
      setRangeStart(dateStr);
    } else {
      const [from, to] = rangeStart <= dateStr ? [rangeStart, dateStr] : [dateStr, rangeStart];
      setPeriod(`custom:${from}:${to}`);
      setRangeStart(null);
      setOpen(false);
    }
  }

  function inRange(dateStr: string) {
    if (!rangeStart) return false;
    const end = hoverDate ?? rangeStart;
    const [lo, hi] = rangeStart <= end ? [rangeStart, end] : [end, rangeStart];
    return dateStr >= lo && dateStr <= hi;
  }

  // Build calendar grid
  const firstDay = firstWeekday(viewYear, viewMonth);
  const totalDays = daysInMonth(viewYear, viewMonth);
  const cells: Array<number | null> = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const label = periodLabel(period);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => { setOpen(o => !o); setRangeStart(null); }}
        className="flex items-center gap-1 text-[11px] font-black px-3 py-2 rounded-lg border border-black/10 hover:border-black/25 bg-white transition-colors"
      >
        <span>{label}</span>
        <svg className={`w-2.5 h-2.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M1 1l4 4 4-4"/>
        </svg>
      </button>

      {open && (
        <div className="absolute top-full mt-1 right-0 bg-white border border-black/10 rounded-xl shadow-xl z-50 p-3 w-64" dir="rtl">
          {/* Shortcuts */}
          <div className="flex flex-wrap gap-1 mb-3">
            {PERIOD_SHORTCUTS.map(p => (
              <button
                key={p.value}
                onClick={() => { setPeriod(p.value); setOpen(false); setRangeStart(null); }}
                className={`text-[11px] font-black px-2 py-1.5 rounded-full transition-colors ${
                  period === p.value
                    ? 'bg-black text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="border-t border-black/5 mb-3"/>

          {/* Range picking hint */}
          {rangeStart ? (
            <p className="text-[11px] text-blue-600 mb-2 text-center">בחר תאריך סיום</p>
          ) : (
            <p className="text-[11px] text-gray-500 mb-2 text-center">בחר טווח תאריכים</p>
          )}

          {/* Month header */}
          <div className="flex items-center justify-between mb-2">
            <button onClick={nextMonth} className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500">
              <svg viewBox="0 0 6 10" className="w-2 h-3" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 1L1 5l4 4"/></svg>
            </button>
            <span className="text-[11px] font-black">{HE_MONTHS[viewMonth]} {viewYear}</span>
            <button onClick={prevMonth} className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500">
              <svg viewBox="0 0 6 10" className="w-2 h-3" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 1l4 4-4 4"/></svg>
            </button>
          </div>

          {/* Day of week header */}
          <div className="grid grid-cols-7 mb-1">
            {HE_DOW.map(d => (
              <div key={d} className="text-[11px] font-black text-gray-400 text-center py-0.5">{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((day, i) => {
              if (!day) return <div key={`e-${i}`}/>;
              const dateStr = toDateStr(viewYear, viewMonth, day);
              const isStart = dateStr === rangeStart;
              const inRng   = inRange(dateStr);
              const today   = toDateStr(now.getFullYear(), now.getMonth(), now.getDate());
              const isToday = dateStr === today;
              return (
                <button
                  key={day}
                  onClick={() => handleDayClick(dateStr)}
                  onMouseEnter={() => rangeStart && setHoverDate(dateStr)}
                  onMouseLeave={() => setHoverDate(null)}
                  className={`text-[11px] font-black h-8 w-full flex items-center justify-center rounded transition-colors
                    ${isStart ? 'bg-black text-white' : ''}
                    ${!isStart && inRng ? 'bg-blue-100 text-blue-800' : ''}
                    ${!isStart && !inRng ? 'hover:bg-gray-100 text-gray-700' : ''}
                    ${isToday && !isStart && !inRng ? 'font-black text-blue-600' : ''}
                  `}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const NAV_LINKS: Array<{ href: string; label: string; highlight?: boolean }> = [
  { href: '/mks', label: 'ח"כים' },
  { href: '/committees', label: 'ועדות' },
  { href: '/protocols', label: 'פרוטוקולים' },
  { href: '/bills', label: 'חוקים' },
  { href: '/ministers', label: 'שרים' },
  { href: '/votes', label: 'הצבעות' },
  { href: '/ask', label: 'שאל AI', highlight: true },
];

export default function SiteHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Close mobile menu on route change
  useEffect(() => {
    closeMenu();
  }, [pathname, closeMenu]);

  if (pathname === '/login') return null;

  return (
    <header
      className="sticky top-0 z-30 w-full bg-white/90 backdrop-blur border-b border-black/8"
      dir="rtl"
    >
      <div className="max-w-6xl mx-auto px-4 h-11 flex items-center justify-between gap-4">
        <Link href="/" className="text-base font-black tracking-tighter hover:opacity-70 transition-opacity shrink-0">
          כנסת ווטש
        </Link>
        <PeriodSelector />
        <GlobalSearch />
        <nav className="hidden md:flex items-center gap-1 text-xs font-black text-gray-500 shrink-0">
          {NAV_LINKS.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className={`px-2 py-2 rounded transition-colors ${
                link.highlight
                  ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                  : 'hover:bg-gray-100'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        {/* Hamburger button — mobile only */}
        <button
          onClick={() => setMenuOpen(o => !o)}
          className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg hover:bg-gray-100 transition-colors shrink-0"
          aria-label={menuOpen ? 'סגור תפריט' : 'פתח תפריט'}
          aria-expanded={menuOpen}
        >
          {menuOpen ? (
            <svg className="w-5 h-5 text-gray-700" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l12 12M16 4L4 16"/>
            </svg>
          ) : (
            <svg className="w-5 h-5 text-gray-700" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 5h14M3 10h14M3 15h14"/>
            </svg>
          )}
        </button>
      </div>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div
          className="md:hidden border-t border-black/8 bg-white/95 backdrop-blur"
          dir="rtl"
        >
          <nav className="max-w-6xl mx-auto px-4 py-2 flex flex-col">
            {NAV_LINKS.map(link => (
              <Link
                key={link.href}
                href={link.href}
                onClick={closeMenu}
                className={`text-sm font-black py-3 px-3 rounded-lg transition-colors ${
                  link.highlight
                    ? 'text-blue-700 hover:bg-blue-50'
                    : 'text-gray-700 hover:bg-gray-100'
                } ${pathname === link.href ? 'bg-gray-100' : ''}`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
