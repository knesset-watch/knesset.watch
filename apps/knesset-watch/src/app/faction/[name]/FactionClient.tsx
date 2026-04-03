'use client';

import Link from 'next/link';
import type { FactionDetail } from '@/lib/knesset-db';

export default function FactionClient({ data }: { data: FactionDetail }) {
  const { name, isCoalition, mks, billCount, passedCount, rebellionRate } = data;
  const currentMks = mks.filter(m => m.isCurrent);
  const formerMks = mks.filter(m => !m.isCurrent);
  const passRatio = billCount > 0 ? Math.round((passedCount / billCount) * 100) : 0;

  const bgColor = isCoalition === true ? 'bg-[#F0FDF4]' : isCoalition === false ? 'bg-[#EFF6FF]' : 'bg-gray-50';
  const statusLabel = isCoalition === true ? 'קואליציה' : isCoalition === false ? 'אופוזיציה' : 'לא ידוע';
  const statusColor = isCoalition === true ? 'bg-green-100 text-green-800' : isCoalition === false ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600';

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <nav className="flex items-center gap-1 text-sm text-gray-400 mb-6">
          <Link href="/" className="font-black hover:text-black transition-colors">ראשי</Link>
          <span className="mx-1">›</span>
          <Link href="/mks" className="font-black hover:text-black transition-colors">ח"כים</Link>
          <span className="mx-1">›</span>
          <span className="text-black font-black">{name}</span>
        </nav>

        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-4xl font-black mb-2">{name}</h1>
            <span className={`text-xs font-black px-2.5 py-1 rounded-full ${statusColor}`}>{statusLabel}</span>
          </div>
        </div>

        {/* Stats row */}
        <div className={`flex flex-wrap gap-6 rounded-xl px-6 py-4 mb-8 ${bgColor}`}>
          <div className="flex flex-col">
            <span className="text-[11px] font-black uppercase text-gray-400 mb-0.5">ח"כים פעילים</span>
            <span className="text-3xl font-black">{currentMks.length}</span>
          </div>
          <div className="flex flex-col border-r border-black/8 pr-6">
            <span className="text-[11px] font-black uppercase text-gray-400 mb-0.5">הצעות חוק</span>
            <span className="text-3xl font-black">{billCount}</span>
          </div>
          <div className="flex flex-col border-r border-black/8 pr-6">
            <span className="text-[11px] font-black uppercase text-gray-400 mb-0.5">חוקים שעברו</span>
            <span className="text-3xl font-black text-teal-600">{passedCount}</span>
          </div>
          <div className="flex flex-col border-r border-black/8 pr-6">
            <span className="text-[11px] font-black uppercase text-gray-400 mb-0.5">יחס מעבר</span>
            <span className="text-3xl font-black">{billCount > 0 ? `${passRatio}%` : '—'}</span>
          </div>
          {rebellionRate !== null && (
            <div className="flex flex-col border-r border-black/8 pr-6">
              <span className="text-[11px] font-black uppercase text-gray-400 mb-0.5">מרד בהצבעות</span>
              <span className="text-3xl font-black">{rebellionRate.toFixed(1)}%</span>
            </div>
          )}
        </div>

        {/* Current MKs */}
        <div className="mb-8">
          <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-3">
            ח"כים נוכחים ({currentMks.length})
          </div>
          <div className="flex flex-col gap-1.5">
            {currentMks.map(mk => (
              <Link
                key={mk.personId}
                href={`/mk/${mk.slug ?? mk.personId}`}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 transition-colors ${bgColor} hover:brightness-95`}
              >
                <span className="font-black text-sm">{mk.firstName} {mk.lastName}</span>
                <svg className="w-3.5 h-3.5 text-gray-300 shrink-0 mr-auto rotate-180" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="m6 3 5 5-5 5"/>
                </svg>
              </Link>
            ))}
          </div>
        </div>

        {/* Former MKs */}
        {formerMks.length > 0 && (
          <div>
            <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-3">
              לשעבר ({formerMks.length})
            </div>
            <div className="flex flex-col gap-1.5">
              {formerMks.map(mk => (
                <Link
                  key={mk.personId}
                  href={`/mk/${mk.slug ?? mk.personId}`}
                  className="flex items-center gap-3 rounded-xl px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  <span className="font-black text-sm text-gray-500">{mk.firstName} {mk.lastName}</span>
                  <svg className="w-3.5 h-3.5 text-gray-300 shrink-0 mr-auto rotate-180" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5">
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
