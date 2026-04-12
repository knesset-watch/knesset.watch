'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

// ── Data interfaces ────────────────────────────────────────────────────────────

interface MkPreview {
  id: number;
  name: string;
  factionName: string | null;
  isCoalition: boolean | null;
  ministerRole: string | null;
  proposed: number;
  passed: number;
  committeeSessions: number;
  attendanceRate: number | null;
}

interface CommitteePreview {
  name: string;
  sessionCount: number;
  lastDate: string | null;
  memberCount: number;
}

interface VotePreview {
  title: string;
  date: string;
  isPassed: boolean;
  totalFor: number;
  totalAgainst: number;
  totalAbstain: number;
  macroAgenda: string | null;
}

interface BillPreview {
  title: string;
  isPassed: boolean;
  statusDesc: string | null;
  committeeName: string | null;
  macroAgenda: string | null;
  initDate: string | null;
  initiatorCount: number;
}

interface SessionPreview {
  committeeName: string;
  title: string | null;
  date: string;
  agendaCount: number;
  attendeeCount: number;
  voteCount: number;
  billCount: number;
}

interface FactionPreview {
  name: string;
  isCoalition: boolean | null;
  memberCount: number;
  proposed: number;
  passed: number;
  rebelRate: number | null;
}

interface MinistryPreview {
  name: string;
  currentMinister: string | null;
  totalMinisters: number;
  billCount: number;
}

type PreviewData =
  | { type: 'mk';        data: MkPreview }
  | { type: 'committee'; data: CommitteePreview }
  | { type: 'vote';      data: VotePreview }
  | { type: 'bill';      data: BillPreview }
  | { type: 'session';   data: SessionPreview }
  | { type: 'faction';   data: FactionPreview }
  | { type: 'ministry';  data: MinistryPreview };

export type EntityType = PreviewData['type'];

// ── Cache ──────────────────────────────────────────────────────────────────────

const cache = new Map<string, PreviewData>();

// ── Sub-components ─────────────────────────────────────────────────────────────

