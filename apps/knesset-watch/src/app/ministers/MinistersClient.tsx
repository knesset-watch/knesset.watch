'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { MinisterInfo } from '@/lib/knesset-db';

type SortCol = 'name' | 'sessions' | 'bills';

export default function MinistersClient({ ministers }: { ministers: MinisterInfo[] }) {
  const [sort, setSort] = useState<SortCol>('sessions');
  const fullMinisters = ministers.filter(m => !m.ministerRole.startsWith('סגן') && !m.ministerRole.startsWith('סגנית'));
  const deputies = ministers.filter(m => m.ministerRole.startsWith('סגן') || m.ministerRole.startsWith('סגנית'));

  function sortRows(rows: MinisterInfo[]) {
    return [...rows].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'he');
      if (sort === 'bills') return b.billCount - a.billCount;
      return b.committeeSessionCount - a.committeeSessionCount;
    });
  }

  function MinisterRow({ m }: { m: MinisterInfo }) {
    return (
      <div
        className={`grid grid-cols-[1fr_1fr_5rem_5rem_5rem] gap-4 py-3 px-4 rounded-xl items-center transition-colors ${
          m.isCoalition ? 'bg-[#F0FDF4] hover:bg-green-100' : 'bg-gray-50 hover:bg-gray-100'
        }`}
      >
        <div className="flex flex-col">
          <Link href={`/mk/${m.slug ?? m.id}`} className="font-black text-base hover:underline">
            {m.name}
          </Link>
          <span className="text-[11px] text-gray-500">{m.factionName}</span>
        </div>
        <div className="min-w-0">
          {m.ministry ? (
            <Link
              href={`/ministry/${encodeURIComponent(m.ministry)}`}
              className="text-xs text-gray-700 leading-snug line-clamp-2 hover:underline hover:text-teal-700 transition-colors"
            >
              {m.ministerRole}
            </Link>
          ) : (
            <span className="text-xs text-gray-700 leading-snug line-clamp-2">{m.ministerRole}</span>
          )}
        </div>
        <div className="flex flex-col items-center">
          <span className="text-xl font-black">{m.committeeSessionCount}</span>
          {m.committeeSessionCount > 0 && (
            <div className="w-full bg-gray-200 rounded-full h-0.5 mt-1">
              <div
                className="bg-teal-500 h-0.5 rounded-full"
                style={{ width: `${Math.min(100, (m.committeeSessionCount / 500) * 100)}%` }}
              />
            </div>
          )}
        </div>
        <span className="text-xl font-black text-center">{m.billCount}</span>
        <span className="text-xl font-black text-center">{m.passedCount > 0 ? m.passedCount : '—'}</span>
      </div>
    );
  }

  function SortHeader({ col, label, className = '' }: { col: SortCol; label: string; className?: string }) {
    return (
      <button
        onClick={() => setSort(col)}
        className={`text-[11px] font-black uppercase tracking-widest transition-colors flex items-center gap-1 ${className} ${
          sort === col ? 'text-black' : 'text-gray-400 hover:text-gray-600'
        }`}
      >
        {label}
        {sort === col && <span className="text-[8px]">▼</span>}
      </button>
    );
  }

  function MinistersTable({ rows }: { rows: MinisterInfo[] }) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="grid grid-cols-[1fr_1fr_5rem_5rem_5rem] gap-4 py-2 px-4">
          <SortHeader col="name" label="שם" />
          <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">משרד</span>
          <SortHeader col="sessions" label="ועדות" className="justify-center" />
          <SortHeader col="bills" label="הצעות" className="justify-center" />
          <span className="text-[11px] font-black uppercase tracking-widest text-gray-400 text-center">עברו</span>
        </div>
        {sortRows(rows).map(m => <MinisterRow key={m.id} m={m} />)}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <nav className="flex items-center gap-1 text-sm text-gray-400 mb-6">
          <Link href="/" className="font-black hover:text-black transition-colors">ראשי</Link>
          <span className="mx-1">›</span>
          <span className="text-black font-black">שרים</span>
        </nav>

        <h1 className="text-4xl font-black mb-1">שרים</h1>
        <p className="text-sm text-gray-500 mb-8">חברי כנסת המכהנים גם כשרים בממשלה</p>

        <div className="flex gap-4 mb-8">
          <div className="flex flex-col">
            <span className="text-[11px] font-black uppercase text-gray-400 mb-1">שרים</span>
            <span className="text-3xl font-black">{fullMinisters.length}</span>
          </div>
          <div className="flex flex-col border-r border-black/8 pr-4">
            <span className="text-[11px] font-black uppercase text-gray-400 mb-1">סגני שרים</span>
            <span className="text-3xl font-black">{deputies.length}</span>
          </div>
        </div>

        <div className="rounded-2xl border border-black/5 px-4 py-3 bg-gray-50 text-xs text-gray-500 mb-6">
          <span className="font-black text-gray-700">ועדות</span> = מספר ישיבות ועדה שנכח/ה בהן כחבר/ת כנסת ·
          <span className="font-black text-gray-700 mr-2">הצעות</span> = הצ&quot;ח שיזם/ה אישית
        </div>

        {/* Full ministers */}
        <div className="mb-8">
          <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-3">שרים</div>
          <MinistersTable rows={fullMinisters} />
        </div>

        {/* Deputies */}
        {deputies.length > 0 && (
          <div>
            <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-3">סגני שרים</div>
            <MinistersTable rows={deputies} />
          </div>
        )}
      </div>
    </div>
  );
}
