'use client';

import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface SearchResult {
  chunkId: number;
  sessionId: number;
  committeeId: number;
  committeeName: string;
  date: string;
  title: string | null;
  speaker: string | null;
  snippet: string;
}

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

interface AskSource {
  sessionId: number;
  committeeName: string | null;
  date: string;
  title: string | null;
}

interface CommitteeOption {
  name: string;
  sessionCount: number;
}

interface Props {
  committees: CommitteeOption[];
}

export default function ProtocolsClient({ committees }: Props) {
  const router = useRouter();

  // AI ask state
  const [askQuery, setAskQuery] = useState('');
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [askSources, setAskSources] = useState<AskSource[]>([]);
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [askSourcesOpen, setAskSourcesOpen] = useState(false);
  const askAnswerRef = useRef<HTMLDivElement>(null);

  // Keyword search state
  const [query, setQuery] = useState('');
  const [selectedCommittee, setSelectedCommittee] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [expandedSessions, setExpandedSessions] = useState<Map<number, FullProtocol>>(new Map());
  const [loadingSessions, setLoadingSessions] = useState<Set<number>>(new Set());

  const search = useCallback(async (q: string, committee: string | null, p: number) => {
    if (!q.trim()) { setResults([]); setTotal(0); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ q, page: String(p) });
      if (committee) params.set('committee', committee);
      const res = await fetch(`${BASE_PATH}/api/protocols/search?${params}`);
      const data = await res.json();
      setResults(data.results ?? []);
      setTotal(data.total ?? 0);
      setPage(p);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = (q: string) => {
    setQuery(q);
    if (q.trim().length >= 2) search(q, selectedCommittee, 1);
    else { setResults([]); setTotal(0); }
  };

  const handleCommittee = (c: string | null) => {
    setSelectedCommittee(c);
    if (query.trim().length >= 2) search(query, c, 1);
  };

  const expandSession = async (sessionId: number) => {
    if (expandedSessions.has(sessionId)) {
      setExpandedSessions(prev => { const next = new Map(prev); next.delete(sessionId); return next; });
      return;
    }
    setLoadingSessions(prev => new Set(prev).add(sessionId));
    try {
      const res = await fetch(`${BASE_PATH}/api/protocols/session/${sessionId}`);
      const data: FullProtocol = await res.json();
      setExpandedSessions(prev => new Map(prev).set(sessionId, data));
    } finally {
      setLoadingSessions(prev => { const next = new Set(prev); next.delete(sessionId); return next; });
    }
  };

  const handleAsk = async () => {
    if (!askQuery.trim() || askLoading) return;
    setAskLoading(true);
    setAskError(null);
    setAskAnswer(null);
    setAskSources([]);
    setAskSourcesOpen(false);
    try {
      const res = await fetch(`${BASE_PATH}/api/protocols/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: askQuery }),
      });
      const data = await res.json() as { answer?: string; sources?: AskSource[]; error?: string };
      if (data.error) throw new Error(data.error);
      setAskAnswer(data.answer ?? '');
      setAskSources(data.sources ?? []);
      setTimeout(() => askAnswerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (e: unknown) {
      setAskError(e instanceof Error ? e.message : 'שגיאה');
    } finally {
      setAskLoading(false);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' });

  const highlightSnippet = (snippet: string) =>
    snippet.split(/(<mark>.*?<\/mark>)/g).map((part, i) =>
      part.startsWith('<mark>') ? (
        <mark key={i} className="bg-yellow-200 rounded px-0.5">{part.replace(/<\/?mark>/g, '')}</mark>
      ) : <span key={i}>{part}</span>
    );

  // Group results by sessionId for display
  const sessionGroups = results.reduce<Map<number, SearchResult[]>>((acc, r) => {
    const arr = acc.get(r.sessionId) ?? [];
    arr.push(r);
    acc.set(r.sessionId, arr);
    return acc;
  }, new Map());

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <nav className="flex items-center gap-1 text-sm text-gray-400 mb-6">
          <Link href="/" className="font-black hover:text-black transition-colors">ראשי</Link>
          <span className="mx-1">›</span>
          <span className="text-black font-black">פרוטוקולים</span>
        </nav>

        <h1 className="text-3xl font-black mb-6">פרוטוקולים</h1>

        {/* AI Ask section */}
        <div className="mb-8">
          <p className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-2">שאל בינה מלאכותית</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={askQuery}
              onChange={e => setAskQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAsk(); }}
              placeholder="מה אמרו חברי הכנסת על...?"
              className="flex-1 text-sm px-4 py-3 rounded-2xl border border-black/10 bg-gray-50 focus:outline-none focus:border-black/30"
              dir="rtl"
            />
            <button
              onClick={handleAsk}
              disabled={askLoading || !askQuery.trim()}
              className="text-sm font-black px-5 py-3 rounded-2xl bg-black text-white disabled:opacity-30 hover:bg-gray-800 transition-colors shrink-0"
            >
              {askLoading ? '...' : 'שאל'}
            </button>
          </div>

          {askError && (
            <div className="mt-3 flex items-center gap-3">
              <p className="text-xs text-red-600 font-bold flex-1">{askError}</p>
              <button
                onClick={handleAsk}
                className="text-xs font-black px-3 py-1.5 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 transition-colors shrink-0"
              >
                נסה שוב
              </button>
            </div>
          )}

          {askAnswer !== null && (
            <div ref={askAnswerRef} className="mt-4 rounded-2xl border border-black/8 overflow-hidden">
              <div className="px-5 py-4">
                <p className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-3">תשובה</p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-gray-800" dir="rtl">
                  {askAnswer}
                </p>
              </div>
              {askSources.length > 0 && (
                <div className="border-t border-black/5">
                  <button
                    onClick={() => setAskSourcesOpen(o => !o)}
                    className="w-full flex items-center justify-between px-5 py-3 text-xs font-black text-gray-500 hover:bg-gray-50 transition-colors"
                  >
                    <span>מקורות ({askSources.length} ישיבות)</span>
                    <span>{askSourcesOpen ? '▲' : '▼'}</span>
                  </button>
                  {askSourcesOpen && (
                    <div className="px-5 pb-4 flex flex-col gap-1.5">
                      {askSources.map(s => (
                        <div key={s.sessionId} className="text-xs text-gray-600 flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <span className="font-bold">{s.committeeName ?? 'ועדה'}</span>
                            <span className="text-gray-400 mx-1">|</span>
                            <span>{formatDate(s.date)}</span>
                            {s.title && (
                              <>
                                <span className="text-gray-400 mx-1">|</span>
                                <span className="text-gray-500">{s.title}</span>
                              </>
                            )}
                          </div>
                          <Link
                            href={`${BASE_PATH}/session/${s.sessionId}`}
                            className="text-[10px] font-black text-teal-700 hover:underline shrink-0"
                          >
                            ←
                          </Link>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <p className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-2">חיפוש מילות מפתח</p>

        {/* Search input */}
        <input
          type="text"
          value={query}
          onChange={e => handleSearch(e.target.value)}
          placeholder="חיפוש בפרוטוקולי ועדות..."
          className="w-full text-sm px-4 py-3 rounded-2xl border border-black/10 bg-gray-50 focus:outline-none focus:border-black/30 mb-4"
          dir="rtl"
        />

        {/* Committee filter chips */}
        {committees.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-6">
            <button
              onClick={() => handleCommittee(null)}
              className={`text-xs font-black px-3 py-1.5 rounded-full transition-colors ${
                selectedCommittee === null ? 'bg-black text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              כל הוועדות
            </button>
            {committees.map(c => (
              <button
                key={c.name}
                onClick={() => handleCommittee(c.name)}
                className={`text-xs font-black px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5 ${
                  selectedCommittee === c.name ? 'bg-black text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {c.name}
                <span className={`text-[10px] font-bold tabular-nums ${
                  selectedCommittee === c.name ? 'opacity-70' : 'text-gray-400'
                }`}>
                  {c.sessionCount}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Results count */}
        {total > 0 && (
          <p className="text-xs text-gray-400 font-medium mb-4">
            {total.toLocaleString('he-IL')} תוצאות
          </p>
        )}

        {loading && <p className="text-sm text-gray-400">טוען...</p>}

        {/* Results grouped by session */}
        <div className="flex flex-col gap-3">
          {Array.from(sessionGroups.entries()).map(([sessionId, sessionResults]) => {
            const first = sessionResults[0];
            const isExpanded = expandedSessions.has(sessionId);
            const isLoadingSession = loadingSessions.has(sessionId);
            const protocol = expandedSessions.get(sessionId);

            return (
              <div key={sessionId} className="rounded-2xl border border-black/8 overflow-hidden">
                {/* Session header */}
                <div
                  className="flex items-start justify-between gap-3 px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => expandSession(sessionId)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-black text-gray-400">{formatDate(first.date)}</span>
                      <span className="text-xs font-black px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        {first.committeeName}
                      </span>
                      <Link
                        href={`${BASE_PATH}/session/${sessionId}`}
                        onClick={e => e.stopPropagation()}
                        className="text-[10px] font-black text-teal-700 hover:underline shrink-0"
                      >
                        פתח ישיבה ←
                      </Link>
                    </div>
                    {first.title && <p className="text-sm font-bold text-gray-800 mb-1">{first.title}</p>}
                    {/* Matching excerpts */}
                    <div className="flex flex-col gap-1.5">
                      {sessionResults.map(r => (
                        <div key={r.chunkId} className="text-xs text-gray-600 leading-relaxed">
                          {r.speaker && <span className="font-bold text-gray-700">{r.speaker}: </span>}
                          {highlightSnippet(r.snippet)}
                        </div>
                      ))}
                    </div>
                  </div>
                  <span className="text-gray-400 text-sm shrink-0 mt-0.5">
                    {isLoadingSession ? '...' : isExpanded ? '▲' : '▼'}
                  </span>
                </div>

                {/* Full protocol inline */}
                {isExpanded && protocol && (
                  <div className="border-t border-black/5 px-5 py-4 bg-gray-50 max-h-[60vh] overflow-y-auto">
                    <div className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap" dir="rtl">
                      {protocol.chunks.map((chunk, i) => (
                        <div key={i} className="mb-2">
                          {chunk.speaker && (
                            <span className="font-black text-gray-800">{chunk.speaker}: </span>
                          )}
                          {chunk.text.trim().replace(/\n{3,}/g, '\n\n')}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        {total > 20 && (
          <div className="flex items-center gap-3 mt-6 justify-center">
            <button
              onClick={() => search(query, selectedCommittee, page - 1)}
              disabled={page === 1}
              className="text-xs font-black px-4 py-2 rounded-full bg-gray-100 disabled:opacity-30 hover:bg-gray-200 transition-colors"
            >
              הקודם
            </button>
            <span className="text-xs text-gray-500">עמוד {page} מתוך {Math.ceil(total / 20)}</span>
            <button
              onClick={() => search(query, selectedCommittee, page + 1)}
              disabled={page >= Math.ceil(total / 20)}
              className="text-xs font-black px-4 py-2 rounded-full bg-gray-100 disabled:opacity-30 hover:bg-gray-200 transition-colors"
            >
              הבא
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
