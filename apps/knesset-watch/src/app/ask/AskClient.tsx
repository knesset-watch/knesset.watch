'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import EntityTooltip from '@/components/EntityTooltip';
import { MkTimeline } from '@/components/MkTimeline';

type SessionSource = { type: 'session'; sessionId: number; committeeName: string; date: string; title: string };
type VoteSource   = { type: 'vote';    voteId: number;    title: string; date: string; isPassed: boolean };
type BillSource   = { type: 'bill';    billId: number;    title: string; committeeName: string | null; isPassed: boolean };
type QuerySource  = { type: 'query';   queryId: number;   title: string; submitDate: string; mkName: string };
type Source = SessionSource | VoteSource | BillSource | QuerySource;

interface AskResult {
  answer: string;
  sources: Source[];
  detectedMk: { mkId: number; fullName: string } | null;
  topicKeywords: string[];
}

function SessionCard({ s }: { s: SessionSource }) {
  const date = new Date(s.date).toLocaleDateString('he-IL', { year: 'numeric', month: 'short', day: 'numeric' });
  return (
    <Link href={`/session/${s.sessionId}`} className="flex items-center justify-between gap-3 border border-gray-200 rounded-lg px-4 py-3 hover:border-blue-400 hover:bg-blue-50/40 transition-colors group">
      <div className="min-w-0">
        <p className="text-sm font-bold text-gray-800 truncate">{s.committeeName || 'ועדה'}</p>
        {s.title && <p className="text-xs text-gray-500 mt-0.5 truncate">{s.title}</p>}
        <p className="text-xs text-gray-400 mt-0.5">{date}</p>
      </div>
      <span className="text-gray-300 group-hover:text-blue-400 transition-colors shrink-0 text-lg">←</span>
    </Link>
  );
}

