'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useRef, useCallback } from 'react';
import { usePeriod, PERIOD_SHORTCUTS, periodLabel } from '@/lib/period-context';
import { NAV_GROUPS, AI_LINK, isNavActive } from '@/lib/nav';

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
        <svg className="w-3.5 h-3.5 text-mute shrink-0 ml-1.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
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
          aria-label='חיפוש בח"כים, ועדות וחוקים'
          className="flex-1 bg-transparent text-xs font-medium placeholder:text-mute placeholder:font-normal min-w-0"
          dir="rtl"
        />
        {loading && (
          <svg className="w-3 h-3 text-mute animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
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
              <span className="text-meta font-medium text-mute w-7 shrink-0 text-center">
                {TYPE_LABEL[hit.type] ?? hit.type}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{hit.title}</div>
                {hit.subtitle && <div className="text-meta text-mute truncate">{hit.subtitle}</div>}
              </div>
            </button>
          ))}
          <button
            onClick={() => { setOpen(false); setQuery(''); router.push(`/search?q=${encodeURIComponent(query.trim())}`); }}
            className="w-full text-center px-3 py-2 border-t border-black/5 text-meta font-medium text-accent hover:bg-gray-50 transition-colors"
          >
            ראה את כל התוצאות ←
          </button>
        </div>
      )}
      {open && results.length === 0 && !loading && query.length >= 2 && (
        <div className="absolute top-full mt-1 right-0 w-64 bg-white border border-black/10 rounded-xl shadow-xl p-3 text-xs text-mute text-center z-50">
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
        className="flex items-center gap-1 text-meta font-medium px-3 py-2 rounded-lg border border-black/10 hover:border-black/25 bg-white transition-colors"
      >
        <span>{label}</span>
        <svg className={`w-2.5 h-2.5 text-mute transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.5">
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
                className={`text-meta font-medium px-2 py-1.5 rounded-full transition-colors ${
                  period === p.value
                    ? 'bg-black text-white'
                    : 'bg-gray-100 text-ink-2 hover:bg-gray-200'
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
            <p className="text-meta text-accent mb-2 text-center">בחר תאריך סיום</p>
          ) : (
            <p className="text-meta text-mute mb-2 text-center">בחר טווח תאריכים</p>
          )}

          {/* Month header */}
          <div className="flex items-center justify-between mb-2">
            <button onClick={nextMonth} aria-label="החודש הבא" className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 text-mute">
              <svg viewBox="0 0 6 10" className="w-2 h-3" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 1L1 5l4 4"/></svg>
            </button>
            <span className="text-meta font-medium">{HE_MONTHS[viewMonth]} {viewYear}</span>
            <button onClick={prevMonth} aria-label="החודש הקודם" className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 text-mute">
              <svg viewBox="0 0 6 10" className="w-2 h-3" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 1l4 4-4 4"/></svg>
            </button>
          </div>

          {/* Day of week header */}
          <div className="grid grid-cols-7 mb-1">
            {HE_DOW.map(d => (
              <div key={d} className="text-meta font-medium text-mute text-center py-0.5">{d}</div>
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
                  className={`text-meta font-medium h-8 w-full flex items-center justify-center rounded transition-colors
                    ${isStart ? 'bg-black text-white' : ''}
                    ${!isStart && inRng ? 'bg-accent-wash text-accent' : ''}
                    ${!isStart && !inRng ? 'hover:bg-gray-100 text-ink-2' : ''}
                    ${isToday && !isStart && !inRng ? 'font-medium text-accent' : ''}
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
      <div className="px-4 h-11 flex items-center gap-4">
        {/* Logo — mobile only (desktop shows in sidebar) */}
        <Link href="/" className="md:hidden text-base font-medium tracking-tighter hover:opacity-70 transition-opacity shrink-0">
          אפרכסת לכנסת
        </Link>
        <div className="flex-1" />
        <PeriodSelector />
        <GlobalSearch />
        {/* Hamburger button — mobile only */}
        <button
          onClick={() => setMenuOpen(o => !o)}
          className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg hover:bg-gray-100 transition-colors shrink-0"
          aria-label={menuOpen ? 'סגור תפריט' : 'פתח תפריט'}
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
        >
          {menuOpen ? (
            <svg className="w-5 h-5 text-ink-2" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l12 12M16 4L4 16"/>
            </svg>
          ) : (
            <svg className="w-5 h-5 text-ink-2" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 5h14M3 10h14M3 15h14"/>
            </svg>
          )}
        </button>
      </div>

      {/* תפריט מובייל — מוזן מאותו מקור כמו הסיידבר, כולל הקיבוץ.
           לפני זה היו כאן 7 קישורים שטוחים מול 10 מקובצים בדסקטופ, ולכן
           פולס, מעקב חקיקה, אג'נדות ורשת קשרים לא היו נגישים במובייל כלל. */}
      {menuOpen && (
        <div
          id="mobile-nav"
          className="md:hidden border-t border-line bg-surface"
          dir="rtl"
        >
          <nav className="px-4 py-3 flex flex-col gap-4" aria-label="ניווט ראשי">
            {NAV_GROUPS.map(({ group, links }) => (
              <div key={group}>
                <p className="text-ui font-bold text-ink px-3 mb-1.5">{group}</p>
                {links.map(link => {
                  const active = isNavActive(pathname, link.prefixes);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={closeMenu}
                      aria-current={active ? "page" : undefined}
                      className={`block text-ui py-2.5 px-3 rounded-control border-r-2 transition-colors ${
                        active
                          ? "bg-accent-wash text-accent-ink font-medium border-accent"
                          : "text-ink-2 border-transparent hover:bg-surface-2"
                      }`}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </div>
            ))}
            <Link
              href={AI_LINK.href}
              onClick={closeMenu}
              aria-current={isNavActive(pathname, AI_LINK.prefixes) ? "page" : undefined}
              className="flex items-center gap-2 text-ui font-medium py-2.5 px-3 rounded-control bg-accent-wash text-accent-ink"
            >
              <span aria-hidden="true">✦</span>
              {AI_LINK.label}
            </Link>
          </nav>
        </div>
      )}

    </header>
  );
}
