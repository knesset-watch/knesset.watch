'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';

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
    <div ref={containerRef} className="relative w-48 sm:w-64">
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
              <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 w-7 shrink-0 text-center">
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
        <div className="absolute top-full mt-1 right-0 w-64 bg-white border border-black/10 rounded-xl shadow-xl p-3 text-xs text-gray-400 text-center z-50">
          לא נמצאו תוצאות
        </div>
      )}
    </div>
  );
}

// Shown on all pages except the home page, which has its own sidebar nav.
export default function SiteHeader() {
  const pathname = usePathname();
  if (pathname === '/') return null;

  return (
    <header
      className="sticky top-0 z-30 w-full bg-white/90 backdrop-blur border-b border-black/8"
      dir="rtl"
    >
      <div className="max-w-6xl mx-auto px-4 h-11 flex items-center justify-between gap-4">
        <Link href="/" className="text-base font-black tracking-tighter hover:opacity-70 transition-opacity shrink-0">
          כנסת ווטש
        </Link>
        <GlobalSearch />
        <nav className="hidden md:flex items-center gap-1 text-xs font-black text-gray-500 shrink-0">
          <Link href="/mks" className="px-2 py-1 rounded hover:bg-gray-100 transition-colors">ח"כים</Link>
          <Link href="/committees" className="px-2 py-1 rounded hover:bg-gray-100 transition-colors">ועדות</Link>
          <Link href="/protocols" className="px-2 py-1 rounded hover:bg-gray-100 transition-colors">פרוטוקולים</Link>
          <Link href="/bills" className="px-2 py-1 rounded hover:bg-gray-100 transition-colors">חוקים</Link>
          <Link href="/ministers" className="px-2 py-1 rounded hover:bg-gray-100 transition-colors">שרים</Link>
          <Link href="/votes" className="px-2 py-1 rounded hover:bg-gray-100 transition-colors">הצבעות</Link>
        </nav>
      </div>
    </header>
  );
}
