'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import EntityTooltip from '@/components/EntityTooltip';
import { MkTimeline } from '@/components/MkTimeline';
import { VoteCoalition } from '@/components/VoteCoalition';

type SessionSource = { type: 'session'; sessionId: number; committeeName: string; date: string; title: string; snippet?: string };
type VoteSource   = { type: 'vote';    voteId: number;    title: string; date: string; isPassed: boolean };
type BillSource   = { type: 'bill';    billId: number;    title: string; committeeName: string | null; isPassed: boolean };
type QuerySource  = { type: 'query';   queryId: number;   title: string; submitDate: string; mkName: string };
type Source = SessionSource | VoteSource | BillSource | QuerySource;

interface AskResult {
  answer: string;
  sources: Source[];
  detectedMk: { mkId: number; fullName: string } | null;
  topicKeywords: string[];
  dateLabel?: string;      // e.g. "2024-01 – 2024-04" when query has temporal expression
  hasPrevContext?: boolean;
}

function SessionCard({ s }: { s: SessionSource }) {
  const date = new Date(s.date).toLocaleDateString('he-IL', { year: 'numeric', month: 'short', day: 'numeric' });
  return (
    <Link href={`/session/${s.sessionId}`} className="flex items-start justify-between gap-3 border border-gray-200 rounded-lg px-4 py-3 hover:border-blue-400 hover:bg-blue-50/40 transition-colors group">
      <div className="min-w-0">
        <p className="text-sm font-bold text-gray-800 truncate">{s.committeeName || 'ועדה'}</p>
        {s.snippet
          ? <p className="text-xs text-gray-600 mt-1 line-clamp-2 leading-relaxed">{s.snippet}</p>
          : s.title && <p className="text-xs text-gray-500 mt-0.5 truncate">{s.title}</p>
        }
        <p className="text-xs text-gray-400 mt-1">{date}</p>
      </div>
      <span className="text-gray-300 group-hover:text-blue-400 transition-colors shrink-0 text-lg mt-0.5">←</span>
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

// Parse inline [SESSION:id], [VOTE:id], [BILL:id] tags from LLM answer and render as entity hover cards
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
    const type = m[1] === 'SESSION' ? 'session' : m[1] === 'VOTE' ? 'vote' : 'bill';
    const url = type === 'session' ? sessionMap.get(id) : type === 'vote' ? voteMap.get(id) : billMap.get(id);
    if (url) {
      parts.push(
        <EntityTooltip
          key={m.index}
          href={url}
          type={type}
          id={id}
          className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-100 text-blue-600 hover:bg-blue-200 text-[11px] font-black align-super mx-0.5 transition-colors"
        >
          ↗
        </EntityTooltip>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={last}>{text.slice(last)}</span>);

  return <p className="text-gray-900 text-sm leading-relaxed whitespace-pre-wrap" dir="rtl">{parts}</p>;
}

const SUGGESTED_QUESTIONS = [
  { label: 'על ח"כ', q: 'מה עשה איתמר בן גביר בנושא הביטחון?' },
  { label: 'על ח"כ', q: 'כיצד הצביע יאיר לפיד בנושא השכר המינימלי?' },
  { label: 'הצבעות', q: 'מהן ההצבעות הצמודות ביותר השנה?' },
  { label: 'הצבעות', q: 'אלו חוקים עברו בתמיכת האופוזיציה?' },
  { label: 'חוקים', q: 'מהם החוקים שעברו בתחום החינוך?' },
  { label: 'ועדות', q: 'מה דנה ועדת הכספים לאחרונה?' },
];

export default function AskClient({ initialQ }: { initialQ: string }) {
  const [query, setQuery]                   = useState(initialQ);
  const [submittedQ, setSubmittedQ]         = useState(initialQ);
  const [result, setResult]                 = useState<AskResult | null>(null);
  const [streamingAnswer, setStreamingAnswer] = useState('');
  const [isStreaming, setIsStreaming]       = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [loading, setLoading]               = useState(false);
  const [suggestions, setSuggestions]       = useState<string[]>([]);
  // Multi-turn: last completed Q+answer for conversation context
  const [prevContext, setPrevContext]       = useState<{ q: string; a: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (submittedQ.length < 2) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setStreamingAnswer('');
    setIsStreaming(false);
    setSuggestions([]);

    const controller = new AbortController();

    // Build URL — include previous context for multi-turn if available
    const url = new URL('/api/ask', window.location.origin);
    url.searchParams.set('q', submittedQ);
    if (prevContext) {
      url.searchParams.set('prev_q', prevContext.q);
      url.searchParams.set('prev_a', prevContext.a.slice(0, 400));
    }

    fetch(url.toString(), { signal: controller.signal })
      .then(async (res) => {
        const ct = res.headers.get('content-type') ?? '';

        if (ct.includes('application/json')) {
          const d = await res.json() as AskResult & { error?: string };
          if (d.error) { setError(d.error); return; }
          setResult(d);
          return;
        }

        setIsStreaming(true);
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let fullAnswer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const ev = JSON.parse(line) as {
                type: string; text?: string; message?: string; questions?: string[];
                sources?: Source[]; detectedMk?: AskResult['detectedMk']; topicKeywords?: string[];
                dateLabel?: string; hasPrevContext?: boolean;
              };
              if (ev.type === 'meta') {
                setResult({ answer: '', sources: ev.sources ?? [], detectedMk: ev.detectedMk ?? null, topicKeywords: ev.topicKeywords ?? [], dateLabel: ev.dateLabel, hasPrevContext: ev.hasPrevContext });
                setLoading(false);
              } else if (ev.type === 'chunk') {
                fullAnswer += ev.text ?? '';
                setStreamingAnswer(fullAnswer);
              } else if (ev.type === 'done') {
                setResult(r => r ? { ...r, answer: fullAnswer } : null);
                setStreamingAnswer('');
                setIsStreaming(false);
                // Save this turn as context for the next query
                setPrevContext({ q: submittedQ, a: fullAnswer });
              } else if (ev.type === 'suggestions') {
                setSuggestions(ev.questions ?? []);
              } else if (ev.type === 'error') {
                setError(ev.message ?? 'שגיאה');
                setIsStreaming(false);
              }
            } catch { /* skip */ }
          }
        }
      })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name !== 'AbortError') setError('אירעה שגיאה, נסה שוב');
      })
      .finally(() => { setLoading(false); setIsStreaming(false); });

    return () => controller.abort();
  }, [submittedQ]); // eslint-disable-line react-hooks/exhaustive-deps

  function submitQuery(q: string) {
    if (q.trim().length >= 2) {
      setQuery(q.trim());
      setSubmittedQ(q.trim());
      setSuggestions([]);
      router.replace(`/ask?q=${encodeURIComponent(q.trim())}`);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submitQuery(query);
  }

  const sessions = result?.sources.filter((s): s is SessionSource => s.type === 'session') ?? [];
  const votes    = result?.sources.filter((s): s is VoteSource    => s.type === 'vote')    ?? [];
  const bills    = result?.sources.filter((s): s is BillSource    => s.type === 'bill')    ?? [];
  const queries  = result?.sources.filter((s): s is QuerySource   => s.type === 'query')   ?? [];
  const hasAnySources = sessions.length + votes.length + bills.length + queries.length > 0;
  const showResult = result !== null;

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <nav className="flex items-center gap-1 text-sm text-gray-400 mb-6">
          <Link href="/" className="hover:text-gray-700">ראשי</Link>
          <span>/</span>
          <span className="text-gray-600">שאל את הכנסת</span>
        </nav>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">שאל את הכנסת</h1>
        <p className="text-sm text-gray-600 mb-3">חפש אנליטיקה ותשובות על פעילות הכנסת — הצבעות, חוקים, דיונים וועדות</p>
        <p className="text-xs text-gray-500 mb-6">שאל בעברית על כל נושא הקשור לפעילות הכנסת ה-25. מערכת AI תחפש בפרוטוקולים, הצבעות, חוקים ושאילתות.</p>

        <form onSubmit={handleSubmit} className="flex gap-2 mb-8">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="לדוגמה: מה הצביע בן גביר על חוקי הביטחון?"
            className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            autoFocus
          />
          <button
            type="submit"
            disabled={loading || query.trim().length < 2}
            className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title={query.trim().length < 2 ? "הקלד לפחות 2 תווים כדי להתחיל חיפוש" : ""}
          >
            {loading ? 'מחפש…' : 'שאל'}
          </button>
        </form>

        {query.trim().length < 2 && !loading && (
          <div className="text-xs text-gray-500 mb-6 p-2 bg-blue-50 rounded border border-blue-100">
            💡 <span className="font-medium">טיפ:</span> הקלדו את השאלה שלכם כדי להתחיל חיפוש
          </div>
        )}

        {!loading && !result && !error && submittedQ.length < 2 && (
          <div className="mt-4 p-4 bg-gradient-to-br from-blue-50 to-transparent rounded-lg border border-blue-100">
            <p className="text-xs font-black uppercase text-gray-500 mb-3 tracking-wide">📌 דוגמאות שתוכלו לנסות</p>
            <p className="text-xs text-gray-600 mb-4">לחצו על אחת מהשאלות כדי לראות תשובה:</p>
            <div className="flex flex-col gap-2">
              {SUGGESTED_QUESTIONS.map(({ label, q }) => (
                <button
                  key={q}
                  onClick={() => submitQuery(q)}
                  className="flex items-start gap-2 text-sm px-3 py-2 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-white transition-colors text-gray-700 hover:text-blue-700 text-right"
                >
                  <span className="text-[10px] font-black text-blue-600 uppercase tracking-wide shrink-0 mt-0.5">{label}</span>
                  <span className="flex-1">{q}</span>
                </button>
              ))}
            </div>
          </div>
        )}

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

        {showResult && (
          <div className="space-y-8">
            <div className="flex flex-wrap gap-2">
              {result!.detectedMk && (
                <p className="text-xs text-blue-600 bg-blue-50 rounded-md px-3 py-2 inline-flex items-center gap-1">
                  חיפוש ממוקד עבור{' '}
                  <EntityTooltip href={`/mk/${result!.detectedMk.mkId}`} type="mk" id={result!.detectedMk.mkId} className="font-semibold underline">
                    {result!.detectedMk.fullName}
                  </EntityTooltip>
                </p>
              )}
              {result!.dateLabel && (
                <p className="text-xs text-amber-700 bg-amber-50 rounded-md px-3 py-2 inline-block">
                  טווח זמן: {result!.dateLabel}
                </p>
              )}
              {result!.hasPrevContext && (
                <p className="text-xs text-purple-700 bg-purple-50 rounded-md px-3 py-2 inline-flex items-center gap-1">
                  <span>↩</span> בהמשך לשאלה הקודמת
                </p>
              )}
            </div>

            {/* Answer — streams in while sources are already visible */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-5 py-4">
              <p className="text-sm font-semibold text-gray-500 mb-2">תשובה</p>
              {isStreaming ? (
                <p className="text-gray-900 text-sm leading-relaxed whitespace-pre-wrap" dir="rtl">
                  {streamingAnswer}
                  <span className="inline-block w-0.5 h-[1em] bg-blue-500 ml-0.5 animate-pulse align-text-bottom" />
                </p>
              ) : result!.answer ? (
                <AnswerText text={result!.answer} sources={result!.sources} />
              ) : (
                <div className="flex items-center gap-2 text-gray-400 text-sm py-2">
                  <svg className="animate-spin h-4 w-4 text-blue-400" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  מנסח תשובה…
                </div>
              )}
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

            {suggestions.length > 0 && !isStreaming && (
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">שאלות המשך</p>
                <div className="flex flex-col gap-2">
                  {suggestions.map(sq => (
                    <button
                      key={sq}
                      onClick={() => submitQuery(sq)}
                      className="text-sm text-right px-4 py-2.5 rounded-lg border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors text-gray-700 hover:text-blue-700 w-full"
                    >
                      {sq}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {result!.detectedMk && (result!.topicKeywords ?? []).length > 0 && !isStreaming && (
              <MkTimeline query={submittedQ} topicKeywords={result!.topicKeywords} />
            )}

            {votes.length === 1 && !isStreaming && (
              <VoteCoalition voteId={votes[0].voteId} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
