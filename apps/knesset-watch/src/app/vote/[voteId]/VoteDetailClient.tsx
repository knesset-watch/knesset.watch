'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MkResult as BaseMkResult } from '@/lib/vote-cache';
import { VOTE_RESULT_COLORS } from '@/lib/vote-utils';

type MkResult = BaseMkResult & { slug?: string | null };

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const RESULT_COLORS = VOTE_RESULT_COLORS;

type CoalitionFilter = 'all' | 'coalition' | 'opposition';
type SortBy = 'party' | 'name' | 'result';

function formatDate(iso: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
}

interface CoalitionBarProps {
  label: string;
  data: { for: number; against: number; abstain: number };
  colorFor: string;
  colorAgainst: string;
  labelClass: string;
}

function CoalitionBar({ label, data, colorFor, colorAgainst, labelClass }: CoalitionBarProps) {
  const total = data.for + data.against + data.abstain;
  const active = data.for + data.against;
  const forPct = active > 0 ? Math.round((data.for / active) * 100) : 0;
  const againstPct = active > 0 ? 100 - forPct : 0;

  return (
    <div className="flex items-center gap-3">
      <span className={`w-16 shrink-0 text-[11px] font-black ${labelClass}`}>{label}</span>
      <div className="flex-1 flex h-2 rounded-full overflow-hidden bg-black/8 min-w-0">
        <div className={`${colorFor} h-full transition-all`} style={{ width: `${forPct}%` }} />
        <div className={`${colorAgainst} h-full transition-all`} style={{ width: `${againstPct}%` }} />
      </div>
      <span className="shrink-0 text-[11px] font-medium text-gray-500 whitespace-nowrap">
        <span className="text-teal-700 font-black">{data.for}</span>
        {' בעד · '}
        <span className="text-rose-600 font-black">{data.against}</span>
        {' נגד'}
        {data.abstain > 0 && <span className="text-gray-400"> · {data.abstain} נמנע</span>}
        {total === 0 && <span className="text-gray-400">אין נתונים</span>}
      </span>
    </div>
  );
}

