'use client';

import Link from 'next/link';
import type { MinistryDetail } from '@/lib/knesset-db';

export default function MinistryClient({ data }: { data: MinistryDetail }) {
  const { name, ministers, billCount, passedCount } = data;
  const currentMinisters = ministers.filter(m => m.isCurrent);
  const formerMinisters = ministers.filter(m => !m.isCurrent);
  const passRatio = billCount > 0 ? Math.round((passedCount / billCount) * 100) : 0;

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <nav className="flex items-center gap-1 text-sm text-mute mb-6">
          <Link href="/" className="font-medium hover:text-black transition-colors">ראשי</Link>
          <span className="mx-1">›</span>
          <Link href="/ministers" className="font-medium hover:text-black transition-colors">שרים</Link>
          <span className="mx-1">›</span>
          <span className="text-black font-medium">{name}</span>
        </nav>

        <h1 className="text-4xl font-medium mb-6">{name}</h1>

        {/* Stats row */}
        <div className="flex flex-wrap gap-6 rounded-xl bg-gray-50 px-6 py-4 mb-8">
          <div className="flex flex-col">
            <span className="text-meta font-medium text-mute mb-0.5">שרים נוכחיים</span>
            <span className="text-3xl font-medium">{currentMinisters.length}</span>
          </div>
          <div className="flex flex-col border-r border-black/8 pr-6">
            <span className="text-meta font-medium text-mute mb-0.5">הצעות חוק</span>
            <span className="text-3xl font-medium">{billCount}</span>
          </div>
          <div className="flex flex-col border-r border-black/8 pr-6">
            <span className="text-meta font-medium text-mute mb-0.5">חוקים שעברו</span>
            <span className="text-3xl font-medium text-accent">{passedCount}</span>
          </div>
          <div className="flex flex-col border-r border-black/8 pr-6">
            <span className="text-meta font-medium text-mute mb-0.5">יחס מעבר</span>
            <span className="text-3xl font-medium">{billCount > 0 ? `${passRatio}%` : '—'}</span>
          </div>
        </div>

        {/* Current ministers */}
        {currentMinisters.length > 0 && (
          <div className="mb-8">
            <div className="text-meta font-medium text-mute mb-3">
              שרים נוכחיים ({currentMinisters.length})
            </div>
            <div className="flex flex-col gap-1.5">
              {currentMinisters.map(m => (
                <Link
                  key={m.personId}
                  href={`/mk/${m.slug ?? m.personId}`}
                  className="flex items-center gap-3 rounded-xl bg-[#F0FDF4] hover:bg-green-100 px-4 py-3 transition-colors"
                >
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="font-medium text-sm">{m.name}</span>
                    <span className="text-meta text-mute">{m.role}</span>
                    {m.factionName && (
                      <span className="text-meta text-mute">{m.factionName}</span>
                    )}
                  </div>
                  <svg className="w-3.5 h-3.5 text-mute shrink-0 rotate-180" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="m6 3 5 5-5 5"/>
                  </svg>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Former ministers */}
        {formerMinisters.length > 0 && (
          <div>
            <div className="text-meta font-medium text-mute mb-3">
              לשעבר ({formerMinisters.length})
            </div>
            <div className="flex flex-col gap-1.5">
              {formerMinisters.map(m => (
                <Link
                  key={`${m.personId}-${m.role}`}
                  href={`/mk/${m.slug ?? m.personId}`}
                  className="flex items-center gap-3 rounded-xl bg-gray-50 hover:bg-gray-100 px-4 py-3 transition-colors"
                >
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="font-medium text-sm text-mute">{m.name}</span>
                    <span className="text-meta text-mute">{m.role}</span>
                  </div>
                  <svg className="w-3.5 h-3.5 text-mute shrink-0 rotate-180" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="m6 3 5 5-5 5"/>
                  </svg>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
