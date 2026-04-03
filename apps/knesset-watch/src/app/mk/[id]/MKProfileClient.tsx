'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import MKAgendaView from './MKAgendaView';
import PresenceHeatmap from '@/components/PresenceHeatmap';
import { VOTE_RESULT_COLORS, CODE_TO_LABEL } from '@/lib/vote-utils';
import { usePeriod, periodToDateRange } from '@/lib/period-context';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

type TabView = 'overview' | 'votes' | 'bills' | 'queries' | 'positions' | 'agenda';

// ── Types ─────────────────────────────────────────────────────────────────────

interface VoteStats {
  total: number;
  forCount: number;
  againstCount: number;
  abstainCount: number;
  presentCount: number;
  absenceCount: number;
}

interface BillSummary {
  billId: number;
  title: string;
  subtype: string;
  isPassed: boolean;
  committeeId: number | null;
  committeeName: string | null;
  summary: string | null;
  docUrl: string | null;
  microAgenda: string | null;
  macroAgenda: string | null;
  initDate: string | null;
}

interface BillTopic {
  committeeName: string;
  total: number;
  passed: number;
}

interface QuerySummary {
  queryId: number;
  title: string;
  submitDate: string;
}

interface PositionSummary {
  id: number;
  dutyDesc: string | null;
  committeeId: number | null;
  committee: string | null;
  ministryId: number | null;
  ministry: string | null;
  startDate: string;
  finishDate: string | null;
  isCurrent: boolean;
}

interface MkVoteRow {
  voteId: number;
  title: string;
  date: string;
  resultCode: number;
  isPassed: boolean;
  totalFor: number;
  totalAgainst: number;
  microAgenda: string | null;
  macroAgenda: string | null;
}

interface ProfileData {
  firstName: string;
  lastName: string;
  factionName: string | null;
  isCoalition: boolean | null;
  voteStats: VoteStats | null;
  majorityAlignment: number | null;
  bills: BillSummary[];
  billTopics: BillTopic[];
  queries: QuerySummary[];
  positions: PositionSummary[];
  agendaStats: AgendaStat[];
  committeeActivity: CommitteeActivityItem[];
  withMajorityVotes: MkVoteRow[];
  rebellionCount?: number;
  totalPartisanVotes?: number;
  attendanceCount?: number;
  totalRelevantSessions?: number;
  rebelledVotes?: Array<{ voteId: number; title: string; date: string; resultCode: number; factionMajority: number }>;
}

interface AgendaStat {
  macroAgenda: string;
  pushedCount: number;
  supportedCount: number;
}

interface CommitteeActivityItem {
  committeeName: string;
  sessionCount: number;
  recentSessions: Array<{ id: number; date: string; title: string | null }>;
}

interface MkVote {
  voteId: number;
  title: string;
  date: string;
  resultCode: number | null;
  resultLabel: string;
  isPassed: boolean | null;
  totalFor: number | null;
  totalAgainst: number | null;
  microAgenda: string | null;
  macroAgenda: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RESULT_COLORS = VOTE_RESULT_COLORS;

const TABS: Array<[TabView, string]> = [
  ['overview', 'סקירה'],
  ['votes', 'הצבעות'],
  ['bills', 'חוקים'],
  ['queries', 'שאילתות'],
  ['positions', 'תפקידים'],
  ['agenda', 'אג\'נדה'],
];

const PAGE_SIZE = 100;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('he-IL', {
    day: 'numeric', month: 'short', year: '2-digit',
  });
}

function formatYear(iso: string): string {
  if (!iso) return '';
  return new Date(iso).getFullYear().toString();
}

// ── Sub-components ────────────────────────────────────────────────────────────