export default function VoteDetailClient({ voteId }: { voteId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [mkResults, setMkResults] = useState<MkResult[]>([]);
  const [microAgenda, setMicroAgenda] = useState<string | null>(null);
  const [macroAgenda, setMacroAgenda] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [coalFilter, setCoalFilter] = useState<CoalitionFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('party');
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);

  function handleCopyLink() {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${BASE_PATH}/api/vote/${voteId}`)
      .then(r => r.json())
      .then(json => {
        if (json.error) throw new Error(json.error);
        setTitle(json.title ?? '');
        setDate(json.date ?? '');
        setMkResults(json.mkResults ?? []);
        setMicroAgenda(json.microAgenda ?? null);
        setMacroAgenda(json.macroAgenda ?? null);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [voteId]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { 'בעד': 0, 'נגד': 0, 'נמנע': 0, 'נוכח': 0 };
    for (const r of mkResults) {
      if (r.result in c) c[r.result]++;
    }
    return c;
  }, [mkResults]);

  const coalitionBreakdown = useMemo(() => {
    const coal = { for: 0, against: 0, abstain: 0 };
    const oppo = { for: 0, against: 0, abstain: 0 };
    for (const r of mkResults) {
      if (r.isCoalition === true) {
        if (r.result === 'בעד') coal.for++;
        else if (r.result === 'נגד') coal.against++;
        else if (r.result === 'נמנע') coal.abstain++;
      } else if (r.isCoalition === false) {
        if (r.result === 'בעד') oppo.for++;
        else if (r.result === 'נגד') oppo.against++;
        else if (r.result === 'נמנע') oppo.abstain++;
      }
    }
    const hasData = coal.for + coal.against + oppo.for + oppo.against > 0;
    return hasData ? { coalition: coal, opposition: oppo } : null;
  }, [mkResults]);

  const filtered = useMemo(() => {
    let list = mkResults;
    if (coalFilter === 'coalition') list = list.filter(r => r.isCoalition === true);
    if (coalFilter === 'opposition') list = list.filter(r => r.isCoalition === false);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(r =>
        `${r.firstName} ${r.lastName}`.toLowerCase().includes(q) ||
        (r.party ?? '').toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      if (sortBy === 'name') return a.lastName.localeCompare(b.lastName, 'he');
      if (sortBy === 'result') return a.result.localeCompare(b.result, 'he');
      // party: coalition first, then by party name
      if (a.isCoalition !== b.isCoalition) return (b.isCoalition ? 1 : 0) - (a.isCoalition ? 1 : 0);
      return (a.party ?? '').localeCompare(b.party ?? '', 'he');
    });
  }, [mkResults, coalFilter, search, sortBy]);

  function handleBack() {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push('/');
    }
  }

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-4xl mx-auto px-4 py-8">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-1 text-sm text-gray-400 mb-4">
          <Link href="/" className="font-black hover:text-black transition-colors">ראשי</Link>
          <span className="mx-1">›</span>
          <span className="text-black font-black">{title || `הצבעה ${voteId}`}</span>
        </nav>

        {/* Header */}
        <div className="flex items-start gap-4 mb-8">
          <div className="flex-1 min-w-0">
            {loading ? (
              <div className="h-6 bg-gray-100 rounded animate-pulse w-64" />
            ) : (
              <>
                <h1 className="text-xl font-black leading-snug">{title || `הצבעה ${voteId}`}</h1>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  {date && (
                    <span className="text-[11px] text-gray-500 font-medium ml-2">{formatDate(date)}</span>
                  )}
                  {macroAgenda && (
                    <span className="text-[11px] font-black text-white bg-black/60 px-2 py-0.5 rounded-full">{macroAgenda}</span>
                  )}
                  {microAgenda && (
                    <span className="text-[11px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">#{microAgenda}</span>
                  )}
                </div>
              </>
            )}
          </div>
          <button
            onClick={handleCopyLink}
            title="העתק קישור"
            className="shrink-0 flex items-center gap-1.5 text-xs font-black px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 transition-colors text-gray-600"
          >
            {copied ? (
              <>
                <svg className="w-3.5 h-3.5 text-teal-600" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m3 8 4 4 6-8"/></svg>
                <span className="text-teal-600">הועתק</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="5" y="5" width="8" height="9" rx="1.5"/><path d="M3 11V3a1 1 0 0 1 1-1h8"/>
                </svg>
                <span>שתף</span>
              </>
            )}
          </button>
        </div>

        {loading && (
          <div className="py-32 text-center text-xl font-black animate-pulse opacity-20">טוען תוצאות...</div>
        )}

        {error && (
          <div className="p-8 text-center text-red-600 font-black">{error}</div>
        )}

        {!loading && !error && (
          <>
            {/* Summary badges */}
            <div className="flex flex-wrap gap-2 mb-4">
              {(['בעד', 'נגד', 'נמנע', 'נוכח'] as const).map(r => (
                <span key={r} className={`text-xs font-black px-3 py-1.5 rounded-full ${RESULT_COLORS[r]}`}>
                  {r} ({counts[r]})
                </span>
              ))}
            </div>

            {/* Coalition / opposition breakdown */}
            {coalitionBreakdown && (
              <div className="mb-6 rounded-xl border border-black/8 bg-gray-50 px-4 py-3 flex flex-col gap-2.5">
                <CoalitionBar
                  label="קואליציה"
                  data={coalitionBreakdown.coalition}
                  colorFor="bg-teal-500"
                  colorAgainst="bg-rose-400"
                  labelClass="text-teal-800"
                />
                <CoalitionBar
                  label="אופוזיציה"
                  data={coalitionBreakdown.opposition}
                  colorFor="bg-teal-500"
                  colorAgainst="bg-rose-400"
                  labelClass="text-slate-600"
                />
              </div>
            )}

            {/* Controls */}
            <div className="flex flex-wrap gap-3 items-center mb-4">
              {/* Coalition filter */}
              <div className="flex gap-1">
                {([['all', 'הכל'], ['coalition', 'קואליציה'], ['opposition', 'אופוזיציה']] as [CoalitionFilter, string][]).map(([f, label]) => (
                  <button
                    key={f}
                    onClick={() => setCoalFilter(f)}
                    className={`text-xs font-black px-2.5 py-1 rounded-full transition-colors ${
                      coalFilter === f
                        ? f === 'coalition' ? 'bg-[#16A34A] text-white'
                          : f === 'opposition' ? 'bg-[#2563EB] text-white'
                          : 'bg-black text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Sort */}
              <div className="flex gap-1 items-center">
                <span className="text-[11px] font-black uppercase text-gray-400">מיון:</span>
                {([['party', 'סיעה'], ['name', 'שם'], ['result', 'תוצאה']] as [SortBy, string][]).map(([s, label]) => (
                  <button
                    key={s}
                    onClick={() => setSortBy(s)}
                    className={`text-xs font-black px-2 py-1 rounded transition-colors ${sortBy === s ? 'bg-black text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Search */}
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם או סיעה..."
              className="w-full mb-4 px-4 py-2 text-sm border border-black/10 rounded-lg bg-gray-50 focus:outline-none focus:ring-1 focus:ring-black/20"
            />

            {/* Results list */}
            <div className="flex flex-col gap-1">
              {filtered.length === 0 ? (
                <div className="py-16 text-center text-gray-400 font-black">אין תוצאות</div>
              ) : filtered.map(r => (
                <div
                  key={r.mkId}
                  className={`flex items-center gap-3 py-2.5 px-4 rounded-xl text-sm ${r.isCoalition === true ? 'bg-[#F0FDF4]/50' : r.isCoalition === false ? 'bg-[#EFF6FF]/50' : 'bg-gray-50'}`}
                >
                  <span className={`shrink-0 text-[11px] font-black px-2 py-0.5 rounded-full ${RESULT_COLORS[r.result] ?? 'bg-zinc-100 text-zinc-500'}`}>
                    {r.result}
                  </span>
                  {r.slug || r.mkId ? (
                    <Link href={`/mk/${r.slug ?? r.mkId}`} className="font-bold hover:text-teal-700 transition-colors">
                      {r.firstName} {r.lastName}
                    </Link>
                  ) : (
                    <span className="font-bold">{r.firstName} {r.lastName}</span>
                  )}
                  <span className="text-xs text-gray-500 font-medium mr-auto">{r.party ?? '—'}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
