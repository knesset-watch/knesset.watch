'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { CommitteeDetail, CommitteeSessionFull } from '@/lib/knesset-db';
import EntityTooltip from '@/components/EntityTooltip';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface FullSessionDetail {
  agendaItems: Array<{ itemNumber: number | null; title: string; itemType: string | null }>;
  votes: Array<{ subject: string | null; result: string | null; forCount: number | null; againstCount: number | null; abstainCount: number | null; passed: number | null }>;
  linkedBills: Array<{ billId: number; title: string; subtype: string | null; isPassed: boolean }>;
  documents: Array<{ id: number; groupTypeDesc: string | null; documentName: string | null; filePath: string | null; applicationDesc: string | null }>;
  chunks: Array<{ chunkIndex: number; text: string; speaker: string | null }>;
}

export default function CommitteeClient({
  data,
  sessions,
}: {
  data: CommitteeDetail;
  sessions: CommitteeSessionFull[];
}) {
  const ratio = data.billCount > 0 ? Math.round((data.passedCount / data.billCount) * 100) : 0;

  // Bills state
  const [search, setSearch] = useState('');
  const [showPassedOnly, setShowPassedOnly] = useState(false);
  const [expandedBills, setExpandedBills] = useState<Set<number>>(new Set());

  // Session state
  const [activeTab, setActiveTab] = useState<'bills' | 'sessions'>(sessions.length > 0 ? 'sessions' : 'bills');
  const [expandedSessions, setExpandedSessions] = useState<Map<number, FullSessionDetail>>(new Map());
  const [expandedSessionTabs, setExpandedSessionTabs] = useState<Map<number, string>>(new Map());
  const [loadingSessions, setLoadingSessions] = useState<Set<number>>(new Set());
  const [failedSessions, setFailedSessions] = useState<Set<number>>(new Set());
  const [sessionSearch, setSessionSearch] = useState('');

  // Derived values
  const cancelledCount = sessions.filter(s => s.statusDesc === 'מבוטלת').length;
  const closedCount = sessions.filter(s => s.typeDesc === 'חסויה').length;
  const jointCount = sessions.filter(s => s.isJoint).length;

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

  const filteredSessions = sessions.filter(s => {
    if (!sessionSearch) return true;
    const q = sessionSearch.toLowerCase();
    return s.firstAgendaTitle?.toLowerCase().includes(q) ||
      s.date.includes(q);
  });

  const toggleBill = (id: number) => setExpandedBills(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const coalitionMembers = data.members.filter(m => m.isCoalition === true);
  const oppositionMembers = data.members.filter(m => m.isCoalition === false);
  const otherMembers = data.members.filter(m => m.isCoalition === null);

  const expandSession = async (sessionId: number) => {
    if (expandedSessions.has(sessionId)) {
      setExpandedSessions(prev => { const next = new Map(prev); next.delete(sessionId); return next; });
      return;
    }
    setFailedSessions(prev => { const n = new Set(prev); n.delete(sessionId); return n; });
    setLoadingSessions(prev => new Set(prev).add(sessionId));
    try {
      const res = await fetch(`${BASE_PATH}/api/committee/session/${sessionId}`);
      if (!res.ok) throw new Error(`שגיאת שרת ${res.status}`);
      const detail: FullSessionDetail = await res.json();
      setExpandedSessions(prev => new Map(prev).set(sessionId, detail));
      const firstTab = detail.agendaItems.length > 0 ? 'agenda'
        : detail.votes.length > 0 ? 'votes'
        : detail.linkedBills.length > 0 ? 'bills'
        : detail.chunks.length > 0 ? 'transcript'
        : 'documents';
      setExpandedSessionTabs(prev => new Map(prev).set(sessionId, firstTab));
    } catch {
      setFailedSessions(prev => new Set(prev).add(sessionId));
    } finally {
      setLoadingSessions(prev => { const n = new Set(prev); n.delete(sessionId); return n; });
    }
  };

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
        <div className="flex gap-6 mb-8 mt-4 flex-wrap">
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
          {sessions.length > 0 && (
            <div className="flex flex-col border-r border-black/8 pr-6">
              <span className="text-[9px] font-black uppercase text-gray-400 mb-1">ישיבות</span>
              <span className="text-3xl font-black">{sessions.length}</span>
              {cancelledCount > 0 && <span className="text-[9px] text-gray-400 mt-0.5">{cancelledCount} בוטלו</span>}
            </div>
          )}
          {closedCount > 0 && (
            <div className="flex flex-col border-r border-black/8 pr-6">
              <span className="text-[9px] font-black uppercase text-gray-400 mb-1">חסויות</span>
              <span className="text-3xl font-black text-red-500">{closedCount}</span>
            </div>
          )}
          {jointCount > 0 && (
            <div className="flex flex-col border-r border-black/8 pr-6">
              <span className="text-[9px] font-black uppercase text-gray-400 mb-1">משותפות</span>
              <span className="text-3xl font-black text-blue-500">{jointCount}</span>
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
          {sessions.length > 0 && (
            <button
              onClick={() => setActiveTab('sessions')}
              className={`text-xs font-black px-4 py-2.5 transition-colors border-b-2 -mb-px ${
                activeTab === 'sessions' ? 'border-black text-black' : 'border-transparent text-gray-400 hover:text-black'
              }`}
            >
              ישיבות ({sessions.length})
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
                          <button
                            onClick={() => setActiveTab('sessions')}
                            className="text-[10px] font-black text-indigo-600 hover:text-indigo-800 border border-indigo-200 hover:border-indigo-400 px-1.5 py-0.5 rounded transition-colors"
                          >
                            ← ישיבות
                          </button>
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

        {/* Sessions tab */}
        {activeTab === 'sessions' && (
          <div>
            <input
              type="text"
              value={sessionSearch}
              onChange={e => setSessionSearch(e.target.value)}
              placeholder="חיפוש לפי תאריך או כותרת..."
              className="w-full text-sm px-4 py-2 rounded-full border border-black/10 bg-gray-50 focus:outline-none focus:border-black/30 mb-4"
              dir="rtl"
            />
            <div className="text-xs text-gray-400 font-medium mb-3">
              {filteredSessions.length} ישיבות
            </div>
            <div className="flex flex-col gap-1.5">
              {filteredSessions.map(s => {
                const isCancelled = s.statusDesc === 'מבוטלת';
                const isClosed = s.typeDesc === 'חסויה';
                const date = new Date(s.date).toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' });
                const timeRange = s.startTime && s.endTime
                  ? `${s.startTime.slice(11, 16)}–${s.endTime.slice(11, 16)}`
                  : s.startTime ? s.startTime.slice(11, 16) : null;
                const sessionLabel = s.protocolNumber
                  ? `פרוטוקול ${s.protocolNumber}`
                  : s.sessionNumber ? `ישיבה ${s.sessionNumber}` : null;

                return (
                  <div key={s.id} className={`rounded-xl overflow-hidden border ${isCancelled ? 'border-gray-200 opacity-60' : 'border-transparent bg-gray-50'}`}>
                    {/* Header — always clickable */}
                    <button type="button" className="w-full text-right flex items-start justify-between px-4 py-3 hover:bg-gray-100 transition-colors"
                      onClick={() => expandSession(s.id)}>
                      <div className="flex-1 min-w-0">
                        {/* Date + badges */}
                        <div className="flex items-center gap-1.5 flex-wrap mb-1">
                          <span className={`text-xs font-bold ${isCancelled ? 'line-through text-gray-400' : 'text-gray-700'}`}>{date}</span>
                          {timeRange && <span className="text-[10px] text-gray-400">{timeRange}</span>}
                          {isCancelled && <span className="text-[10px] font-black text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded">בוטלה</span>}
                          {isClosed && <span className="text-[10px] font-black text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">🔒 חסויה</span>}
                          {s.isJoint && <span className="text-[10px] font-black text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">משותפת</span>}
                          {sessionLabel && <span className="text-[10px] text-gray-400 font-medium">{sessionLabel}</span>}
                          {s.chunkCount > 0 && <span className="text-[10px] font-black text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded">✓ תמלול</span>}
                        </div>
                        {/* Agenda title */}
                        {s.firstAgendaTitle && <p className="text-sm font-bold leading-snug text-gray-900 mt-0.5">{s.firstAgendaTitle}</p>}
                        {/* Cancellation reason */}
                        {isCancelled && s.noProtocolReason && <p className="text-xs text-gray-400 mt-0.5">{s.noProtocolReason}</p>}
                        {/* Mini stats */}
                        {!isCancelled && (s.voteCount > 0 || s.linkedBillCount > 0 || s.chunkCount > 0) && (
                          <div className="flex items-center gap-3 mt-1.5">
                            {s.voteCount > 0 && <span className="text-[10px] text-gray-500 font-medium">🗳️ {s.voteCount} הצבעות</span>}
                            {s.linkedBillCount > 0 && <span className="text-[10px] text-gray-500 font-medium">📋 {s.linkedBillCount} הצ&quot;ח</span>}
                            {s.chunkCount > 0 && <span className="text-[10px] text-gray-400">{s.chunkCount} קטעים</span>}
                          </div>
                        )}
                      </div>
                      {/* Actions */}
                      <div className="flex items-center gap-2 mr-3 shrink-0">
                        <Link href={`/session/${s.id}`} onClick={e => e.stopPropagation()}
                          className="text-[10px] font-black text-gray-400 hover:text-black border border-gray-200 hover:border-gray-400 px-1.5 py-0.5 rounded transition-colors">
                          פתח
                        </Link>
                        {s.protocolUrl && (
                          <a href={s.protocolUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                            className="text-[10px] font-black text-teal-700 hover:text-teal-900 border border-teal-200 hover:border-teal-400 px-1.5 py-0.5 rounded transition-colors">
                            PDF
                          </a>
                        )}
                        <span className="text-gray-400 text-sm">
                          {loadingSessions.has(s.id) ? '...' : expandedSessions.has(s.id) ? '▲' : '▼'}
                        </span>
                      </div>
                    </button>

                    {failedSessions.has(s.id) && !expandedSessions.has(s.id) && (
                      <p className="px-4 py-2 text-xs text-red-500 border-t border-black/5">שגיאה בטעינת פרטי הישיבה. נסה שוב.</p>
                    )}

                    {/* Expanded detail */}
                    {(() => {
                      const detail = expandedSessions.get(s.id);
                      if (!detail) return null;
                      const activeDetailTab = expandedSessionTabs.get(s.id) ?? 'agenda';
                      const tabs = [
                        { key: 'agenda', label: 'סדר יום', count: detail.agendaItems.length },
                        { key: 'votes', label: 'הצבעות', count: detail.votes.length },
                        { key: 'bills', label: 'הצ"ח', count: detail.linkedBills.length },
                        { key: 'transcript', label: 'תמלול', count: detail.chunks.length },
                        { key: 'documents', label: 'מסמכים', count: detail.documents.length },
                      ].filter(t => t.count > 0);

                      if (tabs.length === 0) {
                        return <p className="px-4 py-3 text-xs text-gray-400 border-t border-black/5">אין מידע זמין לישיבה זו.</p>;
                      }

                      return (
                        <div className="border-t border-black/5 bg-white">
                          {/* Detail tab bar */}
                          <div className="flex gap-0 border-b border-black/5 px-4">
                            {tabs.map(t => (
                              <button key={t.key}
                                onClick={() => setExpandedSessionTabs(prev => new Map(prev).set(s.id, t.key))}
                                className={`text-[11px] font-black px-3 py-2 border-b-2 -mb-px transition-colors ${
                                  activeDetailTab === t.key ? 'border-black text-black' : 'border-transparent text-gray-400 hover:text-black'
                                }`}>
                                {t.label} ({t.count})
                              </button>
                            ))}
                          </div>

                          {/* Tab content */}
                          <div className="px-4 py-3 max-h-[50vh] overflow-y-auto" dir="rtl">
                            {activeDetailTab === 'agenda' && (
                              <ol className="flex flex-col gap-1.5">
                                {detail.agendaItems.map((item, i) => (
                                  <li key={item.itemNumber ?? i} className="text-xs text-gray-700 leading-relaxed flex gap-2">
                                    {item.itemNumber != null && <span className="font-black text-gray-400 shrink-0">{item.itemNumber}.</span>}
                                    <span>{item.title}</span>
                                  </li>
                                ))}
                              </ol>
                            )}
                            {activeDetailTab === 'votes' && (
                              <div className="flex flex-col gap-2">
                                {detail.votes.map((v, i) => (
                                  <div key={i} className="rounded-lg bg-gray-50 px-3 py-2">
                                    {v.subject && <p className="text-xs font-bold text-gray-800 mb-1">{v.subject}</p>}
                                    <div className="flex items-center gap-3 text-[11px]">
                                      {v.result && <span className="text-gray-600">{v.result}</span>}
                                      {v.forCount != null && <span className="text-green-700 font-black">בעד: {v.forCount}</span>}
                                      {v.againstCount != null && <span className="text-red-700 font-black">נגד: {v.againstCount}</span>}
                                      {v.abstainCount != null && <span className="text-gray-500">נמנע: {v.abstainCount}</span>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                            {activeDetailTab === 'bills' && (
                              <div className="flex flex-col gap-1.5">
                                {detail.linkedBills.map(b => (
                                  <div key={b.billId} className="flex items-center gap-2">
                                    <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full shrink-0 ${b.isPassed ? 'bg-[#16A34A] text-white' : 'bg-gray-200 text-gray-500'}`}>
                                      {b.isPassed ? 'עבר' : 'בתהליך'}
                                    </span>
                                    <span className="text-xs text-gray-800">{b.title}</span>
                                    {b.subtype && <span className="text-[10px] text-gray-400 shrink-0">{b.subtype}</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                            {activeDetailTab === 'transcript' && (
                              <div className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">
                                {detail.chunks.map((chunk) => (
                                  <div key={chunk.chunkIndex} className="mb-3">
                                    {chunk.speaker && <span className="font-black text-gray-800">{chunk.speaker}: </span>}
                                    {chunk.text}
                                  </div>
                                ))}
                              </div>
                            )}
                            {activeDetailTab === 'documents' && (
                              <div className="flex flex-col gap-1.5">
                                {detail.documents.map(doc => (
                                  <div key={doc.id} className="flex items-center gap-2">
                                    <span className="text-[10px] text-gray-400 font-medium shrink-0">{doc.applicationDesc ?? 'DOC'}</span>
                                    {doc.filePath ? (
                                      <a href={doc.filePath} target="_blank" rel="noopener noreferrer"
                                        className="text-xs text-teal-700 hover:underline truncate">
                                        {doc.documentName ?? doc.groupTypeDesc ?? 'מסמך'}
                                      </a>
                                    ) : (
                                      <span className="text-xs text-gray-600 truncate">{doc.documentName ?? doc.groupTypeDesc ?? 'מסמך'}</span>
                                    )}
                                    {doc.groupTypeDesc && <span className="text-[10px] text-gray-400 shrink-0">({doc.groupTypeDesc})</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
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
