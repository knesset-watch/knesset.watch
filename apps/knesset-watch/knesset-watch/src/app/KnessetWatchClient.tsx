'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import TimelineChart from '@/components/TimelineChart';
import AllianceGraph from '@/components/AllianceGraph';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

type SortOption      = 'default' | 'proposed' | 'passed' | 'ratio-desc' | 'ratio-asc';
type ViewMode        = 'card' | 'list';
type GroupBy         = 'mk' | 'party-total' | 'party-avg' | 'committee' | 'faction' | 'bill' | 'agenda' | 'rebels' | 'attendance' | 'lobbyists' | 'timeline' | 'alliances';
type CoalitionFilter = 'all' | 'coalition' | 'opposition';

// ── Coalition gradient helpers ────────────────────────────────────────────────
// Colors: amber-50 / slate-50 for active (coalition/opposition); zinc-100 for non-MK.

const NON_MK_CARD   = '#f4f4f5';  // zinc-100
const NON_MK_STRIPE = '#6B7280';  // zinc-400

// Returns inline style for a card background gradient.
// coalitionFrac: fraction of *active* MK time spent in coalition (null = uniform active period).
// isCoalition: true/false when coalitionFrac is null (determines active color).
// activeFrac: fraction of total K25 time the MK was seated (1.0 for current MKs).
function buildCardStyle(
  coalitionFrac: number | null,
  isCoalition: boolean | null,
  activeFrac: number,
): React.CSSProperties | undefined {
  const a = Math.round(activeFrac * 100);
  if (a >= 100 && coalitionFrac === null) return undefined; // plain static card

  if (coalitionFrac !== null) {
    const c = Math.round(coalitionFrac * activeFrac * 100);
    if (a >= 100) {
      return { background: `linear-gradient(to bottom, #F0FDF4 ${c}%, #EFF6FF ${c}%)` };
    }
    return { background: `linear-gradient(to bottom, #F0FDF4 0% ${c}%, #EFF6FF ${c}% ${a}%, ${NON_MK_CARD} ${a}% 100%)` };
  } else {
    const activeColor = isCoalition === true ? '#F0FDF4' : isCoalition === false ? '#EFF6FF' : '#ffffff';
    return { background: `linear-gradient(to bottom, ${activeColor} ${a}%, ${NON_MK_CARD} ${a}%)` };
  }
}

// Returns inline style for the narrow right-side stripe in list rows (party view only).
function buildStripeStyle(
  coalitionFrac: number | null,
  isCoalition: boolean | null,
  activeFrac: number,
): React.CSSProperties | undefined {
  const a = Math.round(activeFrac * 100);
  if (a >= 100 && coalitionFrac === null) return undefined;

  if (coalitionFrac !== null) {
    const c = Math.round(coalitionFrac * activeFrac * 100);
    if (a >= 100) {
      return { background: `linear-gradient(to bottom, #16A34A ${c}%, #2563EB ${c}%)` };
    }
    return { background: `linear-gradient(to bottom, #16A34A 0% ${c}%, #2563EB ${c}% ${a}%, ${NON_MK_STRIPE} ${a}% 100%)` };
  } else {
    const activeColor = isCoalition === true ? '#16A34A' : isCoalition === false ? '#2563EB' : '#d4d4d8';
    return { background: `linear-gradient(to bottom, ${activeColor} ${a}%, ${NON_MK_STRIPE} ${a}%)` };
  }
}

// Color map for segment states.
const SEGMENT_COLORS: Record<string, string> = {
  coalition: '#F0FDF4',
  opposition: '#EFF6FF',
  none: NON_MK_CARD,
};

// Card or row background: chronological gradient from segments.
// direction = 'to left' (list rows: right=start, left=now)
//           = 'to bottom' (cards: top=start, bottom=now)
function buildGradientFromSegments(
  segments: Array<{ startFrac: number; endFrac: number; state: string }> | undefined,
  direction: 'to left' | 'to bottom' = 'to left',
): React.CSSProperties {
  if (!segments?.length) return {};

  // Merge adjacent same-state segments
  const merged: Array<{ startFrac: number; endFrac: number; state: string }> = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && last.state === seg.state) {
      last.endFrac = seg.endFrac;
    } else {
      merged.push({ startFrac: seg.startFrac, endFrac: seg.endFrac, state: seg.state });
    }
  }

  if (merged.length === 1) {
    return { background: SEGMENT_COLORS[merged[0].state] ?? '#ffffff' };
  }

  const SEP = 0.08; // grey separator width as % of total row width
  const stops: string[] = [];

  for (let i = 0; i < merged.length; i++) {
    const seg = merged[i];
    const color = SEGMENT_COLORS[seg.state] ?? '#ffffff';
    const isFirst = i === 0;
    const isLast  = i === merged.length - 1;
    const sOrig = seg.startFrac * 100;
    const eOrig = seg.endFrac   * 100;

    // Shrink segment ends inward by SEP/2 to make room for white separator
    const s = (isFirst ? sOrig       : sOrig + SEP / 2).toFixed(2);
    const e = (isLast  ? eOrig       : eOrig - SEP / 2).toFixed(2);

    stops.push(`${color} ${s}% ${e}%`);

    if (!isLast) {
      stops.push(`#e5e7eb ${e}%`);
      stops.push(`#e5e7eb ${(eOrig + SEP / 2).toFixed(2)}%`);
    }
  }

  return { background: `linear-gradient(${direction}, ${stops.join(', ')})` };
}

// Aliases for clarity at call sites.
function buildRowStyleFromSegments(segments: Array<{ startFrac: number; endFrac: number; state: string }> | undefined): React.CSSProperties {
  return buildGradientFromSegments(segments, 'to left');
}
function buildCardStyleFromSegments(segments: Array<{ startFrac: number; endFrac: number; state: string }> | undefined): React.CSSProperties {
  return buildGradientFromSegments(segments, 'to bottom');
}

// Clip and rescale segments to a specific date range, filling gaps with 'none'.
// Returns undefined if segments have no date annotations.
function filterSegmentsToTimeframe(
  segments: Array<{ startDate?: string; endDate?: string; startFrac: number; endFrac: number; state: string }> | undefined,
  rangeStart: string,
  rangeEnd: string,
): Array<{ startFrac: number; endFrac: number; state: string }> | undefined {
  if (!segments?.length || !segments[0].startDate) return segments;

  const rangeStartMs = new Date(rangeStart).getTime();
  const rangeEndMs   = new Date(rangeEnd).getTime();
  const rangeMs      = rangeEndMs - rangeStartMs;
  if (rangeMs <= 0) return segments;

  const clipped: Array<{ startFrac: number; endFrac: number; state: string }> = [];
  for (const seg of segments) {
    if (!seg.startDate || !seg.endDate) continue;
    const s = Math.max(new Date(seg.startDate).getTime(), rangeStartMs);
    const e = Math.min(new Date(seg.endDate).getTime(),   rangeEndMs);
    if (e <= s) continue;
    clipped.push({ startFrac: (s - rangeStartMs) / rangeMs, endFrac: (e - rangeStartMs) / rangeMs, state: seg.state });
  }

  if (!clipped.length) return undefined;

  // Fill uncovered gaps with 'none'
  const filled: Array<{ startFrac: number; endFrac: number; state: string }> = [];
  let cursor = 0;
  for (const seg of clipped) {
    if (seg.startFrac > cursor + 0.001) {
      filled.push({ startFrac: cursor, endFrac: seg.startFrac, state: 'none' });
    }
    filled.push(seg);
    cursor = seg.endFrac;
  }
  if (cursor < 0.999) {
    filled.push({ startFrac: cursor, endFrac: 1, state: 'none' });
  }

  return filled;
}

const TIMEFRAMES = [
  { value: 'all',    label: 'כל הזמן',        start: '',                                                                                end: '' },
  { value: 'k25',    label: 'כנסת 25',         start: '2022-11-15',                                                                      end: '2026-12-31' },
  { value: 'k24',    label: 'כנסת 24',         start: '2021-04-06',                                                                      end: '2022-11-15' },
  { value: '30d',    label: '30 ימים אחרונים', start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], end: new Date().toISOString().split('T')[0] },
  { value: 'custom', label: 'טווח מותאם',     start: '',                                                                                end: '' },
];

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'default',    label: 'ברירת מחדל' },
  { value: 'proposed',   label: 'הצעות חוק' },
  { value: 'passed',     label: 'חוקים שעברו' },
  { value: 'ratio-desc', label: 'יחס גבוה ← נמוך' },
  { value: 'ratio-asc',  label: 'יחס נמוך ← גבוה' },
];

const COALITION_OPTIONS: [CoalitionFilter, string][] = [
  ['all',        'הכל'],
  ['coalition',  'קואליציה'],
  ['opposition', 'אופוזיציה'],
];

// Bump this when the API response shape changes, to bust stale caches.
const CACHE_VERSION = 6;

