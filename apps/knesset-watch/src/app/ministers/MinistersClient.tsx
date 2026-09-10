'use client';

import FilterChips from '@/components/FilterChips';
import { useState } from 'react';
import Link from 'next/link';
import type { MinisterInfo } from '@/lib/knesset-db';

type SortCol = 'name' | 'sessions' | 'bills';
type SortDir = 'asc' | 'desc';

export default function MinistersClient({ ministers }: { ministers: MinisterInfo[] }) {
  const [sort, setSort] = useState<SortCol>('sessions');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const fullMinisters = ministers.filter(m => !m.ministerRole.startsWith('סגן') && !m.ministerRole.startsWith('סגנית'));
  const deputies = ministers.filter(m => m.ministerRole.startsWith('סגן') || m.ministerRole.startsWith('סגנית'));

  function handleSort(col: SortCol) {
    if (sort === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(col);
      setSortDir('desc');
    }
  }

  function sortRows(rows: MinisterInfo[]) {
    const sorted = [...rows].sort((a, b) => {
      let comparison = 0;
      if (sort === 'name') comparison = a.name.localeCompare(b.name, 'he');
      else if (sort === 'bills') comparison = b.billCount - a.billCount;
      else comparison = b.committeeSessionCount - a.committeeSessionCount;
      return sortDir === 'asc' ? -comparison : comparison;
    });
    return sorted;
  }

  function MinisterRow({ m }: { m: MinisterInfo }) {
    return (
      <div
        className={`flex flex-col sm:grid sm:grid-cols-[1fr_1fr_5rem_5rem_5rem] gap-2 sm:gap-4 py-3 px-4 rounded-xl sm:items-center transition-all cursor-pointer border border-transparent hover:border-gray-300 ${
          m.isCoalition ? 'bg-[#F0FDF4] hover:bg-green-100' : 'bg-gray-50 hover:bg-gray-100'
        }`}
      >
        <div className="flex flex-col">
          <Link href={`/mk/${m.slug ?? m.id}`} className="font-medium text-base hover:underline">
            {m.name}
          </Link>
          <span className="text-meta text-mute">{m.factionName}</span>
        </div>
        <div className="min-w-0">
          {m.ministry && m.officeSlug ? (
            <Link
              href={`/office/${m.officeSlug}`}
              className="text-xs text-ink-2 leading-snug line-clamp-2 hover:underline hover:text-accent transition-colors"
            >
              {m.ministerRole}
            </Link>
          ) : m.ministry ? (
            <Link
              href={`/ministry/${encodeURIComponent(m.ministry)}`}
              className="text-xs text-ink-2 leading-snug line-clamp-2 hover:underline hover:text-accent transition-colors"
            >
              {m.ministerRole}
            </Link>
          ) : (
            <span className="text-xs text-ink-2 leading-snug line-clamp-2">{m.ministerRole}</span>
          )}
        </div>
        <div className="flex flex-col items-center">
          <span className="text-xl font-medium">{m.committeeSessionCount}</span>
          {m.committeeSessionCount > 0 && (
            <div className="w-full bg-gray-200 rounded-full h-0.5 mt-1">
              <div
                className="bg-accent h-0.5 rounded-full"
                style={{ width: `${Math.min(100, (m.committeeSessionCount / 500) * 100)}%` }}
              />
            </div>
          )}
        </div>
        <span className="text-xl font-medium text-center">{m.billCount}</span>
        <span className="text-xl font-medium text-center">{m.passedCount > 0 ? m.passedCount : '—'}</span>
      </div>
    );
  }

  function SortHeader({ col, label, className = '' }: { col: SortCol; label: string; className?: string }) {
    const isActive = sort === col;
    const arrow = isActive ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
    return (
      <button
        onClick={() => handleSort(col)}
        className={`text-meta font-medium transition-colors flex items-center gap-1 whitespace-nowrap ${className} ${
          isActive ? 'text-black bg-accent-wash px-2 py-1 rounded' : 'text-mute hover:text-ink-2'
        }`}
      >
        {label}{arrow}
      </button>
    );
  }

  function MinistersTable({ rows }: { rows: MinisterInfo[] }) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="hidden sm:grid sm:grid-cols-[1fr_1fr_5rem_5rem_5rem] gap-2 sm:gap-4 py-2 px-4">
          <SortHeader col="name" label="שם" />
          <span className="text-meta font-medium text-mute">משרד</span>
          <SortHeader col="sessions" label="ועדות" className="justify-center" />
          <SortHeader col="bills" label={'ה"ח\u00A0יזומות'} className="justify-center" />
          <span className="text-meta font-medium text-mute text-center">עברו</span>
        </div>
        {sortRows(rows).map(m => <MinisterRow key={m.id} m={m} />)}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <nav className="flex items-center gap-1 text-sm text-mute mb-6">
          <Link href="/" className="font-medium hover:text-black transition-colors">ראשי</Link>
          <span className="mx-1">›</span>
          <span className="text-black font-medium">שרים</span>
        </nav>

        <h1 className="text-4xl font-medium mb-1">שרים</h1>
        <p className="text-sm text-mute mb-8">חברי כנסת המכהנים גם כשרים בממשלה</p>

        <div className="flex gap-4 mb-8">
          <div className="flex flex-col">
            <span className="text-meta font-medium text-mute mb-1">שרים</span>
            <span className="text-3xl font-medium">{fullMinisters.length}</span>
          </div>
          <div className="flex flex-col border-r border-black/8 pr-4">
            <span className="text-meta font-medium text-mute mb-1">סגני שרים</span>
            <span className="text-3xl font-medium">{deputies.length}</span>
          </div>
        </div>

        <div className="rounded-2xl border border-black/5 px-4 py-3 bg-gray-50 text-xs text-mute mb-6">
          <span className="font-medium text-ink-2">ועדות</span> = מספר ישיבות ועדה שנכח/ה בהן כחבר/ת כנסת ·
          <span className="font-medium text-ink-2 mr-2 whitespace-nowrap">ה&quot;ח&nbsp;יזומות</span> = הצ&quot;ח שבהן הח&quot;כ מופיע/ה כיוזם/ת
        </div>

        {/* Full ministers */}
        <div className="mb-8">
          <div className="text-meta font-medium text-mute mb-3">שרים</div>
          <MinistersTable rows={fullMinisters} />
        </div>

        {/* Deputies */}
        {deputies.length > 0 && (
          <div>
            <div className="text-meta font-medium text-mute mb-3">סגני שרים</div>
            <MinistersTable rows={deputies} />
          </div>
        )}
      </div>
    </div>
  );
}
