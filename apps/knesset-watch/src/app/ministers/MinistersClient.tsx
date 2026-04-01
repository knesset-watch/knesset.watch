'use client';

import Link from 'next/link';
import type { MinisterInfo } from '@/lib/knesset-db';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export default function MinistersClient({ ministers }: { ministers: MinisterInfo[] }) {
  const fullMinisters = ministers.filter(m => !m.ministerRole.startsWith('סגן') && !m.ministerRole.startsWith('סגנית'));
  const deputies = ministers.filter(m => m.ministerRole.startsWith('סגן') || m.ministerRole.startsWith('סגנית'));

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
            <span className="text-[9px] font-black uppercase text-gray-400 mb-1">שרים</span>
            <span className="text-3xl font-black">{fullMinisters.length}</span>
          </div>
          <div className="flex flex-col border-r border-black/8 pr-4">
            <span className="text-[9px] font-black uppercase text-gray-400 mb-1">סגני שרים</span>
            <span className="text-3xl font-black">{deputies.length}</span>
          </div>
        </div>

        {/* Full ministers */}
        <div className="mb-8">
          <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-3">שרים</div>
          <div className="flex flex-col gap-1.5">
            {/* Header */}
            <div className="grid grid-cols-[1fr_1fr_5rem_5rem_5rem] gap-4 py-2 px-4 text-[10px] font-black uppercase tracking-widest text-gray-400">
              <span>שם</span>
              <span>משרד</span>
              <span>הצעות</span>
              <span>עברו</span>
              <span>יחס</span>
            </div>
            {fullMinisters.map(m => {
              const ratio = m.billCount > 0 ? Math.round((m.passedCount / m.billCount) * 100) : 0;
              return (
                <div key={m.id}
                  className={`grid grid-cols-[1fr_1fr_5rem_5rem_5rem] gap-4 py-3 px-4 rounded-xl items-center transition-colors ${m.isCoalition ? 'bg-[#F0FDF4] hover:bg-green-100' : 'bg-gray-50 hover:bg-gray-100'}`}>
                  <div className="flex flex-col">
                    <Link href={`/mk/${m.slug ?? m.id}`} className="font-black text-base hover:underline">
                      {m.name}
                    </Link>
                    <span className="text-[11px] text-gray-500">{m.factionName}</span>
                  </div>
                  <div className="min-w-0">
                    {m.ministry ? (
                      <Link href={`/ministry/${encodeURIComponent(m.ministry)}`} className="text-xs text-gray-700 leading-snug line-clamp-2 hover:underline hover:text-teal-700 transition-colors">{m.ministerRole}</Link>
                    ) : (
                      <span className="text-xs text-gray-700 leading-snug line-clamp-2">{m.ministerRole}</span>
                    )}
                  </div>
                  <span className="text-xl font-black text-center">{m.billCount}</span>
                  <span className="text-xl font-black text-teal-600 text-center">{m.passedCount}</span>
                  <span className="text-xl font-black text-center">{m.billCount > 0 ? `${ratio}%` : '—'}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Deputies */}
        {deputies.length > 0 && (
          <div>
            <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-3">סגני שרים</div>
            <div className="flex flex-col gap-1.5">
              <div className="grid grid-cols-[1fr_1fr_5rem_5rem_5rem] gap-4 py-2 px-4 text-[10px] font-black uppercase tracking-widest text-gray-400">
                <span>שם</span>
                <span>משרד</span>
                <span>הצעות</span>
                <span>עברו</span>
                <span>יחס</span>
              </div>
              {deputies.map(m => {
                const ratio = m.billCount > 0 ? Math.round((m.passedCount / m.billCount) * 100) : 0;
                return (
                  <div key={m.id}
                    className={`grid grid-cols-[1fr_1fr_5rem_5rem_5rem] gap-4 py-3 px-4 rounded-xl items-center transition-colors ${m.isCoalition ? 'bg-[#F0FDF4] hover:bg-green-100' : 'bg-gray-50 hover:bg-gray-100'}`}>
                    <div className="flex flex-col">
                      <Link href={`/mk/${m.slug ?? m.id}`} className="font-black text-base hover:underline">
                        {m.name}
                      </Link>
                      <span className="text-[11px] text-gray-500">{m.factionName}</span>
                    </div>
                    {m.ministry ? (
                      <Link href={`/ministry/${encodeURIComponent(m.ministry)}`} className="text-xs text-gray-700 hover:underline hover:text-teal-700 transition-colors">{m.ministerRole}</Link>
                    ) : (
                      <span className="text-xs text-gray-700">{m.ministerRole}</span>
                    )}
                    <span className="text-xl font-black text-center">{m.billCount}</span>
                    <span className="text-xl font-black text-teal-600 text-center">{m.passedCount}</span>
                    <span className="text-xl font-black text-center">{m.billCount > 0 ? `${ratio}%` : '—'}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