function formatDate(iso: string) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function fmtMonthYear(iso: string) {
  if (!iso) return '';
  const [y, m] = iso.split('-');
  const MONTHS = ['ינו׳','פבר׳','מרץ','אפר׳','מאי','יוני','יולי','אוג׳','ספט׳','אוק׳','נוב׳','דצמ׳'];
  return `${MONTHS[parseInt(m, 10) - 1]} ${y.slice(2)}`;
}

const PERIOD_LABEL: Record<string, string> = {
  coalition: 'קואליציה',
  opposition: 'אופוזיציה',
  none: 'לא בכנסת',
};
const PERIOD_COLOR: Record<string, string> = {
  coalition: '#16A34A',
  opposition: '#2563EB',
  none: '#6B7280',
};

// Shared trigger: two small colored bars (amber=coalition, teal=opposition) with a tooltip popup.
// Rendered as absolute overlay; caller places it on a `relative` container.
function CoalitionTimeline({ segments }: {
  segments?: Array<{ startDate?: string; endDate?: string; state: string; startFrac: number; endFrac: number }>;
}) {
  const [visible, setVisible] = useState(false);

  if (!segments?.length || !segments[0].startDate) return null;

  // Merge adjacent same-state
  const merged: Array<{ startDate: string; endDate: string; state: string }> = [];
  for (const seg of segments) {
    if (!seg.startDate) continue;
    const last = merged[merged.length - 1];
    if (last?.state === seg.state) {
      last.endDate = seg.endDate ?? last.endDate;
    } else {
      merged.push({ startDate: seg.startDate, endDate: seg.endDate ?? '', state: seg.state });
    }
  }
  if (merged.length <= 1) return null;

  return (
    <div
      className="relative"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {/* Two-color trigger bar */}
      <button
        className="flex items-center gap-px cursor-help opacity-70 hover:opacity-100 transition-opacity"
        aria-label="היסטוריית קואליציה"
        tabIndex={-1}
      >
        {merged.map((seg, i) => (
          <span
            key={i}
            className="block h-3.5 rounded-sm"
            style={{ background: PERIOD_COLOR[seg.state] ?? '#e5e7eb', width: `${Math.max(4, (seg.endDate && seg.startDate ? 6 : 4))}px` }}
          />
        ))}
      </button>
      {visible && (
        <div
          className="absolute z-50 top-full mt-1.5 left-0 bg-white border border-black/10 rounded-xl shadow-xl p-3 min-w-[200px]"
          dir="rtl"
        >
          <div className="flex flex-col gap-2">
            {merged.map((seg, i) => {
              const isLast = i === merged.length - 1;
              const endLabel = isLast && seg.state !== 'none' ? 'כעת' : fmtMonthYear(seg.endDate);
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: PERIOD_COLOR[seg.state] ?? '#eee' }} />
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] font-black text-gray-700 whitespace-nowrap">{PERIOD_LABEL[seg.state]}</span>
                    <span className="text-[10px] text-gray-400 whitespace-nowrap">{fmtMonthYear(seg.startDate)} – {endLabel}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// For parties: shows the coalition/opposition time split as percentages.
function PartyCoalitionHint({ pct }: { pct: number | null }) {
  const [visible, setVisible] = useState(false);

  if (pct === null) return null;
  const c = Math.round(pct * 100);
  const o = 100 - c;
  return (
    <div
      className="relative"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <button
        className="flex items-center gap-px cursor-help opacity-70 hover:opacity-100 transition-opacity"
        aria-label="פיצול קואליציה/אופוזיציה"
        tabIndex={-1}
      >
        <span className="block h-3.5 rounded-r-sm" style={{ background: '#16A34A', width: `${Math.round(c / 10) + 4}px` }} />
        <span className="block h-3.5 rounded-l-sm" style={{ background: '#2563EB', width: `${Math.round(o / 10) + 4}px` }} />
      </button>
      {visible && (
        <div
          className="absolute z-50 top-full mt-1.5 left-0 bg-white border border-black/10 rounded-xl shadow-xl p-3 min-w-[190px]"
          dir="rtl"
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: '#16A34A' }} />
              <div className="flex flex-col">
                <span className="text-[11px] font-black text-gray-700 whitespace-nowrap">קואליציה</span>
                <span className="text-[10px] text-gray-400 whitespace-nowrap">כ-{c}% מזמן הכנסת</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: '#2563EB' }} />
              <div className="flex flex-col">
                <span className="text-[11px] font-black text-gray-700 whitespace-nowrap">אופוזיציה</span>
                <span className="text-[10px] text-gray-400 whitespace-nowrap">כ-{o}% מזמן הכנסת</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getRatio(stats: any) {
  if (!stats || stats.proposed === 0) return 0;
  return stats.passed / stats.proposed;
}

// Minimum proposals before showing/sorting by ratio.
const RATIO_MIN_PROPOSALS = 5;

// 0 = no proposals (last — never even tried)
// 1 = proposed, 0 passed (above no proposals — at least tried)
// 2 = <RATIO_MIN proposals with passes (insufficient sample)
// 3 = best (≥RATIO_MIN proposals, >0 passed)
function getRatioGroup(stats: any): number {
  if (!stats || stats.proposed === 0) return 0;
  if (stats.passed === 0) return 1;
  if (stats.proposed < RATIO_MIN_PROPOSALS) return 2;
  return 3;
}

// ── Cache helpers ────────────────────────────────────────────────────────────

function getCacheKey(timeframeVal: string, resolvedStart: string, resolvedEnd: string) {
  const suffix = `_v${CACHE_VERSION}`;
  if (timeframeVal === 'custom') return `knesset-watch_cache_custom_${resolvedStart}_${resolvedEnd}${suffix}`;
  return `knesset-watch_cache_${timeframeVal}${suffix}`;
}

function loadCache(key: string): any[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveCache(key: string, data: any[]) {
  try {
    if (data.some(p => p.stats === null)) return;
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // ignore quota errors
  }
}

// ────────────────────────────────────────────────────────────────────────────

export default function KnessetWatchPage() {
  const [data, setData]                 = useState<any[]>(() => loadCache(getCacheKey('k25', '2022-11-15', '2026-12-31')) ?? []);
  const [loading, setLoading]           = useState<boolean>(() => loadCache(getCacheKey('k25', '2022-11-15', '2026-12-31')) === null);
  const [isStale, setIsStale]           = useState<boolean>(() => loadCache(getCacheKey('k25', '2022-11-15', '2026-12-31')) !== null);
  const [sortBy, setSortBy]             = useState<SortOption>('default');
  const [timeframeVal, setTimeframeVal] = useState('k25');
  const [customStart, setCustomStart]   = useState('');
  const [customEnd, setCustomEnd]       = useState('');
  const [viewMode, setViewMode]         = useState<ViewMode>('card');
  const [groupBy, setGroupBy]           = useState<GroupBy>('mk');
  const [committees, setCommittees]     = useState<any[]>([]);
  const [expandedCommittees, setExpandedCommittees] = useState<Set<string>>(new Set());
  const [factions, setFactions]         = useState<any[]>([]);
  const [globalBills, setGlobalBills]   = useState<any[]>([]);
  const [globalAgendas, setGlobalAgendas] = useState<any[]>([]);
  const [rebels, setRebels]             = useState<any[]>([]);
  const [attendance, setAttendance]     = useState<any[]>([]);
  const [lobbyists, setLobbyists]       = useState<any[]>([]);
  const [timelineData, setTimelineData] = useState<any[]>([]);
  const [networkData, setNetworkData]   = useState<{ nodes: any[], links: any[] }>({ nodes: [], links: [] });
  const [networkLoading, setNetworkLoading] = useState(false);
  const [coalitionFilter, setCoalitionFilter] = useState<CoalitionFilter>('all');
  const [activeOnly, setActiveOnly]     = useState(false);
  const [showDeparted, setShowDeparted] = useState(false);
  const [search, setSearch]             = useState('');
  const [billTypeFilter, setBillTypeFilter] = useState<'all' | 'private' | 'gov'>('all');
  const [error, setError]               = useState<string | null>(null);

  const currentRequestId = useRef(0);

  const selectedTimeframe = TIMEFRAMES.find(t => t.value === timeframeVal)!;
  const resolvedStart = timeframeVal === 'custom' ? customStart : selectedTimeframe.start;
  const resolvedEnd   = timeframeVal === 'custom' ? customEnd   : selectedTimeframe.end;

  // Whether card/row gradients should be clipped to the selected timeframe window.
  const useTimeframeSegments = (timeframeVal === '30d' || timeframeVal === 'custom') && !!resolvedStart;
  const segmentRangeEnd = resolvedEnd || new Date().toISOString().split('T')[0];

  useEffect(() => {
    if (groupBy === 'committee' && committees.length === 0) {
      fetch(`${BASE_PATH}/api/committees`)
        .then(r => r.json())
        .then(j => setCommittees(j.committees || []))
        .catch(console.error);
    }
    if (groupBy === 'faction' && factions.length === 0) {
      fetch(`${BASE_PATH}/api/factions`)
        .then(r => r.json())
        .then(j => setFactions(j.factions || []))
        .catch(console.error);
    }
    if (groupBy === 'bill') {
      const qs = new URLSearchParams({ limit: '100' });
      if (search.trim()) qs.set('q', search.trim());
      fetch(`${BASE_PATH}/api/bills?${qs}`)
        .then(r => r.json())
        .then(j => setGlobalBills(j.bills || []))
        .catch(console.error);
    }
    if (groupBy === 'agenda' && globalAgendas.length === 0) {
      fetch(`${BASE_PATH}/api/agendas`)
        .then(r => r.json())
        .then(j => setGlobalAgendas(j.agendas || []))
        .catch(console.error);
    }
    if (groupBy === 'rebels' && rebels.length === 0) {
      fetch(`${BASE_PATH}/api/investigation/rebels`)
        .then(r => r.json())
        .then(j => setRebels(j.rebels || []))
        .catch(console.error);
    }
    if (groupBy === 'attendance' && attendance.length === 0) {
      fetch(`${BASE_PATH}/api/investigation/attendance`)
        .then(r => r.json())
        .then(j => setAttendance(j.attendance || []))
        .catch(console.error);
    }
    if (groupBy === 'lobbyists' && lobbyists.length === 0) {
      fetch(`${BASE_PATH}/api/investigation/lobbyists`)
        .then(r => r.json())
        .then(j => setLobbyists(j.lobbyists || []))
        .catch(console.error);
    }
    if (groupBy === 'timeline' && timelineData.length === 0) {
      fetch(`${BASE_PATH}/api/timeline`)
        .then(r => r.json())
        .then(j => setTimelineData(j.timeline || []))
        .catch(console.error);
    }
    if (groupBy === 'alliances' && networkData.nodes.length === 0) {
      setNetworkLoading(true);
      fetch(`${BASE_PATH}/api/investigation/network`)
        .then(r => r.json())
        .then(j => {
          setNetworkData(j);
          setNetworkLoading(false);
        })
        .catch(err => {
          console.error(err);
          setNetworkLoading(false);
        });
    }
  }, [groupBy]);

  useEffect(() => {
    if (timeframeVal === 'custom' && !customStart) return;

    const cacheKey = getCacheKey(timeframeVal, resolvedStart, resolvedEnd);
    const cached = loadCache(cacheKey);

    async function fetchData() {
      const requestId = ++currentRequestId.current;
      setError(null);

      if (cached) {
        setData(cached);
        setIsStale(true);
        setLoading(false);
      } else {
        setLoading(true);
        setIsStale(false);
      }

      try {
        const personsParam = timeframeVal === 'k24' ? 'knessetNum=24' : 'isCurrent=true';
        const personsRes  = await fetch(`${BASE_PATH}/api/persons?${personsParam}`);
        const personsJson = await personsRes.json();
        if (personsJson.error) throw new Error(personsJson.error);
        if (requestId !== currentRequestId.current) {
          if (!cached) setLoading(false);
          return;
        }

        const freshPeople = (personsJson.value || []).map((p: any) => {
          const cachedPerson = cached?.find((cp: any) => cp.Id === p.Id);
          return { ...p, stats: cachedPerson?.stats ?? null };
        });
        setData(freshPeople);
        if (!cached) setLoading(false);

        const personIds = freshPeople.map((p: any) => p.Id);
        const BATCH_SIZE = 10;
        const batches: number[][] = [];
        for (let i = 0; i < personIds.length; i += BATCH_SIZE) {
          batches.push(personIds.slice(i, i + BATCH_SIZE));
        }

        await Promise.all(batches.map(async (batch) => {
          if (requestId !== currentRequestId.current) return;

          const qs = new URLSearchParams({ personIds: batch.join(',') });
          if (timeframeVal === 'k25') qs.set('knessetNum', '25');
          else if (timeframeVal === 'k24') qs.set('knessetNum', '24');
          else if (resolvedStart) {
            qs.set('startDate', resolvedStart + 'T00:00:00Z');
            if (resolvedEnd) qs.set('endDate', resolvedEnd + 'T23:59:59Z');
          }

          const statsRes = await fetch(`${BASE_PATH}/api/stats?${qs}`);
          const statsMap = await statsRes.json();
          if (requestId !== currentRequestId.current) return;

          setData(prev => prev.map(p => {
            const mkStats = statsMap[p.Id] || statsMap[String(p.Id)];
            return mkStats ? { ...p, stats: mkStats } : p;
          }));
        }));

        if (requestId === currentRequestId.current) {
          setData(prev => prev.map(p => p.stats ? p : { ...p, stats: { proposed: 0, passed: 0 } }));
          setIsStale(false);
        }
      } catch (err: any) {
        if (requestId === currentRequestId.current) {
          setError('שגיאה בטעינת נתונים.');
          if (!cached) setLoading(false);
          setIsStale(false);
        }
      }
    }
    fetchData();
  }, [timeframeVal, customStart, customEnd]);

  useEffect(() => {
    if (data.length === 0 || isStale) return;
    if (data.some(p => p.stats === null)) return;
    const cacheKey = getCacheKey(timeframeVal, resolvedStart, resolvedEnd);
    saveCache(cacheKey, data);
  }, [data, isStale, timeframeVal, resolvedStart, resolvedEnd]);

  const sortedData = useMemo(() => {
    const byName = (a: any, b: any) =>
      (a.LastName ?? '').localeCompare(b.LastName ?? '', 'he') ||
      (a.FirstName ?? '').localeCompare(b.FirstName ?? '', 'he');

    return [...data].sort((a, b) => {
      if (sortBy === 'default') return byName(a, b);

      let result = 0;
      if (sortBy === 'proposed') {
        result = (b.stats?.proposed || 0) - (a.stats?.proposed || 0);
      } else if (sortBy === 'passed') {
        result = (b.stats?.passed || 0) - (a.stats?.passed || 0);
      } else if (sortBy === 'ratio-desc') {
        const ga = getRatioGroup(a.stats), gb = getRatioGroup(b.stats);
        if (ga !== gb) result = gb - ga;
        else if (ga === 1) result = (b.stats?.proposed || 0) - (a.stats?.proposed || 0);
        else if (ga >= 2) result = getRatio(b.stats) - getRatio(a.stats);
      } else if (sortBy === 'ratio-asc') {
        const ga = getRatioGroup(a.stats), gb = getRatioGroup(b.stats);
        if (ga !== gb) result = ga - gb;
        else if (ga === 1) result = (a.stats?.proposed || 0) - (b.stats?.proposed || 0);
        else if (ga >= 2) result = getRatio(a.stats) - getRatio(b.stats);
      }
      return result !== 0 ? result : byName(a, b);
    });
  }, [data, sortBy]);

  const partyData = useMemo(() => {
    if (groupBy === 'mk') return [];

    const byFaction = new Map<string, { FactionName: string; IsCoalition: boolean | null; mks: any[] }>();
    for (const p of data) {
      if ((timeframeVal === 'k25' || timeframeVal === 'all') && !showDeparted && !p.IsCurrent) continue;
      const key = p.FactionName ?? '—';
      if (!byFaction.has(key)) byFaction.set(key, { FactionName: key, IsCoalition: p.IsCoalition ?? null, mks: [] });
      byFaction.get(key)!.mks.push(p);
    }

    const parties = Array.from(byFaction.values()).map(f => {
      const mkCount = f.mks.length;
      const statsReady = f.mks.every(mk => mk.stats !== null);
      const total = f.mks.reduce((acc, mk) => ({
        proposed: acc.proposed + (mk.stats?.proposed ?? 0),
        passed:   acc.passed   + (mk.stats?.passed   ?? 0),
      }), { proposed: 0, passed: 0 });

      // Party's mixed coalition pct = average of individual MK pcts.
      // Only expose when meaningfully mixed across the party as a whole.
      const rawPartyPct = f.mks.reduce((acc: number, mk: any) =>
        acc + (mk.coalitionPct ?? (mk.IsCoalition === true ? 1 : 0)), 0) / mkCount;
      const coalitionPct = rawPartyPct > 0.05 && rawPartyPct < 0.95 ? rawPartyPct : null;

      // Aggregate agendas
      const agendaMap = new Map<string, { pushed: number, supported: number }>();
      f.mks.forEach(mk => {
        if (!mk.stats?.agendas) return;
        Object.entries(mk.stats.agendas).forEach(([macro, counts]: [string, any]) => {
          const existing = agendaMap.get(macro) || { pushed: 0, supported: 0 };
          agendaMap.set(macro, {
            pushed: existing.pushed + (counts.pushed || 0),
            supported: existing.supported + (counts.supported || 0),
          });
        });
      });

      const topAgendas = Array.from(agendaMap.entries())
        .map(([macro, counts]) => ({
          macro,
          total: counts.pushed + counts.supported,
          pushed: counts.pushed,
          supported: counts.supported,
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 3);

      return {
        FactionName:     f.FactionName,
        IsCoalition:     f.IsCoalition,
        mkCount,
        statsReady,
        totalProposed:   total.proposed,
        totalPassed:     total.passed,
        displayProposed: groupBy === 'party-avg' ? total.proposed / mkCount : total.proposed,
        displayPassed:   groupBy === 'party-avg' ? total.passed   / mkCount : total.passed,
        ratio:           total.proposed > 0 ? total.passed / total.proposed : null,
        coalitionPct,
        topAgendas,
      };
    });

    return parties.sort((a, b) => {
      if (sortBy === 'default') return a.FactionName.localeCompare(b.FactionName, 'he');
      if (sortBy === 'proposed') return b.displayProposed - a.displayProposed;
      if (sortBy === 'passed')   return b.displayPassed - a.displayPassed;
      if (sortBy === 'ratio-desc') {
        const ga = getRatioGroup({ proposed: a.totalProposed, passed: a.totalPassed });
        const gb = getRatioGroup({ proposed: b.totalProposed, passed: b.totalPassed });
        if (ga !== gb) return gb - ga;
        if (ga === 1) return b.totalProposed - a.totalProposed;
        if (ga >= 2) return (b.ratio ?? 0) - (a.ratio ?? 0);
      }
      if (sortBy === 'ratio-asc') {
        const ga = getRatioGroup({ proposed: a.totalProposed, passed: a.totalPassed });
        const gb = getRatioGroup({ proposed: b.totalProposed, passed: b.totalPassed });
        if (ga !== gb) return ga - gb;
        if (ga === 1) return a.totalProposed - b.totalProposed;
        if (ga >= 2) return (a.ratio ?? 0) - (b.ratio ?? 0);
      }
      return 0;
    });
  }, [data, groupBy, sortBy, showDeparted, timeframeVal]);

  // ── Filtered views (coalition filter + active-only + search + departed) ───

  const filteredData = useMemo(() => {
    return sortedData.filter(item => {
      if ((timeframeVal === 'k25' || timeframeVal === 'all') && !showDeparted && !item.IsCurrent) return false;
      if (coalitionFilter === 'coalition'  && item.IsCoalition !== true)  return false;
      if (coalitionFilter === 'opposition' && item.IsCoalition !== false) return false;
      if (activeOnly && (item.stats?.proposed ?? 0) === 0) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const name    = `${item.FirstName ?? ''} ${item.LastName ?? ''}`.toLowerCase();
        const faction = (item.FactionName ?? '').toLowerCase();
        if (!name.includes(q) && !faction.includes(q)) return false;
      }
      return true;
    });
  }, [sortedData, coalitionFilter, activeOnly, search, showDeparted, timeframeVal]);

  const filteredPartyData = useMemo(() => {
    return partyData.filter(party => {
      if (coalitionFilter === 'coalition'  && party.IsCoalition !== true)  return false;
      if (coalitionFilter === 'opposition' && party.IsCoalition !== false) return false;
      if (activeOnly && party.totalProposed === 0) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!(party.FactionName ?? '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [partyData, coalitionFilter, activeOnly, search]);

  // ── Bar scale maxima (relative to what's visible) ────────────────────────

  const mkBarMax = useMemo(() => ({
    proposed: Math.max(...filteredData.map(item => item.stats?.proposed ?? 0), 1),
    passed:   Math.max(...filteredData.map(item => item.stats?.passed   ?? 0), 1),
  }), [filteredData]);

  const partyBarMax = useMemo(() => ({
    proposed: Math.max(...filteredPartyData.map(p => p.displayProposed), 1),
    passed:   Math.max(...filteredPartyData.map(p => p.displayPassed),   1),
  }), [filteredPartyData]);

  // ─────────────────────────────────────────────────────────────────────────

  const dateRangeLabel = resolvedStart
    ? `${formatDate(resolvedStart)}${resolvedEnd ? ' — ' + formatDate(resolvedEnd) : ''}`
    : null;

  const filtersActive = coalitionFilter !== 'all' || activeOnly || search.trim() !== '';
  const visibleCount  = groupBy === 'mk' ? filteredData.length : filteredPartyData.length;
  // baseCount = total without active filters, but still respecting showDeparted
  const baseCount  = groupBy === 'mk'
    ? sortedData.filter(p => showDeparted || (timeframeVal !== 'k25' && timeframeVal !== 'all') || p.IsCurrent).length
    : partyData.length;
  const totalCount    = baseCount;

  return (
    <div className="min-h-screen bg-white text-black font-[family-name:var(--font-frank-ruhl)] flex" dir="rtl">
      {/* ── Global Sidebar ── */}
      <aside className="w-64 border-l border-black/10 flex flex-col h-screen sticky top-0 bg-gray-50/50 backdrop-blur-xl shrink-0 hidden md:flex">
        <div className="p-8 border-b border-black/5 flex items-center gap-3">
          <span className="text-2xl font-black tracking-tighter cursor-pointer" onClick={() => setGroupBy('mk')}>כנסת ווטש</span>
          {isStale && (
            <svg className="w-4 h-4 text-gray-400 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
        </div>
        
        <nav className="flex-1 overflow-y-auto p-4 space-y-8 mt-4">
          <div className="space-y-1">
            <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest px-4">סקירה</span>
            <button onClick={() => setGroupBy('mk')} className={`w-full text-right px-4 py-2 text-sm font-black rounded-lg transition-colors ${groupBy === 'mk' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-200'}`}>חברי כנסת</button>
            <Link href="/ministers" className="block w-full text-right px-4 py-2 text-sm font-black rounded-lg transition-colors text-gray-600 hover:bg-gray-200">שרים</Link>
            <button onClick={() => setGroupBy('party-total')} className={`w-full text-right px-4 py-2 text-sm font-black rounded-lg transition-colors ${groupBy.startsWith('party') ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-200'}`}>מפלגות</button>
            <button onClick={() => setGroupBy('timeline')} className={`w-full text-right px-4 py-2 text-sm font-black rounded-lg transition-colors ${groupBy === 'timeline' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-200'}`}>ציר זמן חקיקתי</button>
          </div>

          <div className="space-y-1">
            <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest px-4">חקירה</span>
            <button onClick={() => setGroupBy('rebels')} className={`w-full text-right px-4 py-2 text-sm font-black rounded-lg transition-colors ${groupBy === 'rebels' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-200'}`}>מדד המורדים</button>
            <button onClick={() => setGroupBy('alliances')} className={`w-full text-right px-4 py-2 text-sm font-black rounded-lg transition-colors ${groupBy === 'alliances' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-200'}`}>רשת קשרים</button>
            <button onClick={() => setGroupBy('committee')} className={`w-full text-right px-4 py-2 text-sm font-black rounded-lg transition-colors ${groupBy === 'committee' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-200'}`}>יעילות ועדות</button>
          </div>

          <div className="space-y-1">
            <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest px-4">נתונים</span>
            <Link href="/bills" className="block w-full text-right px-4 py-2 text-sm font-black rounded-lg transition-colors text-gray-600 hover:bg-gray-200">ספר החוקים</Link>
            <Link href="/protocols" className="block w-full text-right px-4 py-2 text-sm font-black rounded-lg transition-colors text-gray-600 hover:bg-gray-200">פרוטוקולים</Link>
            <button onClick={() => setGroupBy('agenda')} className={`w-full text-right px-4 py-2 text-sm font-black rounded-lg transition-colors ${groupBy === 'agenda' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-200'}`}>אג'נדות</button>
          </div>
        </nav>

        <div className="p-8 border-t border-black/5">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Live Data</span>
          </div>
        </div>
      </aside>

      <main className="flex-1 max-w-7xl mx-auto px-4 md:px-12 py-12">
        <header className="mb-12">
          <div className="flex items-baseline gap-4 mb-2">
            <h1 className="text-5xl font-black tracking-tighter uppercase">
              {groupBy === 'mk' ? 'חברי כנסת' : 
               groupBy.startsWith('party') ? 'מפלגות' :
               groupBy === 'faction' ? 'סיעות' :
               groupBy === 'committee' ? 'ועדות' : 
               groupBy === 'agenda' ? "אג'נדות" :
               groupBy === 'rebels' ? "מדד המורדים" :
               groupBy === 'alliances' ? "רשת קשרים" :
               groupBy === 'timeline' ? "ציר זמן" : 'חקיקה'}
            </h1>
          </div>
          <p className="text-gray-400 font-serif">
            {groupBy === 'rebels' ? "חברי כנסת שהצביעו נגד עמדת הסיעה שלהם." :
             groupBy === 'alliances' ? "מי משתף פעולה עם מי? רשת הקשרים הסמויה של הכנסת." :
             groupBy === 'timeline' ? "מתי החלה החקיקה המשמעותית של הכנסת ה-25?" :
             "שקיפות נתוני הכנסת בזמן אמת."}
          </p>

          {/* ── Controls ── */}
          <div className="mt-10 flex flex-col md:flex-row items-start gap-8 flex-wrap">

            {/* Timeframe dropdown */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest">טווח זמן</span>
              <div className="flex items-baseline gap-3 border-b-2 border-black py-1">
                <select
                  value={timeframeVal}
                  onChange={e => setTimeframeVal(e.target.value)}
                  className="bg-transparent font-black text-sm outline-none cursor-pointer pr-1 pl-6 appearance-none"
                >
                  {TIMEFRAMES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                {dateRangeLabel && timeframeVal !== 'custom' && (
                  <span className="text-[11px] text-gray-400 font-mono">{dateRangeLabel}</span>
                )}
              </div>
              {timeframeVal === 'custom' && (
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="date"
                    value={customStart}
                    onChange={e => setCustomStart(e.target.value)}
                    className="border-b-2 border-black bg-transparent text-sm font-black outline-none py-0.5 px-1"
                  />
                  <span className="text-xs opacity-40">—</span>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={e => setCustomEnd(e.target.value)}
                    className="border-b-2 border-black bg-transparent text-sm font-black outline-none py-0.5 px-1"
                  />
                </div>
              )}
            </div>

            {/* Sort dropdown */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest">מיון</span>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as SortOption)}
                className="border-b-2 border-black bg-transparent font-black text-sm outline-none cursor-pointer py-1 pr-1 pl-6 appearance-none"
              >
                {SORT_OPTIONS.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            {/* Group-by options (Sub-tabs) */}
            {groupBy.startsWith('party') && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest">חישוב</span>
                <div className="flex gap-2 border-b-2 border-black py-1">
                  <button 
                    onClick={() => setGroupBy('party-total')}
                    className={`text-sm font-black transition-opacity ${groupBy === 'party-total' ? 'opacity-100' : 'opacity-40'}`}
                  >
                    סה״כ
                  </button>
                  <button 
                    onClick={() => setGroupBy('party-avg')}
                    className={`text-sm font-black transition-opacity ${groupBy === 'party-avg' ? 'opacity-100' : 'opacity-40'}`}
                  >
                    ממוצע
                  </button>
                </div>
              </div>
            )}

            {/* Search */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest">חיפוש</span>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={groupBy === 'mk' ? 'שם או מפלגה...' : groupBy === 'bill' ? 'חיפוש בחקיקה...' : 'שם...'}
                className="border-b-2 border-black bg-transparent font-black text-sm outline-none py-1 pr-1 w-44 placeholder:text-gray-400 placeholder:font-normal"
              />
            </div>

            {/* Coalition filter — only meaningful for K25/all */}
            {(timeframeVal === 'k25' || timeframeVal === 'all') && <div className="flex flex-col gap-1">
              <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest">מחנה</span>
              <select
                value={coalitionFilter}
                onChange={e => setCoalitionFilter(e.target.value as CoalitionFilter)}
                className="border-b-2 border-black bg-transparent font-black text-sm outline-none cursor-pointer py-1 pr-1 pl-6 appearance-none"
              >
                {COALITION_OPTIONS.map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </div>}

            {/* Bill type filter */}
            {groupBy === 'bill' && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest">סוג חקיקה</span>
                <select
                  value={billTypeFilter}
                  onChange={e => setBillTypeFilter(e.target.value as any)}
                  className="border-b-2 border-black bg-transparent font-black text-sm outline-none cursor-pointer py-1 pr-1 pl-6 appearance-none"
                >
                  <option value="all">הכל</option>
                  <option value="gov">ממשלתית (סיגנל)</option>
                  <option value="private">פרטית (פרפורמטיבי)</option>
                </select>
              </div>
            )}

            {/* Display toggles */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest">הצגה</span>
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-2 cursor-pointer select-none py-0.5">
                  <input
                    type="checkbox"
                    checked={activeOnly}
                    onChange={e => setActiveOnly(e.target.checked)}
                    className="accent-black w-3.5 h-3.5"
                  />
                  <span className="text-sm font-black">פעילים בלבד</span>
                </label>
                {(timeframeVal === 'k25' || timeframeVal === 'all') && (
                  <label className="flex items-center gap-2 cursor-pointer select-none py-0.5">
                    <input
                      type="checkbox"
                      checked={showDeparted}
                      onChange={e => setShowDeparted(e.target.checked)}
                      className="accent-black w-3.5 h-3.5"
                    />
                    <span className="text-sm font-black">כולל שעזבו</span>
                  </label>
                )}
              </div>
            </div>


            {/* Count display */}
            {!loading && !error && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest">נמצאו</span>
                <div className="flex items-baseline gap-1 font-mono border-b-2 border-black py-1">
                  <span className="text-sm font-black text-black">
                    {filtersActive ? visibleCount : totalCount}
                  </span>
                  {filtersActive && <span className="text-xs text-black/40">/ {totalCount}</span>}
                </div>
              </div>
            )}

            {/* View toggle — leftmost */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest">תצוגה</span>
              <div className="flex gap-2 border-b-2 border-black py-1">
                <button
                  onClick={() => setViewMode('card')}
                  className={`p-0.5 rounded transition-opacity ${viewMode === 'card' ? 'opacity-100' : 'opacity-40 hover:opacity-70'}`}
                  title="תצוגת כרטיסים"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <rect x="0" y="0" width="7" height="7" rx="1"/>
                    <rect x="9" y="0" width="7" height="7" rx="1"/>
                    <rect x="0" y="9" width="7" height="7" rx="1"/>
                    <rect x="9" y="9" width="7" height="7" rx="1"/>
                  </svg>
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-0.5 rounded transition-opacity ${viewMode === 'list' ? 'opacity-100' : 'opacity-40 hover:opacity-70'}`}
                  title="תצוגת רשימה"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <rect x="0" y="1"   width="16" height="2.5" rx="1"/>
                    <rect x="0" y="6.5" width="16" height="2.5" rx="1"/>
                    <rect x="0" y="12"  width="16" height="2.5" rx="1"/>
                  </svg>
                </button>
              </div>
            </div>

          </div>
        </header>

        {/* ── Legend ── */}
        {!loading && !error && (timeframeVal === 'k25' || timeframeVal === 'all') && (
          <div className="flex items-center gap-5 flex-wrap mb-8">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-5 rounded-sm shrink-0" style={{ background: '#16A34A' }} />
              <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">קואליציה</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-5 rounded-sm shrink-0" style={{ background: '#2563EB' }} />
              <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">אופוזיציה</span>
            </div>
            {showDeparted && (
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-5 rounded-sm shrink-0" style={{ background: '#6B7280' }} />
                <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">לשעבר</span>
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="py-32 flex justify-center text-xl font-black animate-pulse opacity-20">טוען...</div>
        ) : error ? (
          <div className="p-12 text-center text-xl font-black text-red-600">{error}</div>
        ) : groupBy === 'alliances' ? (
          /* ── Alliances view ── */
          <div className="w-full">
            <AllianceGraph data={networkData} />
          </div>
        ) : groupBy === 'rebels' ? (
          /* ── Rebels view ── */
          <div className="flex flex-col gap-4">
            {rebels.map((r, i) => (
              <div key={r.id} className="flex items-center gap-6 p-6 rounded-2xl border border-black/[0.03] bg-white hover:bg-gray-50 transition-colors">
                <span className="text-2xl font-black text-gray-200 w-8">{i + 1}</span>
                <div className="flex-1">
                  <Link href={`/mk/${r.id}`} className="text-xl font-black hover:underline">{r.name}</Link>
                  <p className="text-sm text-gray-500">{r.faction}</p>
                </div>
                <div className="text-center bg-orange-50 px-6 py-3 rounded-xl border border-orange-100">
                  <span className="block text-2xl font-black text-orange-600">{r.rebellionCount}</span>
                  <span className="text-[10px] font-black uppercase text-orange-400">הצבעות נגד הסיעה</span>
                </div>
              </div>
            ))}
          </div>
        ) : groupBy === 'attendance' ? (
          /* ── Attendance view ── */
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {attendance.map((a, i) => (
              <div key={a.id} className="flex items-center gap-4 p-6 rounded-2xl border border-black/[0.03] bg-white hover:bg-gray-50 transition-colors">
                <span className="text-lg font-black text-gray-200">{i + 1}</span>
                <div className="flex-1">
                  <Link href={`/mk/${a.id}`} className="font-black hover:underline">{a.name}</Link>
                  <p className="text-xs text-gray-400">{a.faction}</p>
                </div>
                <div className="text-right">
                  <span className="text-lg font-black">{a.attendedCount}</span>
                  <span className="text-[10px] text-gray-400 mr-1">ישיבות</span>
                </div>
              </div>
            ))}
          </div>
        ) : groupBy === 'lobbyists' ? (
          /* ── Lobbyists view ── */
          <div className="flex flex-col gap-3">
            {lobbyists.map((l) => (
              <div key={l.id} className="p-6 rounded-2xl border border-black/[0.03] bg-white hover:bg-gray-50 transition-colors">
                <h3 className="text-lg font-black mb-1">{l.name}</h3>
                <p className="text-sm text-gray-500 font-serif leading-relaxed">מייצג/ת: <span className="text-black font-medium">{l.clients || 'עצמאי'}</span></p>
              </div>
            ))}
          </div>
        ) : groupBy === 'timeline' ? (
          /* ── Timeline view ── */
          <div className="w-full">
            <TimelineChart data={timelineData} />
          </div>
        ) : groupBy === 'agenda' ? (
          /* ── Global Agenda view ── */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {globalAgendas.map(agenda => (
              <Link
                key={agenda.id}
                href={`/agenda/${encodeURIComponent(agenda.id)}?type=macro`}
                prefetch={false}
                className="block rounded-xl border border-black/8 bg-white hover:bg-gray-50 transition-colors p-6 group"
              >
                <h2 className="text-lg font-black leading-snug mb-2 group-hover:underline">
                  {agenda.label}
                </h2>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-black text-gray-700">
                    {agenda.billCount} הצעות חוק
                  </span>
                  <span className="text-[10px] text-gray-400 font-medium">
                    · {agenda.voteCount} הצבעות
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : groupBy === 'bill' ? (
          /* ── Global Bill view ── */
          <div className="flex flex-col gap-3">
            {globalBills
              .filter(b => {
                if (billTypeFilter === 'gov') return b.subtype === 'ממשלתית';
                if (billTypeFilter === 'private') return b.subtype === 'פרטית';
                return true;
              })
              .map((b) => (
              <div
                key={b.id}
                className="flex items-start gap-4 p-6 rounded-2xl border border-black/[0.03] bg-white hover:bg-gray-50 transition-colors"
              >
                <span className={`shrink-0 text-[10px] font-black px-2 py-1 rounded-full ${b.is_passed ? 'bg-[#16A34A] text-white' : 'bg-gray-200 text-gray-500'}`}>
                  {b.status_desc || (b.is_passed ? 'עבר' : 'הוגש')}
                </span>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-black leading-tight mb-1">{b.title}</h3>
                  {b.initiators && b.initiators.length > 0 && (
                    <div className="flex flex-wrap gap-x-2 gap-y-1 mb-2">
                      {b.initiators.map((init: any) => (
                        <Link 
                          key={init.person_id} 
                          href={`/mk/${init.person_id}`}
                          className="text-[10px] font-bold text-teal-700 hover:underline"
                        >
                          {init.first_name} {init.last_name}
                        </Link>
                      ))}
                    </div>
                  )}
                  {b.summary && (
                    <p className="text-sm text-gray-500 mb-2 line-clamp-3 leading-relaxed font-serif">{b.summary}</p>
                  )}
                  <div className="flex gap-2 flex-wrap items-center">
                    {b.macro_agenda && (
                      <span className="text-[10px] font-black text-white bg-black px-2 py-0.5 rounded-full">{b.macro_agenda}</span>
                    )}
                    {b.micro_agenda && (
                      <span className="text-[10px] font-bold text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">#{b.micro_agenda}</span>
                    )}
                    {b.committee_name && (
                      <span className="text-[10px] font-medium text-gray-400 border border-gray-100 px-2 py-0.5 rounded-full">{b.committee_name}</span>
                    )}
                    {b.publication_date && (
                      <span className="text-[10px] text-gray-400 tabular-nums">
                        {new Date(b.publication_date).toLocaleDateString('he-IL')}
                      </span>
                    )}
                  </div>
                </div>
                {b.doc_url && (
                  <a
                    href={b.doc_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-[10px] font-black text-gray-400 hover:text-black transition-colors border border-gray-200 hover:border-gray-400 px-2 py-1 rounded"
                  >
                    PDF
                  </a>
                )}
              </div>
            ))}
          </div>
        ) : groupBy === 'faction' ? (
          /* ── Faction deep view ── */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {factions.map((f) => {
              const ratio = f.billCount > 0 ? Math.round((f.passedCount / f.billCount) * 100) : 0;
              return (
                <div
                  key={f.name}
                  className={`relative group p-8 rounded-2xl border shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all flex flex-col min-h-[280px] ${
                    f.isCoalition ? 'bg-green-100 border-green-300/50' : 'bg-blue-100 border-blue-300/50'
                  }`}
                >
                  <h3 className="text-xl font-black leading-tight mb-2">
                    {f.name}
                  </h3>
                  <div className="flex items-center gap-2 mb-6 min-h-[1.5rem] flex-wrap">
                    <span className="text-xs text-gray-500 font-medium">{f.currentMemberCount} ח"כים פעילים</span>
                    <span className={`shrink-0 text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full tracking-wider ${
                      f.isCoalition ? 'bg-[#16A34A] text-white' : 'bg-[#2563EB] text-white'
                    }`}>
                      {f.isCoalition ? 'קואליציה' : 'אופוזיציה'}
                    </span>
                  </div>
                  <div className="mt-auto pt-6">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="flex flex-col">
                        <span className="text-[9px] font-black uppercase text-gray-400 mb-1">הצעות</span>
                        <span className="text-3xl font-black">{f.billCount}</span>
                      </div>
                      <div className="flex flex-col border-r border-black/5 pr-3">
                        <span className="text-[9px] font-black uppercase text-gray-400 mb-1">עברו</span>
                        <span className="text-3xl font-black text-teal-600">{f.passedCount}</span>
                      </div>
                      <div className="flex flex-col border-r border-black/5 pr-3">
                        <span className="text-[9px] font-black uppercase text-rose-400 mb-1">מורדות</span>
                        <span className="text-3xl font-black text-rose-600">{f.totalRebels || 0}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : groupBy === 'committee' ? (
          /* ── Committee view ── */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {committees.map((c) => {
              const ratio = c.billCount > 0 ? Math.round((c.passedCount / c.billCount) * 100) : 0;
              const isExpanded = expandedCommittees.has(c.name);
              const toggleExpand = () => setExpandedCommittees(prev => {
                const next = new Set(prev);
                if (next.has(c.name)) next.delete(c.name); else next.add(c.name);
                return next;
              });
              return (
                <div
                  key={c.name}
                  className="relative bg-white rounded-2xl border border-black/[0.03] shadow-sm hover:shadow-xl transition-all flex flex-col"
                >
                  {/* Card header — always visible */}
                  <div className="p-8 flex flex-col min-h-[280px]">
                    <h3 className="text-xl font-black leading-tight mb-2 text-gray-900">
                      <Link href={`/committee/${encodeURIComponent(c.name)}`} className="hover:underline">
                        {c.name}
                      </Link>
                    </h3>
                    <div className="flex items-center gap-2 mb-6 min-h-[1.5rem] flex-wrap">
                      <span className="text-xs text-gray-500 font-medium">{c.memberCount} חברים</span>
                      {c.primaryAgenda && (
                        <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-black text-white">
                          {c.primaryAgenda}
                        </span>
                      )}
                    </div>
                    <div className="mt-auto pt-6">
                      <div className="grid grid-cols-3 gap-3">
                        <div className="flex flex-col">
                          <span className="text-[9px] font-black uppercase text-gray-400 mb-1">הצעות</span>
                          <span className="text-3xl font-black">{c.billCount}</span>
                        </div>
                        <div className="flex flex-col border-r border-black/5 pr-3">
                          <span className="text-[9px] font-black uppercase text-gray-400 mb-1">עברו</span>
                          <span className="text-3xl font-black text-teal-600">{c.passedCount}</span>
                        </div>
                        <div className="flex flex-col border-r border-black/5 pr-3">
                          <span className="text-[9px] font-black uppercase text-gray-400 mb-1">יחס</span>
                          <span className="text-3xl font-black text-gray-900">{ratio}%</span>
                        </div>
                      </div>
                      <button
                        onClick={toggleExpand}
                        className="mt-4 w-full text-[10px] font-black text-gray-400 hover:text-black transition-colors text-center py-1 border-t border-black/5"
                      >
                        {isExpanded ? 'סגור ▲' : 'פרטים ▼'}
                      </button>
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="border-t border-black/8 px-6 py-5 flex flex-col gap-5">
                      {/* Members */}
                      {c.members?.length > 0 && (
                        <div>
                          <div className="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-2">חברים</div>
                          <div className="flex flex-wrap gap-1">
                            {c.members.map((m: any) => (
                              <a
                                key={m.id}
                                href={`${BASE_PATH}/mk/${m.slug ?? m.id}`}
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition-colors hover:opacity-80 ${
                                  m.isCoalition === true ? 'bg-green-50 border-green-200 text-green-800' :
                                  m.isCoalition === false ? 'bg-blue-50 border-blue-200 text-blue-800' :
                                  'bg-gray-100 border-gray-200 text-gray-700'
                                }`}
                              >
                                {m.name}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Top passed bills */}
                      {c.topPassedBills?.length > 0 && (
                        <div>
                          <div className="text-[9px] font-black uppercase text-gray-400 tracking-widest mb-2">חוקים שעברו (אחרונים)</div>
                          <div className="flex flex-col gap-1.5">
                            {c.topPassedBills.map((b: any) => (
                              <div key={b.id} className="flex items-start gap-1.5">
                                <span className="shrink-0 mt-1.5 w-1 h-1 rounded-full bg-teal-500" />
                                <div>
                                  <span className="text-xs font-medium text-gray-800 leading-snug">{b.title}</span>
                                  {b.initDate && (
                                    <span className="block text-[10px] text-gray-400">{b.initDate}</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : groupBy !== 'mk' ? (
          /* ── Party views ── */
          viewMode === 'card' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {filteredPartyData.map((party) => {
                const ratioDisplay = party.ratio !== null ? Math.round(party.ratio * 100) : null;
                const pulse = !party.statsReady;
                const isMixed = party.coalitionPct !== null;
                const cardBg = isMixed
                  ? 'border border-black/[0.05]'
                  : party.IsCoalition === true
                    ? 'bg-green-100 border-green-300/50'
                    : party.IsCoalition === false
                      ? 'bg-blue-100 border-blue-300/50'
                      : 'bg-white border-black/[0.03]';
                return (
                  <div
                    key={party.FactionName}
                    className={`relative group ${cardBg} p-8 rounded-2xl border shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all flex flex-col min-h-[280px]`}
                    style={isMixed ? buildCardStyle(party.coalitionPct, party.IsCoalition, 1) : undefined}
                  >
                    <h3 className="text-2xl font-black leading-tight mb-2 group-hover:text-green-800 transition-colors">
                      {party.FactionName}
                    </h3>
                    <div className="flex items-center gap-2 mb-6 min-h-[1.5rem] flex-wrap">
                      <span className="text-xs text-gray-500 font-medium">{party.mkCount} חברי כנסת</span>
                      {party.IsCoalition !== null && (
                        <span className={`shrink-0 text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full tracking-wider ${
                          party.IsCoalition ? 'bg-[#16A34A] text-white' : 'bg-[#2563EB] text-white'
                        }`}>
                          {party.IsCoalition ? 'קואליציה' : 'אופוזיציה'}
                        </span>
                      )}
                    </div>
                                      {isMixed && (
                                        <div className="absolute top-3 left-3">
                                          <PartyCoalitionHint pct={party.coalitionPct} />
                                        </div>
                                      )}
                                      
                                      {/* Top Agendas */}
                                      {party.topAgendas && party.topAgendas.length > 0 && (
                                        <div className="flex flex-col gap-1.5 mb-6">
                                          <span className="text-[9px] font-black uppercase text-gray-400 tracking-widest">מיקוד מרכזי</span>
                                          <div className="flex flex-wrap gap-1">
                                            {party.topAgendas.map(a => (
                                              <span key={a.macro} className="text-[10px] font-black px-2 py-0.5 rounded-full bg-black/5 text-black/60 border border-black/5">
                                                {a.macro}
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                  
                                      <div className="mt-auto pt-6">                      <div className="grid grid-cols-3 gap-3">
                        <div className="flex flex-col">
                          <span className="text-[9px] font-black uppercase text-gray-400 mb-1">
                            הצעות{groupBy === 'party-avg' ? ' (ממוצע)' : ''}
                          </span>
                          <span className={`text-3xl font-black transition-opacity ${pulse ? 'opacity-30 animate-pulse' : ''}`}>
                            {groupBy === 'party-avg' ? party.displayProposed.toFixed(1) : Math.round(party.displayProposed)}
                          </span>
                        </div>
                        <div className="flex flex-col border-r border-black/5 pr-3">
                          <span className="text-[9px] font-black uppercase text-gray-400 mb-1">
                            עברו{groupBy === 'party-avg' ? ' (ממוצע)' : ''}
                          </span>
                          <span className={`text-3xl font-black text-teal-600 transition-opacity ${pulse ? 'opacity-30 animate-pulse' : ''}`}>
                            {groupBy === 'party-avg' ? party.displayPassed.toFixed(1) : Math.round(party.displayPassed)}
                          </span>
                        </div>
                        <div className="flex flex-col border-r border-black/5 pr-3">
                          <span className="text-[9px] font-black uppercase text-gray-400 mb-1">יחס</span>
                          <span className={`text-3xl font-black text-gray-900 transition-opacity ${pulse ? 'opacity-30 animate-pulse' : ''}`}>
                            {ratioDisplay !== null ? `${ratioDisplay}%` : '—'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* ── Party list view ── */
            <div className="flex flex-col gap-1.5">
              <div className="grid grid-cols-[1fr_6rem_6rem_6rem] gap-4 py-2 px-4 text-[10px] font-black uppercase tracking-widest text-gray-400">
                <span>מפלגה</span>
                <span>הצעות{groupBy === 'party-avg' ? ' (ממוצע)' : ''}</span>
                <span>עברו{groupBy === 'party-avg' ? ' (ממוצע)' : ''}</span>
                <span>יחס</span>
              </div>
              {filteredPartyData.map((party) => {
                const ratioDisplay = party.ratio !== null ? Math.round(party.ratio * 100) : null;
                const pulse = !party.statsReady;
                const isMixed = party.coalitionPct !== null;
                const proposedPct = Math.round((party.displayProposed / partyBarMax.proposed) * 100);
                const passedPct   = Math.round((party.displayPassed   / partyBarMax.passed)   * 100);
                const partyRowStyle: React.CSSProperties = isMixed
                  ? { background: `linear-gradient(to left, #F0FDF4 ${Math.round(party.coalitionPct! * 100)}%, #EFF6FF ${Math.round(party.coalitionPct! * 100)}%)` }
                  : party.IsCoalition === true
                    ? { background: '#F0FDF4' }
                    : party.IsCoalition === false
                      ? { background: '#EFF6FF' }
                      : {};
                return (
                  <div
                    key={party.FactionName}
                    className="relative grid grid-cols-[1fr_6rem_6rem_6rem] gap-4 py-3 px-4 hover:brightness-[1.02] hover:saturate-[1.15] hover:z-10 transition-all items-center"
                    style={partyRowStyle}
                  >
                    <div className="flex flex-col">
                      <span className="font-black text-base">{party.FactionName}</span>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className="text-[11px] text-gray-500">{party.mkCount} חברי כנסת</span>
                        {party.IsCoalition !== null && (
                          <span className={`text-[9px] font-black uppercase px-1 py-0.5 rounded tracking-wider ${
                            party.IsCoalition ? 'bg-[#16A34A] text-white' : 'bg-[#2563EB] text-white'
                          }`}>
                            {party.IsCoalition ? 'קואליציה' : 'אופוזיציה'}
                          </span>
                        )}
                        {party.topAgendas?.slice(0, 1).map(a => (
                          <span key={a.macro} className="text-[9px] font-bold text-black/40 border border-black/5 px-1 py-0.5 rounded">
                            {a.macro}
                          </span>
                        ))}
                      </div>
                    </div>
                    {isMixed && (
                      <div className="absolute left-2 top-1/2 -translate-y-1/2">
                        <PartyCoalitionHint pct={party.coalitionPct} />
                      </div>
                    )}
                    <div className="relative overflow-hidden">
                      <div className="absolute inset-y-0 right-0 bg-black/[0.04] rounded-sm transition-all duration-300" style={{ width: `${proposedPct}%` }} />
                      <span className={`relative font-black text-base tabular-nums transition-opacity ${pulse ? 'opacity-30 animate-pulse' : ''}`}>
                        {groupBy === 'party-avg' ? party.displayProposed.toFixed(1) : Math.round(party.displayProposed)}
                      </span>
                    </div>
                    <div className="relative overflow-hidden">
                      <div className="absolute inset-y-0 right-0 bg-green-100 rounded-sm transition-all duration-300" style={{ width: `${passedPct}%` }} />
                      <span className={`relative font-black text-base tabular-nums text-teal-600 transition-opacity ${pulse ? 'opacity-30 animate-pulse' : ''}`}>
                        {groupBy === 'party-avg' ? party.displayPassed.toFixed(1) : Math.round(party.displayPassed)}
                      </span>
                    </div>
                    <span className={`font-black text-base tabular-nums text-gray-900 transition-opacity ${pulse ? 'opacity-30 animate-pulse' : ''}`}>
                      {ratioDisplay !== null ? `${ratioDisplay}%` : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          )
        ) : viewMode === 'card' ? (
          /* ── MK card view ── */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredData.map((item) => {
              const ratio = (item.stats?.proposed ?? 0) > 0
                ? Math.round((item.stats.passed / item.stats.proposed) * 100)
                : null;
              const statsLoading = !item.stats;
              const isFormer = (item.nonMkPct ?? 0) > 0.001;
              const activeFrac = 1 - (item.nonMkPct ?? 0);
              const isMixed = item.coalitionPct !== null;
              const hasGradient = isMixed || isFormer;
              const cardBg = hasGradient
                ? 'border border-black/[0.05]'
                : item.IsCoalition === true
                  ? 'bg-green-100 border-green-300/50'
                  : item.IsCoalition === false
                    ? 'bg-blue-100 border-blue-300/50'
                    : 'bg-white border-black/[0.03]';
              const displaySegments = useTimeframeSegments
                ? filterSegmentsToTimeframe(item.segments, resolvedStart, segmentRangeEnd)
                : item.segments;
              const timelineVisible = !displaySegments || new Set(displaySegments.map((s: { state: string }) => s.state)).size > 1;
              
              const topAgendas = item.stats?.agendas ? Object.entries(item.stats.agendas)
                .map(([macro, counts]: [string, any]) => ({
                  macro,
                  total: (counts.pushed || 0) + (counts.supported || 0)
                }))
                .sort((a, b) => b.total - a.total)
                .slice(0, 2) : [];

              return (
                <div
                  key={item.Id}
                  className={`relative group ${cardBg} p-8 rounded-2xl border shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all flex flex-col min-h-[280px] ${isStale && !statsLoading ? 'opacity-75' : ''}`}
                  style={displaySegments?.length ? buildCardStyleFromSegments(displaySegments) : buildCardStyle(item.coalitionPct, item.IsCoalition, activeFrac)}
                >
                  <h3 className="text-2xl font-black leading-tight mb-2 transition-colors">
                    <Link href={`/mk/${item.slug ?? item.Id}`} className="hover:underline" prefetch={false}>
                      {item.FirstName} {item.LastName}
                    </Link>
                  </h3>
                  <div className="flex items-center gap-2 mb-4 min-h-[1.5rem] flex-wrap">
                    {item.FactionName && (
                      <span className="text-xs text-gray-600 font-medium truncate">{item.FactionName}</span>
                    )}
                    {item.IsCoalition !== null && item.IsCoalition !== undefined && (
                      <span className={`shrink-0 text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full tracking-wider ${
                        item.IsCoalition ? 'bg-[#16A34A] text-white' : 'bg-[#2563EB] text-white'
                      }`}>
                        {item.IsCoalition ? 'קואליציה' : 'אופוזיציה'}
                      </span>
                    )}
                    {item.ministerRole && (
                      <span className="shrink-0 text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full tracking-wider bg-amber-400 text-white" title={item.ministerRole}>
                        {item.ministerRole.startsWith('סגן') || item.ministerRole.startsWith('סגנית') ? 'סגן שר' : 'שר'}
                      </span>
                    )}
                    {isFormer && (
                      <span className="shrink-0 text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full tracking-wider bg-zinc-100 text-zinc-400">
                        לשעבר
                      </span>
                    )}
                  </div>

                  {/* MK Top Agendas */}
                  {topAgendas.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-6">
                      {topAgendas.map(a => (
                        <span key={a.macro} className="text-[9px] font-black px-2 py-0.5 rounded-full bg-black/5 text-black/50 border border-black/5">
                          {a.macro}
                        </span>
                      ))}
                    </div>
                  )}

                  {timelineVisible && (
                    <div className="absolute top-3 left-3">
                      <CoalitionTimeline segments={item.segments} />
                    </div>
                  )}
                  <div className="mt-auto pt-6">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="flex flex-col">
                        <span className="text-[9px] font-black uppercase text-gray-400 mb-1">הצעות</span>
                        <span className={`text-3xl font-black transition-opacity ${statsLoading ? 'opacity-30 animate-pulse' : ''}`}>
                          {item.stats?.proposed ?? 0}
                        </span>
                      </div>
                      <div className="flex flex-col border-r border-black/5 pr-3">
                        <span className="text-[9px] font-black uppercase text-gray-400 mb-1">עברו</span>
                        <span className={`text-3xl font-black text-teal-600 transition-opacity ${statsLoading ? 'opacity-30 animate-pulse' : ''}`}>
                          {item.stats?.passed ?? 0}
                        </span>
                      </div>
                      <div className="flex flex-col border-r border-black/5 pr-3">
                        <span className="text-[9px] font-black uppercase text-gray-400 mb-1">יחס</span>
                        <span className={`text-3xl font-black text-gray-900 transition-opacity ${statsLoading ? 'opacity-30 animate-pulse' : ''}`}>
                          {item.stats ? (ratio !== null ? `${ratio}%` : '—') : 0}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ── MK list view ── */
          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-[1fr_6rem_6rem_6rem] gap-4 py-2 px-4 text-[10px] font-black uppercase tracking-widest text-gray-400">
              <span>שם</span>
              <span>הצעות</span>
              <span>עברו</span>
              <span>יחס</span>
            </div>
            {filteredData.map((item) => {
              const ratio = (item.stats?.proposed ?? 0) > 0
                ? Math.round((item.stats.passed / item.stats.proposed) * 100)
                : null;
              const statsLoading = !item.stats;
              const isFormer = (item.nonMkPct ?? 0) > 0.001;
              const isMixed = item.coalitionPct !== null;
              const proposedPct = Math.round(((item.stats?.proposed ?? 0) / mkBarMax.proposed) * 100);
              const passedPct   = Math.round(((item.stats?.passed   ?? 0) / mkBarMax.passed)   * 100);
              const displaySegments = useTimeframeSegments
                ? filterSegmentsToTimeframe(item.segments, resolvedStart, segmentRangeEnd)
                : item.segments;
              const timelineVisible = !displaySegments || new Set(displaySegments.map((s: { state: string }) => s.state)).size > 1;

              const topAgendas = item.stats?.agendas ? Object.entries(item.stats.agendas)
                .map(([macro, counts]: [string, any]) => ({
                  macro,
                  total: (counts.pushed || 0) + (counts.supported || 0)
                }))
                .sort((a, b) => b.total - a.total)
                .slice(0, 2) : [];
              return (
                <div
                  key={item.Id}
                  className={`relative grid grid-cols-[1fr_6rem_6rem_6rem] gap-4 py-3 px-4 hover:brightness-[1.02] hover:saturate-[1.15] hover:z-10 transition-all items-center ${isStale && !statsLoading ? 'opacity-75' : ''}`}
                  style={buildRowStyleFromSegments(displaySegments)}
                >
                  <div className="flex flex-col">
                    <Link href={`/mk/${item.slug ?? item.Id}`} className="font-black text-base hover:underline" prefetch={false}>
                      {item.FirstName} {item.LastName}
                    </Link>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {item.FactionName && (
                        <span className="text-[11px] text-gray-500">{item.FactionName}</span>
                      )}
                      {item.IsCoalition !== null && item.IsCoalition !== undefined && (
                        <span className={`text-[9px] font-black uppercase px-1 py-0.5 rounded tracking-wider ${
                          item.IsCoalition ? 'bg-[#16A34A] text-white' : 'bg-[#2563EB] text-white'
                        }`}>
                          {item.IsCoalition ? 'קואליציה' : 'אופוזיציה'}
                        </span>
                      )}
                      {item.ministerRole && (
                        <span className="text-[9px] font-black uppercase px-1 py-0.5 rounded bg-amber-400 text-white" title={item.ministerRole}>
                          {item.ministerRole.startsWith('סגן') || item.ministerRole.startsWith('סגנית') ? 'סגן שר' : 'שר'}
                        </span>
                      )}
                      {(item.stats?.rebellions ?? 0) > 0 && (
                        <span className="text-[9px] font-black uppercase px-1 py-0.5 rounded bg-orange-100 text-orange-700">
                          {item.stats.rebellions} מורדות
                        </span>
                      )}
                      {topAgendas.slice(0, 1).map(a => (
                        <span key={a.macro} className="text-[9px] font-bold text-black/40 border border-black/5 px-1 py-0.5 rounded">
                          {a.macro}
                        </span>
                      ))}
                    </div>
                  </div>
                  {timelineVisible && (
                    <div className="absolute left-2 top-1/2 -translate-y-1/2">
                      <CoalitionTimeline segments={item.segments} />
                    </div>
                  )}
                  <div className="relative overflow-hidden">
                    <div className="absolute inset-y-0 right-0 bg-black/[0.04] rounded-sm transition-all duration-300" style={{ width: `${proposedPct}%` }} />
                    <span className={`relative font-black text-base tabular-nums transition-opacity ${statsLoading ? 'opacity-30 animate-pulse' : ''}`}>
                      {item.stats?.proposed ?? 0}
                    </span>
                  </div>
                  <div className="relative overflow-hidden">
                    <div className="absolute inset-y-0 right-0 bg-green-100 rounded-sm transition-all duration-300" style={{ width: `${passedPct}%` }} />
                    <span className={`relative font-black text-base tabular-nums text-teal-600 transition-opacity ${statsLoading ? 'opacity-30 animate-pulse' : ''}`}>
                      {item.stats?.passed ?? 0}
                    </span>
                  </div>
                  <span className={`font-black text-base tabular-nums text-gray-900 transition-opacity ${statsLoading ? 'opacity-30 animate-pulse' : ''}`}>
                    {item.stats ? (ratio !== null ? `${ratio}%` : '—') : 0}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
