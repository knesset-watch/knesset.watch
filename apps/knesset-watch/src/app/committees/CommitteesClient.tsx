'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import type { CommitteeActivity } from '@/lib/knesset-db';

type SortOption = 'sessions' | 'recent' | 'name';
type ViewMode = 'cards' | 'list';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('he-IL', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function CommitteesClient({
  committees,
  totalSessions,
}: {
  committees: CommitteeActivity[];
  totalSessions: number;
}) {
  const [sort, setSort] = useState<SortOption>('sessions');
  const [view, setView] = useState<ViewMode>('cards');
  const [search, setSearch] = useState('');
  const didMount = useRef(false);

  useEffect(() => {
    const saved = localStorage.getItem('kw-view-committees') as ViewMode | null;
    if (saved === 'cards' || saved === 'list') setView(saved);
    didMount.current = true;
  }, []);
  useEffect(() => {
    if (didMount.current) localStorage.setItem('kw-view-committees', view);
  }, [view]);

  const sorted = useMemo(() => {
    const filtered = search.trim()
      ? committees.filter(c => c.name.includes(search.trim()))
      : committees;

    return [...filtered].sort((a, b) => {
      if (sort === 'sessions') return b.sessionCount - a.sessionCount;
      if (sort === 'recent') {
        const da = a.lastProtocolDate ?? a.lastSessionDate ?? '';
        const db2 = b.lastProtocolDate ?? b.lastSessionDate ?? '';
        return db2.localeCompare(da);
      }
      return a.name.localeCompare(b.name, 'he');
    });
  }, [committees, sort, search]);

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="mb-8">
          <Link href="/" className="text-sm font-black text-gray-400 hover:text-black transition-colors">
            → ראשי
          </Link>
        </div>

        <h1 className="text-3xl font-black leading-tight mb-1">ועדות הכנסת</h1>
        <p className="text-sm text-gray-400 font-medium mb-6">
          {committees.length} ועדות · {totalSessions.toLocaleString('he-IL')} ישיבות מתועדות
        </p>

        {/* Controls */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש ועדה..."
            className="text-sm px-3 py-2 rounded-xl border border-black/10 bg-gray-50 focus:outline-none focus:border-black/30 w-48"
            dir="rtl"
          />

          {/* Sort */}
          <div className="flex items-center gap-1 mr-2">
            <span className="text-[10px] font-black text-gray-400 uppercase tracking-wide ml-1">מיון:</span>
            {([
              { value: 'sessions', label: 'ישיבות' },
              { value: 'recent',   label: 'פעילות אחרונה' },
              { value: 'name',     label: 'שם' },
            ] as { value: SortOption; label: string }[]).map(o => (
              <button
                key={o.value}
                onClick={() => setSort(o.value)}
                className={`text-xs font-black px-3 py-1.5 rounded-full transition-colors ${
                  sort === o.value ? 'bg-black text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          {/* View toggle */}
          <div className="flex items-center gap-1 border border-black/10 rounded-xl p-0.5 mr-auto">
            <button
              onClick={() => setView('cards')}
              title="תצוגת כרטיסים"
              className={`p-1.5 rounded-lg transition-colors ${view === 'cards' ? 'bg-black text-white' : 'text-gray-400 hover:text-black'}`}
            >
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                <rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/>
                <rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/>
              </svg>
            </button>
            <button
              onClick={() => setView('list')}
              title="תצוגת רשימה"
              className={`p-1.5 rounded-lg transition-colors ${view === 'list' ? 'bg-black text-white' : 'text-gray-400 hover:text-black'}`}
            >
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                <rect x="1" y="2" width="14" height="2" rx="1"/><rect x="1" y="7" width="14" height="2" rx="1"/>
                <rect x="1" y="12" width="14" height="2" rx="1"/>
              </svg>
            </button>
          </div>
        </div>

        {search.trim() && (
          <p className="text-xs text-gray-400 font-medium mb-4">{sorted.length} תוצאות</p>
        )}

        {/* Cards view */}
        {view === 'cards' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sorted.map(c => {
              const lastDate = c.lastProtocolDate ?? c.lastSessionDate;
              const hasProtocol = !!c.lastProtocolDate;
              return (
                <Link
                  key={c.committeeId}
                  href={`/committee/${encodeURIComponent(c.name)}`}
                  className="group rounded-2xl border border-black/8 p-5 hover:border-black/20 hover:shadow-sm transition-all"
                >
                  <div className="font-black text-sm leading-snug mb-3 group-hover:text-black text-gray-900">
                    {c.name}
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-[9px] font-black uppercase text-gray-400 mb-0.5">ישיבות</span>
                      <span className="text-xl font-black">{c.sessionCount.toLocaleString('he-IL')}</span>
                    </div>
                    {lastDate && (
                      <div className="flex flex-col items-end">
                        <span className={`text-[9px] font-black uppercase mb-0.5 ${hasProtocol ? 'text-teal-600' : 'text-gray-400'}`}>
                          {hasProtocol ? 'דיון אחרון' : 'אחרונה'}
                        </span>
                        <span className={`text-xs font-bold ${hasProtocol ? 'text-teal-700' : 'text-gray-500'}`}>
                          {formatDate(lastDate)}
                        </span>
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* List view */}
        {view === 'list' && (
          <div className="flex flex-col gap-px">
            <div className="grid grid-cols-[1fr_6rem_10rem] gap-4 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-gray-400">
              <span>ועדה</span>
              <span className="text-center">ישיבות</span>
              <span className="text-left">פעילות אחרונה</span>
            </div>
            {sorted.map(c => {
              const lastDate = c.lastProtocolDate ?? c.lastSessionDate;
              const hasProtocol = !!c.lastProtocolDate;
              return (
                <Link
                  key={c.committeeId}
                  href={`/committee/${encodeURIComponent(c.name)}`}
                  className="grid grid-cols-[1fr_6rem_10rem] gap-4 items-center px-4 py-3 rounded-xl hover:bg-gray-50 transition-colors group"
                >
                  <span className="text-sm font-bold text-gray-900 group-hover:text-black truncate">{c.name}</span>
                  <span className="text-sm font-black text-center tabular-nums">{c.sessionCount.toLocaleString('he-IL')}</span>
                  <span className={`text-xs font-bold ${hasProtocol ? 'text-teal-700' : 'text-gray-400'}`}>
                    {lastDate ? formatDate(lastDate) : '—'}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
