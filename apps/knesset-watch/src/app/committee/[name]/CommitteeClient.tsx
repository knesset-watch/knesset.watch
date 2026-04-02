'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { CommitteeDetail } from '@/lib/knesset-db';
import type { CommitteeProtocolSession } from '@/lib/protocols-db';
import EntityTooltip from '@/components/EntityTooltip';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface FullProtocol {
  session: {
    sessionId: number;
    committeeName: string | null;
    date: string;
    title: string | null;
    chunkCount: number;
  };
  chunks: Array<{ chunkIndex: number; text: string; speaker: string | null }>;
}

export default function CommitteeClient({
  data,
  protocolSessions,
}: {
  data: CommitteeDetail;
  protocolSessions: CommitteeProtocolSession[];
}) {
  const ratio = data.billCount > 0 ? Math.round((data.passedCount / data.billCount) * 100) : 0;
  const [search, setSearch] = useState('');
  const [showPassedOnly, setShowPassedOnly] = useState(false);
  const [expandedBills, setExpandedBills] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<'bills' | 'protocols'>(
    protocolSessions.length > 0 ? 'protocols' : 'bills'
  );
  const [protocolSearch, setProtocolSearch] = useState('');
  const [expandedProtocols, setExpandedProtocols] = useState<Map<number, FullProtocol>>(new Map());
  const [loadingProtocols, setLoadingProtocols] = useState<Set<number>>(new Set());

  const filtered = data.bills.filter(b => {
    if (showPassedOnly && !b.isPassed) return false;
    if (search) {
      const q = search.toLowerCase();
      return b.title.toLowerCase().includes(q) ||
        b.microAgenda?.toLowerCase().includes(q) ||
        b.initiators.some(i => i.name.includes(q));
    }
    return true;
  });

  const toggleBill = (id: number) => setExpandedBills(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const coalitionMembers = data.members.filter(m => m.isCoalition === true);
  const oppositionMembers = data.members.filter(m => m.isCoalition === false);
  const otherMembers = data.members.filter(m => m.isCoalition === null);

  const expandProtocol = async (sessionId: number) => {
    if (expandedProtocols.has(sessionId)) {
      setExpandedProtocols(prev => { const next = new Map(prev); next.delete(sessionId); return next; });
      return;
    }
    setLoadingProtocols(prev => new Set(prev).add(sessionId));
    try {
      const res = await fetch(`${BASE_PATH}/api/protocols/session/${sessionId}`);
      const data: FullProtocol = await res.json();
      setExpandedProtocols(prev => new Map(prev).set(sessionId, data));
    } finally {
      setLoadingProtocols(prev => { const n = new Set(prev); n.delete(sessionId); return n; });
    }
  };

  const filteredProtocols = protocolSessions.filter(s => {
    if (!protocolSearch) return true;
    const q = protocolSearch;
    return s.title?.includes(q) || s.date.includes(q);
  });

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1 text-sm text-gray-400 mb-6">
          <Link href="/" className="font-black hover:text-black transition-colors">ראשי</Link>
          <span className="mx-1">›</span>
          <Link href="/committees" className="font-black hover:text-black transition-colors">ועדות</Link>
          <span className="mx-1">›</span>
          <span className="text-black font-black truncate max-w-xs">{data.name}</span>
        </nav>

        {/* Header */}
        <h1 className="text-3xl font-black leading-tight mb-2">{data.name}</h1>

        {/* Stats row */}
        <div className="flex gap-6 mb-8 mt-4">
          {data.billCount > 0 && (
            <>
              <div className="flex flex-col">
                <span className="text-[9px] font-black uppercase text-gray-400 mb-1">הצעות חוק</span>
                <span className="text-3xl font-black">{data.billCount}</span>
              </div>
              <div className="flex flex-col border-r border-black/8 pr-6">
                <span className="text-[9px] font-black uppercase text-gray-400 mb-1">עברו</span>
                <span className="text-3xl font-black text-teal-600">{data.passedCount}</span>
              </div>
              <div className="flex flex-col border-r border-black/8 pr-6">
                <span className="text-[9px] font-black uppercase text-gray-400 mb-1">יחס</span>
                <span className="text-3xl font-black">{ratio}%</span>
              </div>
            </>
          )}
          {data.sessionCount > 0 && (
            <div className="flex flex-col border-r border-black/8 pr-6">
              <span className="text-[9px] font-black uppercase text-gray-400 mb-1">ישיבות</span>
              <span className="text-3xl font-black">{data.sessionCount}</span>
            </div>
          )}
          <div className="flex flex-col border-r border-black/8 pr-6">
            <span className="text-[9px] font-black uppercase text-gray-400 mb-1">חברים</span>
            <span className="text-3xl font-black">{data.members.length}</span>
          </div>
        </div>

        {/* Members */}
        {data.members.length > 0 && (
          <div className="rounded-2xl border border-black/8 p-6 mb-6">
            <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-3">חברי הוועדה</div>
            <div className="flex flex-col gap-4">
              {coalitionMembers.length > 0 && (
                <div>
                  <div className="text-[9px] font-black text-[#16A34A] uppercase tracking-widest mb-2">קואליציה</div>
                  <div className="flex flex-wrap gap-1.5">
                    {coalitionMembers.map(m => (
                      <EntityTooltip key={m.id} href={`/mk/${m.slug ?? m.id}`} type="mk" id={m.slug ?? m.id}
                        className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-green-50 border border-green-200 text-green-800 hover:bg-green-100 transition-colors">
                        {m.name}
                      </EntityTooltip>
                    ))}
                  </div>
                </div>
              )}
              {oppositionMembers.length > 0 && (
                <div>
                  <div className="text-[9px] font-black text-[#2563EB] uppercase tracking-widest mb-2">אופוזיציה</div>
                  <div className="flex flex-wrap gap-1.5">
                    {oppositionMembers.map(m => (
                      <EntityTooltip key={m.id} href={`/mk/${m.slug ?? m.id}`} type="mk" id={m.slug ?? m.id}
                        className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-800 hover:bg-blue-100 transition-colors">
                        {m.name}
                      </EntityTooltip>
                    ))}
                  </div>
                </div>
              )}
              {otherMembers.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {otherMembers.map(m => (
                    <EntityTooltip key={m.id} href={`/mk/${m.slug ?? m.id}`} type="mk" id={m.slug ?? m.id}
                      className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-gray-100 border border-gray-200 text-gray-700 hover:bg-gray-200 transition-colors">
                      {m.name}
                    </EntityTooltip>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-black/8">
          <button
            onClick={() => setActiveTab('bills')}
            className={`text-xs font-black px-4 py-2.5 transition-colors border-b-2 -mb-px ${
              activeTab === 'bills' ? 'border-black text-black' : 'border-transparent text-gray-400 hover:text-black'
            }`}
          >
            הצ&quot;ח ({data.bills.length})
          </button>
          {protocolSessions.length > 0 && (
            <button
              onClick={() => setActiveTab('protocols')}
              className={`text-xs font-black px-4 py-2.5 transition-colors border-b-2 -mb-px ${
                activeTab === 'protocols' ? 'border-black text-black' : 'border-transparent text-gray-400 hover:text-black'
              }`}
            >
              פרוטוקולים ({protocolSessions.length})
            </button>
          )}
        </div>

        {/* Bills tab */}
        {activeTab === 'bills' && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="חיפוש לפי נושא..."
                className="flex-1 text-sm px-4 py-2 rounded-full border border-black/10 bg-gray-50 focus:outline-none focus:border-black/30"
                dir="rtl"
              />
              <button
                onClick={() => setShowPassedOnly(!showPassedOnly)}
                className={`text-xs font-black px-4 py-2 rounded-full transition-colors ${showPassedOnly ? 'bg-black text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                עברו בלבד
              </button>
            </div>

            <div className="text-xs text-gray-400 font-medium mb-3">
              {filtered.length} מתוך {data.bills.length} הצ&quot;ח
            </div>

            <div className="flex flex-col gap-1.5">
              {filtered.map(b => {
                const isExpanded = expandedBills.has(b.billId);
                return (
                  <div key={b.billId} className="rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors">
                    <div className="flex items-start gap-3 px-4 py-3">
                      <span className={`shrink-0 mt-0.5 text-[10px] font-black px-2 py-0.5 rounded-full ${b.isPassed ? 'bg-[#16A34A] text-white' : 'bg-gray-200 text-gray-500'}`}>
                        {b.isPassed ? 'עבר' : (b.statusDesc ?? 'בתהליך')}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-bold leading-snug text-gray-900">{b.title}</p>
                          <div className="flex items-center gap-1 shrink-0">
                            {b.docUrl && (
                              <a href={b.docUrl} target="_blank" rel="noopener noreferrer"
                                className="text-[10px] font-black text-gray-400 hover:text-black border border-gray-200 hover:border-gray-400 px-1.5 py-0.5 rounded transition-colors">
                                PDF
                              </a>
                            )}
                            {b.summary && (
                              <button onClick={() => toggleBill(b.billId)}
                                className="text-[10px] font-black text-gray-400 hover:text-black border border-gray-200 hover:border-gray-400 px-1.5 py-0.5 rounded transition-colors">
                                {isExpanded ? '▲' : '▼'}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {b.initDate && <span className="text-[10px] text-gray-400">{b.initDate}</span>}
                          {b.initiators.map(i => (
                            <Link key={i.id} href={`/mk/${i.slug ?? i.id}`}
                              className="text-[10px] font-bold text-teal-700 hover:underline">
                              {i.name}
                            </Link>
                          ))}
                          {b.macroAgenda && <span className="text-[10px] font-black text-white bg-black px-1.5 py-0.5 rounded-full">{b.macroAgenda}</span>}
                          {b.subtype && <span className="text-[10px] text-gray-400">{b.subtype}</span>}
                        </div>
                      </div>
                    </div>
                    {b.summary && isExpanded && (
                      <div className="px-4 pb-3 border-t border-black/5 pt-2">
                        <p className="text-xs text-gray-600 leading-relaxed">{b.summary}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Protocols tab */}
        {activeTab === 'protocols' && (
          <div>
            {/* One-time transcript coverage banner */}
            {(() => {
              const withTranscript = protocolSessions.filter(s => s.chunkCount > 0).length;
              const total = protocolSessions.length;
              if (total > 0 && withTranscript < total) {
                return (
                  <div className="mb-4 rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-700 leading-relaxed">
                    <span className="font-black">{withTranscript} מתוך {total} ישיבות</span> כוללות תמלול מלא הניתן לחיפוש.
                    שאר הישיבות מופיעות ברשימה עם קישור לפרוטוקול המקורי מאתר הכנסת.
                  </div>
                );
              }
              return null;
            })()}

            <input
              type="text"
              value={protocolSearch}
              onChange={e => setProtocolSearch(e.target.value)}
              placeholder="חיפוש לפי תאריך או כותרת..."
              className="w-full text-sm px-4 py-2 rounded-full border border-black/10 bg-gray-50 focus:outline-none focus:border-black/30 mb-4"
              dir="rtl"
            />
            <div className="text-xs text-gray-400 font-medium mb-3">
              {filteredProtocols.length} ישיבות
            </div>
            <div className="flex flex-col gap-1.5">
              {filteredProtocols.map(s => {
                const isExpanded = expandedProtocols.has(s.sessionId);
                const isLoading = loadingProtocols.has(s.sessionId);
                const protocol = expandedProtocols.get(s.sessionId);
                const date = new Date(s.date).toLocaleDateString('he-IL', {
                  year: 'numeric', month: 'long', day: 'numeric',
                });
                const hasTranscript = s.chunkCount > 0;

                return (
                  <div key={s.sessionId} className="rounded-xl bg-gray-50 overflow-hidden">
                    <div
                      className={`flex items-center justify-between px-4 py-3 transition-colors ${hasTranscript ? 'cursor-pointer hover:bg-gray-100' : ''}`}
                      onClick={() => hasTranscript && expandProtocol(s.sessionId)}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-gray-700">{date}</span>
                          {hasTranscript && (
                            <span className="text-[10px] font-black text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded">✓ תמלול</span>
                          )}
                          {hasTranscript && (
                            <span className="text-[10px] text-gray-400 font-medium">{s.chunkCount} קטעים</span>
                          )}
                        </div>
                        {s.title && <p className="text-sm font-bold mt-0.5">{s.title}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Link href={`/session/${s.sessionId}`} onClick={e => e.stopPropagation()}
                          className="text-[10px] font-black text-gray-400 hover:text-black border border-gray-200 hover:border-gray-400 px-1.5 py-0.5 rounded transition-colors">
                          פתח
                        </Link>
                        {s.protocolUrl && (
                          <a href={s.protocolUrl} target="_blank" rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-[10px] font-black text-teal-700 hover:text-teal-900 border border-teal-200 hover:border-teal-400 px-1.5 py-0.5 rounded transition-colors">
                            PDF
                          </a>
                        )}
                        {hasTranscript && (
                          <span className="text-gray-400 text-sm">
                            {isLoading ? '...' : isExpanded ? '▲' : '▼'}
                          </span>
                        )}
                      </div>
                    </div>
                    {isExpanded && protocol && (
                      <div className="border-t border-black/5 px-4 py-3 max-h-[60vh] overflow-y-auto bg-white">
                        <div className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap" dir="rtl">
                          {protocol.chunks.map((chunk, i) => (
                            <div key={i} className="mb-3">
                              {chunk.speaker && (
                                <span className="font-black text-gray-800">{chunk.speaker}: </span>
                              )}
                              {chunk.text}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
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