function VoteBreakdownBar({ stats }: { stats: VoteStats }) {
  const { total, forCount, againstCount, abstainCount, presentCount } = stats;
  if (total === 0) return null;

  const segments = [
    { count: forCount,     color: '#16A34A', label: 'בעד' },
    { count: againstCount, color: '#DC2626', label: 'נגד' },
    { count: abstainCount, color: '#D97706', label: 'נמנע' },
    { count: presentCount, color: '#9CA3AF', label: 'נוכח' },
  ].filter(s => s.count > 0);

  return (
    <div>
      <div className="flex h-5 rounded-lg overflow-hidden gap-0.5">
        {segments.map(s => (
          <div
            key={s.label}
            title={`${s.label}: ${s.count.toLocaleString()}`}
            style={{ width: `${(s.count / total) * 100}%`, backgroundColor: s.color }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2.5">
        {segments.map(s => (
          <span key={s.label} className="text-xs font-black tabular-nums" style={{ color: s.color }}>
            {s.count.toLocaleString()} <span className="font-bold opacity-80">{s.label}</span>
          </span>
        ))}
        <span className="text-xs text-gray-500 font-medium">סה"כ {total.toLocaleString()} הצבעות</span>
      </div>
    </div>
  );
}

function AlignmentCard({ pct, total }: { pct: number; total: number }) {
  const isHigh = pct >= 50;
  const color = isHigh ? '#16A34A' : '#2563EB';
  return (
    <div>
      <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-2">מיקום מול הרוב</div>
      <div className="text-4xl font-black tabular-nums leading-none" style={{ color }}>{pct}%</div>
      <div className="text-xs text-gray-500 mt-1">הצביע עם הצד המנצח</div>
      <div className="mt-3 h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <div className="text-[11px] text-gray-500 mt-1.5 tabular-nums">
        מתוך {total.toLocaleString()} הצבעות בעד/נגד
      </div>
    </div>
  );
}

function BillsCard({ bills }: { bills: BillSummary[] }) {
  const passed = bills.filter(b => b.isPassed).length;
  const ratio = bills.length > 0 ? Math.round((passed / bills.length) * 100) : 0;
  return (
    <div>
      <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-2">הצעות חוק</div>
      <div className="text-4xl font-black tabular-nums leading-none">{bills.length.toLocaleString()}</div>
      <div className="text-xs text-gray-500 mt-1">הוגשו בכנסת 25</div>
      {bills.length > 0 && (
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-xl font-black text-teal-600 tabular-nums">{passed}</span>
          <span className="text-xs text-gray-500">עברו ({ratio}%)</span>
        </div>
      )}
    </div>
  );
}

function CurrentPositions({ positions }: { positions: PositionSummary[] }) {
  const current = positions.filter(p => p.isCurrent);
  if (current.length === 0) return null;

  return (
    <div>
      <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-3">תפקידים נוכחיים</div>
      <div className="flex flex-col gap-2">
        {current.map(p => {
          const label = p.dutyDesc && p.committee
            ? `${p.dutyDesc}, ${p.committee}`
            : p.committee || p.ministry || p.dutyDesc || 'ח"כ';
          return (
            <div key={p.id} className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-black shrink-0" />
              <span className="text-sm font-bold text-gray-800 leading-snug">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgendaFingerprint({ stats }: { stats: AgendaStat[] }) {
  if (stats.length === 0) return null;
  const max = Math.max(...stats.map(s => s.pushedCount + s.supportedCount));

  return (
    <div>
      <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-4">טביעת אצבע פרלמנטרית</div>
      <div className="flex flex-col gap-4">
        {stats.slice(0, 8).map(s => (
          <div key={s.macroAgenda}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-black text-gray-800">{s.macroAgenda}</span>
              <div className="flex gap-2 text-[11px] font-bold uppercase">
                {s.pushedCount > 0 && (
                  <span className="text-teal-600">דוחף ({s.pushedCount})</span>
                )}
                {s.supportedCount > 0 && (
                  <span className="text-blue-600">תומך ({s.supportedCount})</span>
                )}
              </div>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden flex">
              <div
                className="h-full bg-teal-500"
                style={{ width: `${(s.pushedCount / max) * 100}%` }}
              />
              <div
                className="h-full bg-blue-400"
                style={{ width: `${(s.supportedCount / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-4 text-[11px] font-black text-gray-400 uppercase">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-teal-500" />
          <span>דחיפה (הצעות חוק)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-blue-400" />
          <span>תמיכה (הצבעות בעד)</span>
        </div>
      </div>
    </div>
  );
}

// ── Forensic Investigation insights (Rebellion, Attendance) ──────────────────

function ForensicInsightsCard({
  rebellions, totalPartisanVotes, attendance, totalRelevantSessions, rebelledVotes,
}: {
  rebellions: number;
  totalPartisanVotes: number;
  attendance: number;
  totalRelevantSessions: number;
  rebelledVotes: Array<{ voteId: number; title: string; date: string; resultCode: number; factionMajority: number }>;
}) {
  const [showRebelled, setShowRebelled] = useState(false);
  const rebellionRate = totalPartisanVotes > 0
    ? ((rebellions / totalPartisanVotes) * 100).toFixed(1)
    : null;
  const attendanceRate = totalRelevantSessions > 0
    ? Math.round((attendance / totalRelevantSessions) * 100)
    : null;

  return (
    <div className="bg-orange-50/50 border border-orange-100 p-6 rounded-2xl">
      <div className="text-[11px] font-black text-orange-400 uppercase tracking-wide mb-4 flex items-center gap-2">
        <span className="w-2 h-2 bg-orange-400 rounded-full animate-pulse"></span>
        ניתוח פורנזי
      </div>
      <div className="grid grid-cols-2 gap-6 text-right">
        <div>
          <span className="block text-3xl font-black text-orange-600">{rebellions}</span>
          <span className="text-[11px] font-black text-orange-400 uppercase leading-tight block mt-1">הצבעות נגד הסיעה</span>
          {rebellionRate !== null && (
            <p className="text-[11px] text-orange-400 mt-1 font-black">
              {rebellionRate}% מתוך {totalPartisanVotes.toLocaleString()} הצבעות בעד/נגד
            </p>
          )}
          {rebelledVotes.length > 0 && (
            <button
              onClick={() => setShowRebelled(v => !v)}
              className="text-[11px] font-black text-orange-500 hover:text-orange-700 mt-2 underline underline-offset-2"
            >
              {showRebelled ? '▲ הסתר' : `▼ הצג הצבעות (${rebelledVotes.length})`}
            </button>
          )}
        </div>
        <div className="border-r border-orange-100 pr-6">
          <span className="block text-3xl font-black text-gray-900">{attendance}</span>
          <span className="text-[11px] font-black text-gray-400 uppercase leading-tight block mt-1">נוכחות בוועדות</span>
          {attendanceRate !== null ? (
            <p className="text-[11px] text-gray-500 mt-1 font-black">
              {attendanceRate}% מתוך {totalRelevantSessions} ישיבות
            </p>
          ) : (
            <p className="text-[11px] text-gray-500 mt-1 font-medium">ישיבות שתועדה בהן נוכחות</p>
          )}
        </div>
      </div>
      {showRebelled && rebelledVotes.length > 0 && (
        <div className="mt-4 border-t border-orange-100 pt-4 flex flex-col gap-1.5">
          {rebelledVotes.map(v => (
            <Link key={v.voteId} href={`/vote/${v.voteId}`}
              className="flex items-start gap-2 px-3 py-2 rounded-xl bg-white hover:bg-orange-50 transition-colors">
              <span className={`shrink-0 mt-0.5 text-[11px] font-black px-2 py-0.5 rounded-full ${RESULT_COLORS[CODE_TO_LABEL[v.resultCode]] ?? 'bg-zinc-100 text-zinc-500'}`}>
                {CODE_TO_LABEL[v.resultCode]}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-gray-800 leading-snug line-clamp-2">{v.title}</p>
                <span className="text-[11px] text-gray-500">{v.date?.slice(0, 10)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Legislative focus (bill topics by committee) ──────────────────────────────

function BillTopicsCard({ topics, accentColor, onNavigate }: {
  topics: BillTopic[];
  accentColor: string;
  onNavigate: () => void;
}) {
  if (topics.length === 0) return null;
  const maxTotal = topics[0].total;
  const shown = topics.slice(0, 6);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide">תחומי חקיקה</div>
        <button
          onClick={onNavigate}
          className="text-xs font-black text-gray-500 hover:text-black transition-colors"
        >
          כל החוקים ←
        </button>
      </div>
      <div className="flex flex-col gap-2.5">
        {shown.map(t => (
          <div key={t.committeeName}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-sm font-bold text-gray-800">{t.committeeName}</span>
              <span className="text-xs text-gray-500 tabular-nums">
                {t.total}
                {t.passed > 0 && (
                  <span className="text-teal-600 font-black"> · {t.passed} עברו</span>
                )}
              </span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${(t.total / maxTotal) * 100}%`, backgroundColor: accentColor, opacity: 0.7 }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Hebrew query topic clustering ─────────────────────────────────────────────

const HEBREW_STOP_WORDS = new Set([
  'של','את','על','אל','עם','כי','לא','הם','הן','הוא','היא','זה','זו','אנו',
  'אני','אתה','אתם','אנחנו','יש','אין','כל','עוד','גם','רק','אם','אך','אבל',
  'בין','כן','או','היה','היתה','יהיה','להיות','הם','אחד','שני','שלושה','כן',
  'לה','לו','לנו','לכם','לכן','לי','להם','להן','שלה','שלו','שלנו','שלהם',
  'ב','ל','מ','ו','ה','כ','מי','מה','כך','כאן','שם','עוד','כבר','מאוד',
  'לפי','לגבי','בנוגע','בעניין','בדבר','בקשר','ביחס','לענין','בנושא',
]);

function extractQueryTopics(queries: QuerySummary[]): Array<{ word: string; count: number }> {
  const freq = new Map<string, number>();
  for (const q of queries) {
    const words = q.title.split(/[\s,\-–—״׳"'()[\]]+/).filter(w => w.length >= 3);
    const seen = new Set<string>();
    for (const w of words) {
      if (seen.has(w) || HEBREW_STOP_WORDS.has(w)) continue;
      seen.add(w);
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  return Array.from(freq.entries())
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([word, count]) => ({ word, count }));
}

// ── Vote result filter button ─────────────────────────────────────────────────

type ResultFilter = 'all' | 'בעד' | 'נגד' | 'נמנע' | 'נוכח' | 'עם-הרוב' | 'rebellions';

// ── Main component ────────────────────────────────────────────────────────────

export default function MKProfileClient({ mkId }: { mkId: string }) {
  const router = useRouter();
  const { period } = usePeriod();
  const [tab, setTab] = useState<TabView>('overview');

  // Profile data (bills, queries, positions, stats)
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Votes (loaded lazily when votes tab opened)
  const [votes, setVotes] = useState<MkVote[]>([]);
  const [votesLoading, setVotesLoading] = useState(false);
  const [votesLoaded, setVotesLoaded] = useState(false);
  const [votesError, setVotesError] = useState<string | null>(null);

  // Vote tab UI state
  const [voteFilter, setVoteFilter] = useState<ResultFilter>('all');
  const [voteSearch, setVoteSearch] = useState('');
  const [votePage, setVotePage] = useState(1);

  // Bills tab UI state
  const [billSearch, setBillSearch] = useState('');
  const [showPassedOnly, setShowPassedOnly] = useState(false);
  const [committeeFilter, setCommitteeFilter] = useState<string | null>(null);
  const [expandedBills, setExpandedBills] = useState<Set<number>>(new Set());

  // Queries tab UI state
  const [querySearch, setQuerySearch] = useState('');

  // ── Fetch profile data (re-fetch when period changes) ──────────────────────

  useEffect(() => {
    async function loadProfile() {
      setProfileLoading(true);
      setProfileError(null);
      try {
        const params = new URLSearchParams({ mkId });
        const dateRange = periodToDateRange(period);
        if (dateRange) { params.set('from', dateRange.from); params.set('to', dateRange.to); }
        const res = await fetch(`${BASE_PATH}/api/mk-profile?${params}`);
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        setProfile(json);
      } catch (e: any) {
        setProfileError(e.message);
      } finally {
        setProfileLoading(false);
      }
    }
    loadProfile();
  }, [mkId, period]);

  // ── Lazy-load votes when votes tab opens ────────────────────────────────────

  useEffect(() => {
    if (tab !== 'votes' || votesLoaded || votesLoading) return;

    async function loadVotes() {
      setVotesLoading(true);
      setVotesError(null);
      try {
        const res = await fetch(`${BASE_PATH}/api/mk-votes?mkId=${mkId}`);
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        setVotes(json.votes ?? []);
        setVotesLoaded(true);
      } catch (e: any) {
        setVotesError(e.message);
      } finally {
        setVotesLoading(false);
      }
    }
    loadVotes();
  }, [tab, mkId, votesLoaded, votesLoading]);

  // ── Derived state ───────────────────────────────────────────────────────────

  const filteredVotes = useMemo(() => {
    let list = votes;
    if (voteFilter === 'עם-הרוב') {
      list = (profile?.withMajorityVotes ?? []).map(v => ({
        voteId: v.voteId,
        title: v.title,
        date: v.date,
        resultCode: v.resultCode,
        resultLabel: CODE_TO_LABEL[v.resultCode] ?? 'נוכח',
        isPassed: v.isPassed,
        totalFor: v.totalFor,
        totalAgainst: v.totalAgainst,
        microAgenda: v.microAgenda,
        macroAgenda: v.macroAgenda,
      }));
    } else if (voteFilter === 'rebellions') {
      list = (profile?.rebelledVotes ?? []).map(v => ({
        voteId: v.voteId,
        title: v.title,
        date: v.date,
        resultCode: v.resultCode,
        resultLabel: CODE_TO_LABEL[v.resultCode] ?? 'נוכח',
        isPassed: null, // we don't strictly need this for the list item
        totalFor: null,
        totalAgainst: null,
        microAgenda: null,
        macroAgenda: null,
      }));
    } else if (voteFilter !== 'all') {
      list = list.filter(v => {
        const label = v.resultLabel ?? (v.resultCode != null ? CODE_TO_LABEL[v.resultCode] : '');
        return label === voteFilter;
      });
    }
    if (voteSearch.trim()) {
      const q = voteSearch.trim().toLowerCase();
      list = list.filter(v => v.title.toLowerCase().includes(q));
    }
    return list;
  }, [votes, voteFilter, voteSearch, profile?.withMajorityVotes]);

  useEffect(() => { setVotePage(1); }, [voteFilter, voteSearch]);

  const voteCounts = useMemo(() => {
    const c: Record<string, number> = { 'בעד': 0, 'נגד': 0, 'נמנע': 0, 'נוכח': 0 };
    for (const v of votes) {
      const label = v.resultLabel ?? (v.resultCode != null ? CODE_TO_LABEL[v.resultCode] : '');
      if (label in c) c[label]++;
    }
    return c;
  }, [votes]);

  const filteredBills = useMemo(() => {
    let list = profile?.bills ?? [];
    if (showPassedOnly) list = list.filter(b => b.isPassed);
    if (committeeFilter) list = list.filter(b => b.committeeName === committeeFilter);
    if (billSearch.trim()) {
      const q = billSearch.trim().toLowerCase();
      list = list.filter(b => b.title.toLowerCase().includes(q));
    }
    return list;
  }, [profile?.bills, showPassedOnly, committeeFilter, billSearch]);

  const filteredQueries = useMemo(() => {
    if (!querySearch.trim()) return profile?.queries ?? [];
    const q = querySearch.trim().toLowerCase();
    return (profile?.queries ?? []).filter(q2 => q2.title.toLowerCase().includes(q));
  }, [profile?.queries, querySearch]);

  const queryTopics = useMemo(
    () => extractQueryTopics(profile?.queries ?? []),
    [profile?.queries],
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  const mkName = profile
    ? `${profile.firstName} ${profile.lastName}`.trim()
    : profileLoading ? '' : `ח"כ ${mkId}`;

  const isCoalition = profile?.isCoalition;
  const accentColor = isCoalition === true ? '#16A34A' : isCoalition === false ? '#2563EB' : '#000';

  const totalPages = Math.max(1, Math.ceil(filteredVotes.length / PAGE_SIZE));
  const currentVotePage = Math.min(votePage, totalPages);
  const pageVotes = filteredVotes.slice((currentVotePage - 1) * PAGE_SIZE, currentVotePage * PAGE_SIZE);

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-3xl mx-auto px-4 py-8">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="mb-8">
          <button
            onClick={() => window.history.length > 1 ? router.back() : router.push('/')}
            className="text-sm font-black px-3 py-2 rounded border border-black/10 hover:bg-gray-50 transition-colors mb-5"
          >
            → חזרה
          </button>

          {profileLoading ? (
            <div className="h-9 w-48 bg-gray-100 rounded animate-pulse" />
          ) : (
            <>
              <h1 className="text-3xl font-black leading-tight">{mkName || `ח"כ ${mkId}`}</h1>
              <div className="flex items-center gap-2 flex-wrap mt-2">
                {profile?.factionName && (
                  <Link
                    href={`/faction/${encodeURIComponent(profile.factionName)}`}
                    className="text-sm font-bold text-gray-500 hover:text-teal-700 transition-colors"
                  >
                    {profile.factionName}
                  </Link>
                )}
                {isCoalition !== null && isCoalition !== undefined && (
                  <span
                    className="text-[11px] font-black px-2.5 py-0.5 rounded-full"
                    style={{ backgroundColor: accentColor, color: '#fff' }}
                  >
                    {isCoalition ? 'קואליציה' : 'אופוזיציה'}
                  </span>
                )}
              </div>

              {/* Quick stats */}
              {profile && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-gray-500 font-medium">
                  {profile.voteStats && (
                    <span className="tabular-nums">{profile.voteStats.total.toLocaleString()} הצבעות</span>
                  )}
                  {profile.voteStats?.absenceCount != null && profile.voteStats.absenceCount > 0 && (
                    <span className="tabular-nums text-rose-400">{profile.voteStats.absenceCount.toLocaleString()} היעדרויות</span>
                  )}
                  <span className="tabular-nums">{profile.bills.length.toLocaleString()} הצ"ח</span>
                  <span className="tabular-nums">{profile.queries.length.toLocaleString()} שאילתות</span>
                  <span className="tabular-nums">{profile.positions.length} תפקידים</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Tab bar ─────────────────────────────────────────────────────── */}
        <div className="flex gap-1 mb-6 border-b border-black/8 overflow-x-auto scrollbar-none pb-px">
          {TABS.map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`shrink-0 text-xs font-black px-4 py-2 rounded-lg transition-colors ${
                tab === t ? 'bg-black text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Error state ─────────────────────────────────────────────────── */}
        {profileError && (
          <div className="p-6 rounded-xl bg-red-50 text-red-700 text-sm font-bold mb-6">{profileError}</div>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* Overview Tab                                                       */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {tab === 'overview' && (
          <div className="flex flex-col gap-5">

            {/* Vote breakdown */}
            {profileLoading ? (
              <div className="rounded-2xl border border-black/8 p-6">
                <div className="h-5 bg-gray-100 rounded animate-pulse mb-3" />
                <div className="h-3 w-64 bg-gray-100 rounded animate-pulse" />
              </div>
            ) : profile?.voteStats ? (
              <div className="rounded-2xl border border-black/8 p-6">
                <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-4">תמהיל הצבעות</div>
                <VoteBreakdownBar stats={profile.voteStats} />
              </div>
            ) : null}

            {/* Bills + alignment cards */}
            {!profileLoading && profile && (
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-2xl border border-black/8 p-5">
                  <BillsCard bills={profile.bills} />
                </div>
                {profile.majorityAlignment != null && profile.voteStats && (
                  <div className="rounded-2xl border border-black/8 p-5">
                    <AlignmentCard
                      pct={profile.majorityAlignment}
                      total={profile.voteStats.forCount + profile.voteStats.againstCount}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Queries / positions / absence grid */}
            {!profileLoading && profile && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="rounded-2xl border border-black/8 p-5">
                  <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-2">שאילתות</div>
                  <div className="text-4xl font-black tabular-nums leading-none">{profile.queries.length.toLocaleString()}</div>
                  <div className="text-xs text-gray-500 mt-1">לממשלה</div>
                </div>
                <div className="rounded-2xl border border-black/8 p-5">
                  <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-2">תפקידים</div>
                  <div className="text-4xl font-black tabular-nums leading-none">{profile.positions.length}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {profile.positions.filter(p => p.isCurrent).length} נוכחיים
                  </div>
                </div>
                {profile.voteStats && profile.voteStats.absenceCount > 0 && (
                  <div className="rounded-2xl border border-black/8 p-5">
                    <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-2">היעדרויות</div>
                    <div className="text-4xl font-black tabular-nums leading-none text-rose-500">
                      {profile.voteStats.absenceCount.toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {Math.round((profile.voteStats.absenceCount / (profile.voteStats.total + profile.voteStats.absenceCount)) * 100)}% מכל ההצבעות
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Current positions */}
            {!profileLoading && profile && profile.positions.filter(p => p.isCurrent).length > 0 && (
              <div className="rounded-2xl border border-black/8 p-6">
                <CurrentPositions positions={profile.positions} />
              </div>
            )}

            {/* Forensic analysis */}
            {!profileLoading && profile && (
              <div className="flex flex-col gap-4">
                <ForensicInsightsCard
                  rebellions={profile.rebellionCount ?? 0}
                  totalPartisanVotes={profile.totalPartisanVotes ?? 0}
                  attendance={profile.attendanceCount ?? 0}
                  totalRelevantSessions={profile.totalRelevantSessions ?? 0}
                  rebelledVotes={profile.rebelledVotes ?? []}
                />
                <PresenceHeatmap mkId={mkId} />
              </div>
            )}

            {/* Committee session activity */}
            {!profileLoading && profile && profile.committeeActivity?.length > 0 && (
              <div className="rounded-2xl border border-black/8 p-6">
                <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-4">פעילות בוועדות</div>
                <div className="flex flex-col gap-4">
                  {profile.committeeActivity.map(item => (
                    <div key={item.committeeName}>
                      <div className="flex items-center justify-between mb-1.5">
                        <Link
                          href={`/committee/${encodeURIComponent(item.committeeName)}`}
                          className="text-sm font-black text-teal-700 hover:text-teal-900 transition-colors"
                        >
                          {item.committeeName}
                        </Link>
                        <span className="text-xs text-gray-500 tabular-nums font-bold">{item.sessionCount} ישיבות</span>
                      </div>
                      {item.recentSessions.length > 0 && (
                        <div className="flex flex-col gap-1 mr-1">
                          {item.recentSessions.map(s => (
                            <Link
                              key={s.id}
                              href={`/session/${s.id}`}
                              className="flex items-center gap-2 text-[11px] text-gray-500 hover:text-gray-900 transition-colors"
                            >
                              <span className="text-gray-300 shrink-0">·</span>
                              <span className="text-gray-400 shrink-0 tabular-nums">{s.date?.slice(0, 10)}</span>
                              <span className="truncate">{s.title ?? 'ישיבה'}</span>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Legislative focus */}
            {!profileLoading && profile && profile.agendaStats.length > 0 && (
              <div className="rounded-2xl border border-black/8 p-6">
                <AgendaFingerprint stats={profile.agendaStats} />
              </div>
            )}

            {/* Bill topics focus (legacy) */}
            {!profileLoading && profile && profile.billTopics.length > 0 && (
              <div className="rounded-2xl border border-black/8 p-6">
                <BillTopicsCard
                  topics={profile.billTopics}
                  accentColor={accentColor}
                  onNavigate={() => { setTab('bills'); setCommitteeFilter(null); }}
                />
              </div>
            )}

            {/* Passed bills */}
            {!profileLoading && profile && profile.bills.filter(b => b.isPassed).length > 0 && (
              <div className="rounded-2xl border border-black/8 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide">חוקים שעברו</div>
                  <button
                    onClick={() => { setTab('bills'); setShowPassedOnly(true); }}
                    className="text-xs font-black text-gray-500 hover:text-black transition-colors"
                  >
                    הצג הכל ←
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  {profile.bills.filter(b => b.isPassed).slice(0, 5).map(b => {
                    const isExpanded = expandedBills.has(b.billId);
                    const toggleExpand = () => setExpandedBills(prev => {
                      const next = new Set(prev);
                      if (next.has(b.billId)) next.delete(b.billId); else next.add(b.billId);
                      return next;
                    });
                    return (
                      <div key={b.billId} className="rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                        <div className="flex items-start gap-2 px-3 py-2">
                          <span className="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-teal-500" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-sm font-bold text-gray-800 leading-snug">{b.title}</span>
                              <div className="flex items-center gap-1 shrink-0">
                                {b.docUrl && (
                                  <a href={b.docUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] font-black text-gray-400 hover:text-black border border-gray-200 hover:border-gray-400 px-1.5 py-0.5 rounded transition-colors">PDF</a>
                                )}
                                {b.summary && (
                                  <button onClick={toggleExpand} className="text-[11px] font-black text-gray-400 hover:text-black border border-gray-200 hover:border-gray-400 px-1.5 py-0.5 rounded transition-colors">
                                    {isExpanded ? '▲' : '▼'}
                                  </button>
                                )}
                              </div>
                            </div>
                            {b.initDate && (
                              <span className="text-[11px] text-gray-500">{b.initDate}</span>
                            )}
                          </div>
                        </div>
                        {b.summary && isExpanded && (
                          <div className="px-3 pb-2 border-t border-black/5 pt-2">
                            <p className="text-xs text-gray-600 leading-relaxed">{b.summary}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Crossed the aisle — votes where MK voted with the majority */}
            {!profileLoading && profile && profile.withMajorityVotes.length > 0 && (
              <div className="rounded-2xl border border-black/8 p-6">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide">
                    {profile.isCoalition === false ? 'הצבעות עם הרוב (חריגות)' : 'הצבעות עם הרוב'}
                  </div>
                  <button
                    onClick={() => { setTab('votes'); setVoteFilter('עם-הרוב'); }}
                    className="text-xs font-black text-gray-500 hover:text-black transition-colors"
                  >
                    הצג הכל ←
                  </button>
                </div>
                <p className="text-xs text-gray-500 mb-4">
                  {profile.isCoalition === false
                    ? `${profile.withMajorityVotes.length} פעמים הצביע${profile.firstName.endsWith('ה') ? 'ה' : ''} עם הצד המנצח — בעד כשעבר, נגד כשנכשל`
                    : `${profile.withMajorityVotes.length} הצבעות עם הרוב`}
                </p>
                <div className="flex flex-col gap-1.5">
                  {profile.withMajorityVotes.slice(0, 5).map(v => (
                    <div key={v.voteId} className="flex items-start gap-3 px-3 py-2.5 rounded-xl bg-gray-50">
                      <span className={`shrink-0 mt-0.5 text-[11px] font-black px-2 py-0.5 rounded-full ${RESULT_COLORS[CODE_TO_LABEL[v.resultCode]] ?? 'bg-zinc-100 text-zinc-500'}`}>
                        {CODE_TO_LABEL[v.resultCode]}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-bold text-gray-800 leading-snug">{v.title}</span>
                        <div className="flex gap-2 mt-1 flex-wrap">
                          {v.macroAgenda && (
                            <span className="text-[11px] font-black text-white bg-black/60 px-1.5 py-0.5 rounded-full">{v.macroAgenda}</span>
                          )}
                          {v.microAgenda && (
                            <span className="text-[11px] font-bold text-gray-500 bg-gray-200/50 px-1.5 py-0.5 rounded-full">#{v.microAgenda}</span>
                          )}
                        </div>
                      </div>
                      <span className="shrink-0 text-[11px] text-gray-500 tabular-nums">
                        {new Date(v.date).toLocaleDateString('he-IL', { month: 'short', year: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Agenda teaser */}
            {!profileLoading && (
              <div className="rounded-2xl border border-black/8 overflow-hidden">
                <div className="flex items-center justify-between px-6 pt-5 pb-3">
                  <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide">אג&apos;נדה ועמדות</div>
                  <button
                    onClick={() => setTab('agenda')}
                    className="text-xs font-black text-gray-500 hover:text-black transition-colors"
                  >
                    הצג הכל ←
                  </button>
                </div>
                <div className="px-6 pb-5">
                  <MKAgendaView mkId={mkId} limit={3} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* Votes Tab                                                          */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {tab === 'votes' && (
          <>
            {votesLoading && (
              <div className="py-32 text-center text-xl font-black animate-pulse opacity-20">טוען הצבעות...</div>
            )}
            {votesError && (
              <div className="p-6 rounded-xl bg-red-50 text-red-700 text-sm font-bold">{votesError}</div>
            )}
            {!votesLoading && !votesError && votesLoaded && (
              <>
                {/* Filter badges */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {(['all', 'בעד', 'נגד', 'נמנע', 'נוכח', 'עם-הרוב', 'rebellions'] as ResultFilter[]).map(f => {
                    const count = f === 'all' ? votes.length
                      : f === 'עם-הרוב' ? (profile?.withMajorityVotes.length ?? 0)
                      : f === 'rebellions' ? (profile?.rebellionCount ?? 0)
                      : voteCounts[f];
                    const active = voteFilter === f;
                    const colorCls = f === 'all'
                      ? active ? 'bg-black text-white' : 'bg-zinc-100 text-zinc-700'
                      : f === 'עם-הרוב'
                        ? active ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700'
                      : f === 'rebellions'
                        ? active ? 'bg-orange-600 text-white' : 'bg-orange-50 text-orange-700'
                        : active ? RESULT_COLORS[f] : 'bg-zinc-100 text-zinc-600';
                    return (
                      <button
                        key={f}
                        onClick={() => setVoteFilter(f)}
                        className={`text-xs font-black px-3 py-2 rounded-full transition-colors ${colorCls}`}
                      >
                        {f === 'all' ? 'הכל' : f === 'עם-הרוב' ? 'עם הרוב' : f === 'rebellions' ? 'מורדות' : f}{' '}
                        {count > 0 && <span className="opacity-70">({count.toLocaleString()})</span>}
                      </button>
                    );
                  })}
                </div>

                {/* Search */}
                <input
                  type="text"
                  value={voteSearch}
                  onChange={e => setVoteSearch(e.target.value)}
                  placeholder="חיפוש לפי נושא..."
                  className="w-full mb-4 px-4 py-2 text-sm border border-black/10 rounded-lg bg-gray-50 focus:outline-none focus:ring-1 focus:ring-black/20"
                />

                {/* Vote list */}
                <div className="flex flex-col gap-1.5">
                  {pageVotes.length === 0 ? (
                    <div className="py-16 text-center text-gray-400 font-black">אין תוצאות</div>
                  ) : pageVotes.map(v => {
                    const label = v.resultLabel ?? (v.resultCode != null ? CODE_TO_LABEL[v.resultCode] : 'נוכח');
                    return (
                      <div
                        key={v.voteId}
                        className="flex items-start gap-3 py-3 px-4 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors"
                      >
                        {/* MK's vote result */}
                        <span className={`shrink-0 mt-0.5 text-[11px] font-black px-2 py-1 rounded-full ${RESULT_COLORS[label] ?? 'bg-zinc-100 text-zinc-500'}`}>
                          {label}
                        </span>

                        {/* Title */}
                        <div className="flex-1 min-w-0">
                          <Link
                            href={`/vote/${v.voteId}`}
                            prefetch={false}
                            className="text-sm font-bold leading-snug text-gray-900 hover:underline"
                          >
                            {v.title || '—'}
                          </Link>
                          <div className="flex gap-2 mt-1.5 flex-wrap">
                            {v.macroAgenda && (
                              <span className="text-[11px] font-black text-white bg-black/60 px-1.5 py-0.5 rounded-full">{v.macroAgenda}</span>
                            )}
                            {v.microAgenda && (
                              <span className="text-[11px] font-bold text-gray-500 bg-gray-200/50 px-1.5 py-0.5 rounded-full">#{v.microAgenda}</span>
                            )}
                          </div>
                        </div>

                        {/* Vote outcome + date */}
                        <div className="shrink-0 flex flex-col items-end gap-0.5">
                          {v.isPassed !== null && (
                            <span className={`text-[11px] font-black ${v.isPassed ? 'text-teal-600' : 'text-rose-500'}`}>
                              {v.isPassed ? 'עבר' : 'נכשל'}
                            </span>
                          )}
                          <span className="text-[11px] text-gray-500 font-medium tabular-nums">
                            {formatDate(v.date)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-3 mt-8">
                    <button
                      onClick={() => setVotePage(p => Math.max(1, p - 1))}
                      disabled={currentVotePage === 1}
                      className="text-sm font-black px-3 py-1.5 rounded border border-black/10 disabled:opacity-30 hover:bg-gray-50"
                    >
                      הקודם
                    </button>
                    <span className="text-sm font-black text-gray-500">
                      {currentVotePage} / {totalPages}
                    </span>
                    <button
                      onClick={() => setVotePage(p => Math.min(totalPages, p + 1))}
                      disabled={currentVotePage === totalPages}
                      className="text-sm font-black px-3 py-1.5 rounded border border-black/10 disabled:opacity-30 hover:bg-gray-50"
                    >
                      הבא
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* Bills Tab                                                          */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {tab === 'bills' && (
          <>
            {profileLoading ? (
              <div className="py-32 text-center text-xl font-black animate-pulse opacity-20">טוען...</div>
            ) : (
              <>
                {/* Controls */}
                <div className="flex gap-3 mb-4 items-center">
                  <input
                    type="text"
                    value={billSearch}
                    onChange={e => setBillSearch(e.target.value)}
                    placeholder="חיפוש לפי נושא..."
                    className="flex-1 px-4 py-2 text-sm border border-black/10 rounded-lg bg-gray-50 focus:outline-none focus:ring-1 focus:ring-black/20"
                  />
                  <button
                    onClick={() => setShowPassedOnly(v => !v)}
                    className={`text-xs font-black px-3 py-2 rounded-lg transition-colors shrink-0 ${showPassedOnly ? 'bg-[#16A34A] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                  >
                    עברו בלבד
                  </button>
                </div>

                {/* Committee filter chips */}
                {profile && profile.billTopics.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <button
                      onClick={() => setCommitteeFilter(null)}
                      className={`text-xs font-black px-3 py-2 rounded-full transition-colors ${!committeeFilter ? 'bg-black text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                      הכל
                    </button>
                    {profile.billTopics.map(t => (
                      <button
                        key={t.committeeName}
                        onClick={() => setCommitteeFilter(committeeFilter === t.committeeName ? null : t.committeeName)}
                        className={`text-xs font-black px-3 py-2 rounded-full transition-colors ${committeeFilter === t.committeeName ? 'bg-black text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      >
                        {t.committeeName} <span className="opacity-60">({t.total})</span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="text-xs text-gray-500 font-medium mb-3">
                  {filteredBills.length.toLocaleString()} מתוך {(profile?.bills.length ?? 0).toLocaleString()} הצ"ח
                </div>

                <div className="flex flex-col gap-1.5">
                  {filteredBills.length === 0 ? (
                    <div className="py-16 text-center text-gray-400 font-black">אין תוצאות</div>
                  ) : filteredBills.map(b => {
                    const isExpanded = expandedBills.has(b.billId);
                    const toggleExpand = () => setExpandedBills(prev => {
                      const next = new Set(prev);
                      if (next.has(b.billId)) next.delete(b.billId); else next.add(b.billId);
                      return next;
                    });
                    return (
                    <div key={b.billId} className="rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors">
                      <div className="flex items-start gap-3 px-4 py-3">
                        <span className={`shrink-0 mt-0.5 text-[11px] font-black px-2 py-0.5 rounded-full ${b.isPassed ? 'bg-[#16A34A] text-white' : 'bg-gray-200 text-gray-500'}`}>
                          {b.isPassed ? 'עבר' : 'הוגש'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-bold leading-snug text-gray-900">{b.title}</p>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {b.docUrl && (
                                <a
                                  href={b.docUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[11px] font-black text-gray-400 hover:text-black transition-colors border border-gray-200 hover:border-gray-400 px-1.5 py-0.5 rounded"
                                >
                                  PDF
                                </a>
                              )}
                              {b.summary && (
                                <button
                                  onClick={toggleExpand}
                                  className="text-[11px] font-black text-gray-400 hover:text-black transition-colors border border-gray-200 hover:border-gray-400 px-1.5 py-0.5 rounded"
                                >
                                  {isExpanded ? '▲' : '▼'}
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {b.initDate && (
                              <span className="text-[11px] text-gray-500">{b.initDate}</span>
                            )}
                            {b.macroAgenda && (
                              <span className="text-[11px] font-black text-white bg-black px-1.5 py-0.5 rounded-full">{b.macroAgenda}</span>
                            )}
                            {b.microAgenda && (
                              <span className="text-[11px] font-bold text-gray-700 bg-gray-200 px-1.5 py-0.5 rounded-full">#{b.microAgenda}</span>
                            )}
                            {b.committeeName && (
                              <Link href={`/committee/${encodeURIComponent(b.committeeName)}`}
                                className="text-[11px] font-black text-gray-400 border border-gray-200 hover:border-gray-400 px-1.5 py-0.5 rounded-full transition-colors">
                                {b.committeeName}
                              </Link>
                            )}
                            {b.subtype && (
                              <span className="text-xs text-gray-500">{b.subtype}</span>
                            )}
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
              </>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* Queries Tab                                                        */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {tab === 'queries' && (
          <>
            {profileLoading ? (
              <div className="py-32 text-center text-xl font-black animate-pulse opacity-20">טוען...</div>
            ) : (
              <>
                {/* Topic word cloud */}
                {queryTopics.length > 0 && (
                  <div className="rounded-2xl border border-black/8 p-5 mb-5">
                    <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-3">נושאים חוזרים</div>
                    <div className="flex flex-wrap gap-2">
                      {queryTopics.map(({ word, count }) => (
                        <button
                          key={word}
                          onClick={() => setQuerySearch(word)}
                          className="text-sm font-bold px-3 py-1 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
                        >
                          {word}
                          <span className="text-xs text-gray-500 font-medium mr-1">×{count}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <input
                  type="text"
                  value={querySearch}
                  onChange={e => setQuerySearch(e.target.value)}
                  placeholder="חיפוש שאילתא..."
                  className="w-full mb-4 px-4 py-2 text-sm border border-black/10 rounded-lg bg-gray-50 focus:outline-none focus:ring-1 focus:ring-black/20"
                />

                <div className="text-xs text-gray-500 font-medium mb-3">
                  {filteredQueries.length.toLocaleString()} שאילתות
                </div>

                <div className="flex flex-col gap-1.5">
                  {filteredQueries.length === 0 ? (
                    <div className="py-16 text-center text-gray-400 font-black">אין תוצאות</div>
                  ) : filteredQueries.map(q => (
                    <div key={q.queryId} className="flex items-start gap-3 px-4 py-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold leading-snug text-gray-900">{q.title}</p>
                      </div>
                      <span className="shrink-0 text-[11px] text-gray-500 font-medium tabular-nums">
                        {formatDate(q.submitDate)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* Positions Tab                                                      */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {tab === 'positions' && (
          <>
            {profileLoading ? (
              <div className="py-32 text-center text-xl font-black animate-pulse opacity-20">טוען...</div>
            ) : (
              <>
                {profile?.positions.length === 0 && (
                  <div className="py-16 text-center text-gray-400 font-black">אין נתונים</div>
                )}

                {/* Group: current */}
                {(profile?.positions.filter(p => p.isCurrent) ?? []).length > 0 && (
                  <div className="mb-6">
                    <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-3">תפקידים נוכחיים</div>
                    <div className="flex flex-col gap-1.5">
                      {profile!.positions.filter(p => p.isCurrent).map(p => {
                        const role = p.dutyDesc || null;
                        const org = p.committee || p.ministry || null;
                        return (
                          <div key={p.id} className="px-4 py-3 rounded-xl border border-black/8 bg-white">
                            <div className="flex items-start gap-3">
                              <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-black text-white shrink-0 mt-0.5">נוכחי</span>
                              <div>
                                {role && <p className="text-sm font-black leading-snug">{role}</p>}
                                {org && <p className={`text-sm ${role ? 'text-gray-600 font-medium' : 'font-black'} leading-snug`}>{org}</p>}
                                <p className="text-xs text-gray-500 mt-0.5">
                                  מ-{formatDate(p.startDate)}
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Group: historical */}
                {(profile?.positions.filter(p => !p.isCurrent) ?? []).length > 0 && (
                  <div>
                    <div className="text-[11px] font-black text-gray-400 uppercase tracking-wide mb-3">היסטוריה</div>
                    <div className="flex flex-col gap-1.5">
                      {profile!.positions.filter(p => !p.isCurrent).map(p => {
                        const role = p.dutyDesc || null;
                        const org = p.committee || p.ministry || null;
                        return (
                          <div key={p.id} className="px-4 py-3 rounded-xl bg-gray-50">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                {role && <p className="text-sm font-bold leading-snug">{role}</p>}
                                {org && <p className={`text-sm ${role ? 'text-gray-600' : 'font-bold'} leading-snug`}>{org}</p>}
                              </div>
                              <span className="text-[11px] text-gray-500 font-medium tabular-nums shrink-0">
                                {formatYear(p.startDate)}
                                {p.finishDate ? `–${formatYear(p.finishDate)}` : ''}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* Agenda Tab                                                         */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {tab === 'agenda' && <MKAgendaView mkId={mkId} />}

      </div>
    </div>
  );
}