function VoteCard({ v }: { v: VoteSource }) {
  const date = v.date.slice(0, 10);
  return (
    <Link href={`/vote/${v.voteId}`} className="block border border-gray-200 rounded-lg px-4 py-3 hover:border-blue-400 hover:bg-blue-50/40 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-800 line-clamp-2 min-w-0">{v.title}</p>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-xs text-gray-500">{date}</span>
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${v.isPassed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
            {v.isPassed ? 'עבר' : 'לא עבר'}
          </span>
        </div>
      </div>
    </Link>
  );
}

function BillCard({ b }: { b: BillSource }) {
  return (
    <Link href={`/bill/${b.billId}`} className="block border border-gray-200 rounded-lg px-4 py-3 hover:border-blue-400 hover:bg-blue-50/40 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {b.committeeName && <p className="text-xs text-gray-500 mb-0.5">{b.committeeName}</p>}
          <p className="text-sm font-medium text-gray-800 line-clamp-2">{b.title}</p>
        </div>
        {b.isPassed && (
          <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-green-100 text-green-700 shrink-0">עבר</span>
        )}
      </div>
    </Link>
  );
}

function QueryCard({ q }: { q: QuerySource }) {
  const date = q.submitDate.slice(0, 10);
  return (
    <div className="border border-gray-200 rounded-lg px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-gray-500 mb-0.5">שאילתה — {q.mkName}</p>
          <p className="text-sm font-medium text-gray-800 line-clamp-2">{q.title}</p>
        </div>
        <span className="text-xs text-gray-500 whitespace-nowrap">{date}</span>
      </div>
    </div>
  );
}

const SOURCE_GROUPS: Array<{ type: Source['type']; label: string }> = [
  { type: 'session', label: 'פרוטוקולים' },
  { type: 'vote',    label: 'הצבעות' },
  { type: 'bill',    label: 'חוקים' },
  { type: 'query',   label: 'שאילתות' },
];

// Parse inline [SESSION:id], [VOTE:id], [BILL:id] tags from LLM answer and render as superscript links
const REF_RE = /\[(SESSION|VOTE|BILL):(\d+)\]/g;

function AnswerText({ text, sources }: { text: string; sources: Source[] }) {
  const sessionMap = new Map(
    sources.filter((s): s is SessionSource => s.type === 'session').map(s => [s.sessionId, `/session/${s.sessionId}`])
  );
  const voteMap = new Map(
    sources.filter((s): s is VoteSource => s.type === 'vote').map(s => [s.voteId, `/vote/${s.voteId}`])
  );
  const billMap = new Map(
    sources.filter((s): s is BillSource => s.type === 'bill').map(s => [s.billId, `/bill/${s.billId}`])
  );

  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={last}>{text.slice(last, m.index)}</span>);
    const id = Number(m[2]);
    const url = m[1] === 'SESSION' ? sessionMap.get(id)
              : m[1] === 'VOTE'    ? voteMap.get(id)
              : billMap.get(id);
    if (url) {
      parts.push(
        <Link key={m.index} href={url}
          className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-100 text-blue-600 hover:bg-blue-200 text-[11px] font-black align-super mx-0.5 transition-colors"
          title="פתח מקור">
          ↗
        </Link>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={last}>{text.slice(last)}</span>);

  return <p className="text-gray-900 text-sm leading-relaxed whitespace-pre-wrap" dir="rtl">{parts}</p>;
}

export default function AskClient({ initialQ }: { initialQ: string }) {
  const [query, setQuery]           = useState(initialQ);
  const [submittedQ, setSubmittedQ] = useState(initialQ);
  const [result, setResult]         = useState<AskResult | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [loading, setLoading]       = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (submittedQ.length < 2) return;
    setLoading(true);
    setError(null);
    setResult(null);
    fetch(`/api/ask?q=${encodeURIComponent(submittedQ)}`)
      .then(r => r.json())
      .then((d: AskResult & { error?: string }) => {
        if (d.error) { setError(d.error); return; }
        setResult(d);
      })
      .catch(() => setError('אירעה שגיאה, נסה שוב'))
      .finally(() => setLoading(false));
  }, [submittedQ]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.length >= 2) {
      setSubmittedQ(q);
      router.replace(`/ask?q=${encodeURIComponent(q)}`);
    }
  }

  const sessions = result?.sources.filter((s): s is SessionSource => s.type === 'session') ?? [];
  const votes    = result?.sources.filter((s): s is VoteSource    => s.type === 'vote')    ?? [];
  const bills    = result?.sources.filter((s): s is BillSource    => s.type === 'bill')    ?? [];
  const queries  = result?.sources.filter((s): s is QuerySource   => s.type === 'query')   ?? [];
  const hasAnySources = sessions.length + votes.length + bills.length + queries.length > 0;

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <nav className="flex items-center gap-1 text-sm text-gray-400 mb-6">
          <Link href="/" className="hover:text-gray-700">ראשי</Link>
          <span>/</span>
          <span className="text-gray-600">שאל את הכנסת</span>
        </nav>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">שאל את הכנסת</h1>
        <p className="text-sm text-gray-500 mb-6">חפש בפרוטוקולים, הצבעות, חוקים ושאילתות</p>

        <form onSubmit={handleSubmit} className="flex gap-2 mb-8">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="שאל שאלה על פעילות הכנסת..."
            className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            autoFocus
          />
          <button
            type="submit"
            disabled={loading || query.trim().length < 2}
            className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'מחפש…' : 'שאל'}
          </button>
        </form>

        {loading && (
          <div className="flex items-center gap-3 text-gray-500 text-sm py-8 justify-center">
            <svg className="animate-spin h-4 w-4 text-blue-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            מחפש בנתוני הכנסת…
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {result && !loading && (
          <div className="space-y-8">
            {result.detectedMk && (
              <p className="text-xs text-blue-600 bg-blue-50 rounded-md px-3 py-2 inline-block">
                חיפוש ממוקד עבור{' '}
                <EntityTooltip href={`/mk/${result.detectedMk.mkId}`} type="mk" id={result.detectedMk.mkId} className="font-semibold underline">
                  {result.detectedMk.fullName}
                </EntityTooltip>
              </p>
            )}

            <div className="bg-gray-50 border border-gray-200 rounded-xl px-5 py-4">
              <p className="text-sm font-semibold text-gray-500 mb-2">תשובה</p>
              <AnswerText text={result.answer} sources={result.sources} />
            </div>

            {hasAnySources && (
              <div>
                <p className="text-sm font-semibold text-gray-500 mb-3">מקורות</p>
                <div className="space-y-5">
                  {SOURCE_GROUPS.map(({ type, label }) => {
                    const items =
                      type === 'session' ? sessions :
                      type === 'vote'    ? votes :
                      type === 'bill'    ? bills :
                      queries;
                    if (items.length === 0) return null;
                    return (
                      <div key={type}>
                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">{label}</p>
                        <div className="space-y-2">
                          {type === 'session' && sessions.map(s => <SessionCard key={s.sessionId} s={s} />)}
                          {type === 'vote'    && votes.map(v    => <VoteCard    key={v.voteId}    v={v} />)}
                          {type === 'bill'    && bills.map(b    => <BillCard    key={b.billId}    b={b} />)}
                          {type === 'query'   && queries.map(q  => <QueryCard   key={q.queryId}   q={q} />)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {result.detectedMk && (result.topicKeywords ?? []).length > 0 && (
              <MkTimeline query={submittedQ} topicKeywords={result.topicKeywords} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