function Avatar({ label, colorClass }: { label: string; colorClass: string }) {
  return (
    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-black text-sm shrink-0 ${colorClass}`}>
      {label}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-[10px] font-black uppercase text-gray-400 mb-0.5 tracking-wide truncate">{label}</span>
      <span className={`text-lg font-black leading-none ${color ?? ''}`}>{value}</span>
    </div>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span className={`shrink-0 text-[10px] font-black uppercase px-1.5 py-0.5 rounded-full ${color}`}>
      {label}
    </span>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('he-IL', { year: 'numeric', month: 'short', day: 'numeric' });
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return parts[0][0] + parts[parts.length - 1][0];
  return name[0] ?? '?';
}

// ── Card renderers ─────────────────────────────────────────────────────────────

function MkCard({ data }: { data: MkPreview }) {
  const avatarColor = data.isCoalition === true ? 'bg-green-600' : data.isCoalition === false ? 'bg-blue-600' : 'bg-gray-400';
  return (
    <>
      <div className="flex gap-3 items-start mb-3">
        <Avatar label={initials(data.name)} colorClass={avatarColor} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black leading-tight">{data.name}</p>
          {data.factionName && <p className="text-[11px] text-gray-500 mt-0.5">{data.factionName}</p>}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {data.isCoalition !== null && (
            <Badge label={data.isCoalition ? 'קואליציה' : 'אופוזיציה'} color={data.isCoalition ? 'bg-green-600 text-white' : 'bg-blue-600 text-white'} />
          )}
          {data.ministerRole && <Badge label="שר/ה" color="bg-amber-400 text-white" />}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 border-t border-black/5 pt-3">
        <Stat label='הצ"ח' value={data.proposed} />
        <Stat label="עברו" value={data.passed} color="text-teal-600" />
        <Stat label="מליאה" value={data.attendanceRate != null ? `${data.attendanceRate}%` : '—'} />
        <Stat label="ועדות" value={data.committeeSessions.toLocaleString('he-IL')} color="text-blue-700" />
      </div>
    </>
  );
}

function CommitteeCard({ data }: { data: CommitteePreview }) {
  return (
    <>
      <div className="flex gap-3 items-start mb-3">
        <Avatar label="ו" colorClass="bg-teal-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black leading-snug line-clamp-2">{data.name}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 border-t border-black/5 pt-3">
        <Stat label="ישיבות" value={data.sessionCount.toLocaleString('he-IL')} />
        <Stat label="חברים" value={data.memberCount} color="text-blue-700" />
        <Stat label="דיון אחרון" value={data.lastDate ? fmtDate(data.lastDate) : '—'} />
      </div>
    </>
  );
}

function VoteCard({ data }: { data: VotePreview }) {
  const margin = Math.abs(data.totalFor - data.totalAgainst);
  const avatarColor = data.isPassed ? 'bg-teal-600' : 'bg-red-500';
  const avatarLabel = data.isPassed ? '✓' : '✗';
  return (
    <>
      <div className="flex gap-3 items-start mb-3">
        <Avatar label={avatarLabel} colorClass={avatarColor} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black leading-snug line-clamp-2">{data.title}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">{fmtDate(data.date)}{data.macroAgenda ? ` · ${data.macroAgenda}` : ''}</p>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 border-t border-black/5 pt-3">
        <Stat label="הפרש" value={margin} color={data.isPassed ? 'text-teal-600' : 'text-red-500'} />
        <Stat label="בעד" value={data.totalFor} color="text-teal-600" />
        <Stat label="נגד" value={data.totalAgainst} color="text-red-500" />
        <Stat label="נמנעו" value={data.totalAbstain} />
      </div>
    </>
  );
}

function BillCard({ data }: { data: BillPreview }) {
  const avatarColor = data.isPassed ? 'bg-teal-600' : 'bg-blue-500';
  return (
    <>
      <div className="flex gap-3 items-start mb-3">
        <Avatar label="ח" colorClass={avatarColor} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black leading-snug line-clamp-2">{data.title}</p>
          {data.committeeName && <p className="text-[11px] text-gray-500 mt-0.5">{data.committeeName}</p>}
        </div>
        <Badge
          label={data.isPassed ? 'עבר' : 'בהליך'}
          color={data.isPassed ? 'bg-teal-600 text-white' : 'bg-gray-200 text-gray-600'}
        />
      </div>
      <div className="grid grid-cols-3 gap-2 border-t border-black/5 pt-3">
        <Stat label="מציעים" value={data.initiatorCount} />
        <Stat label="נושא" value={data.macroAgenda ?? '—'} />
        <Stat label="הוגש" value={data.initDate ? fmtDate(data.initDate) : '—'} />
      </div>
    </>
  );
}

function SessionCard({ data }: { data: SessionPreview }) {
  return (
    <>
      <div className="flex gap-3 items-start mb-3">
        <Avatar label="ו" colorClass="bg-teal-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black leading-tight">{data.committeeName}</p>
          {data.title && <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-1">{data.title}</p>}
          <p className="text-[11px] text-gray-400 mt-0.5">{fmtDate(data.date)}</p>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 border-t border-black/5 pt-3">
        <Stat label="הצבעות" value={data.voteCount} color="text-blue-700" />
        <Stat label="נושאים" value={data.agendaCount} />
        <Stat label="משתתפים" value={data.attendeeCount} />
        <Stat label="חוקים" value={data.billCount} />
      </div>
    </>
  );
}

function FactionCard({ data }: { data: FactionPreview }) {
  const avatarColor = data.isCoalition === true ? 'bg-green-600' : data.isCoalition === false ? 'bg-blue-600' : 'bg-gray-400';
  const factionInitials = initials(data.name);
  return (
    <>
      <div className="flex gap-3 items-start mb-3">
        <Avatar label={factionInitials} colorClass={avatarColor} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black leading-tight line-clamp-2">{data.name}</p>
        </div>
        {data.isCoalition !== null && (
          <Badge label={data.isCoalition ? 'קואליציה' : 'אופוזיציה'} color={data.isCoalition ? 'bg-green-600 text-white' : 'bg-blue-600 text-white'} />
        )}
      </div>
      <div className="grid grid-cols-4 gap-2 border-t border-black/5 pt-3">
        <Stat label="חברים" value={data.memberCount} />
        <Stat label='הצ"ח' value={data.proposed} />
        <Stat label="עברו" value={data.passed} color="text-teal-600" />
        <Stat label="מרד" value={data.rebelRate != null ? `${data.rebelRate}%` : '—'} color="text-orange-500" />
      </div>
    </>
  );
}

function MinistryCard({ data }: { data: MinistryPreview }) {
  return (
    <>
      <div className="flex gap-3 items-start mb-3">
        <Avatar label="מ" colorClass="bg-slate-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black leading-tight line-clamp-2">{data.name}</p>
          {data.currentMinister && <p className="text-[11px] text-gray-500 mt-0.5">{data.currentMinister}</p>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-black/5 pt-3">
        <Stat label="שרים" value={data.totalMinisters} />
        <Stat label="חוקים" value={data.billCount} color="text-blue-700" />
      </div>
    </>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  href: string;
  type: EntityType;
  id: string | number;
  children: React.ReactNode;
  className?: string;
}

function previewUrl(type: EntityType, id: string | number): string {
  switch (type) {
    case 'mk':        return `${BASE_PATH}/api/preview/mk/${id}`;
    case 'committee': return `${BASE_PATH}/api/preview/committee/${encodeURIComponent(String(id))}`;
    case 'vote':      return `${BASE_PATH}/api/preview/vote/${id}`;
    case 'bill':      return `${BASE_PATH}/api/preview/bill/${id}`;
    case 'session':   return `${BASE_PATH}/api/preview/session/${id}`;
    case 'faction':   return `${BASE_PATH}/api/preview/faction/${encodeURIComponent(String(id))}`;
    case 'ministry':  return `${BASE_PATH}/api/preview/ministry/${encodeURIComponent(String(id))}`;
  }
}

export default function EntityTooltip({ href, type, id, children, className }: Props) {
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cacheKey = `${type}:${id}`;

  function showTooltip(e: React.MouseEvent) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setPos({ top: rect.bottom + window.scrollY + 8, left: rect.left + window.scrollX });
      setVisible(true);
      if (!cache.has(cacheKey)) {
        try {
          const res = await fetch(previewUrl(type, id));
          if (res.ok) {
            const data = await res.json();
            const entry = { type, data } as PreviewData;
            cache.set(cacheKey, entry);
            setPreview(entry);
          }
        } catch { /* silent */ }
      } else {
        setPreview(cache.get(cacheKey)!);
      }
    }, 280);
  }

  function hideTooltip() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <>
      <Link
        href={href}
        className={className}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
      >
        {children}
      </Link>

      {visible && preview && (
        <div
          className="fixed z-50 bg-white border border-black/10 rounded-2xl shadow-xl p-4 w-72 pointer-events-none"
          style={{ top: pos.top, left: pos.left }}
          dir="rtl"
        >
          {preview.type === 'mk'        && <MkCard        data={preview.data} />}
          {preview.type === 'committee' && <CommitteeCard data={preview.data} />}
          {preview.type === 'vote'      && <VoteCard      data={preview.data} />}
          {preview.type === 'bill'      && <BillCard      data={preview.data} />}
          {preview.type === 'session'   && <SessionCard   data={preview.data} />}
          {preview.type === 'faction'   && <FactionCard   data={preview.data} />}
          {preview.type === 'ministry'  && <MinistryCard  data={preview.data} />}
        </div>
      )}
    </>
  );
}
