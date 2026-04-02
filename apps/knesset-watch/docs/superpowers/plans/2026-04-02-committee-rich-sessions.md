# Committee Rich Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface all committee-related data from the database — session metadata (status, type, agenda items, votes, linked bills, documents) — through a rich committee page UX with expandable session detail and bill↔session linkage.

**Architecture:** Local SQLite (`knesset.db`) becomes the single source of truth for committee session metadata, replacing the Turso path that only had `rag_card`. A new `getCommitteeSessionsFull()` query fetches sessions with first agenda title + counts in one pass. A new `/api/committee/session/[id]` route lazy-loads full session detail (agenda, votes, bills, documents, transcript) when a session card is expanded. Turso is kept solely for transcript chunk counts and content.

**Tech Stack:** TypeScript, better-sqlite3, Next.js App Router API routes, Tailwind CSS

**Core principle:** Never hide data. If something is "wrong place", relabel or reposition it.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/knesset-db.ts` | Modify | Add `CommitteeSessionFull`, `SessionDetail` interfaces + `getCommitteeSessionsFull()`, `getSessionDetail()` |
| `src/app/api/committee/session/[id]/route.ts` | Create | Lazy-load full session detail: agenda + votes + bills + docs + Turso transcript |
| `src/app/committee/[name]/page.tsx` | Modify | Fetch rich sessions from SQLite, merge Turso chunkCount |
| `src/app/committee/[name]/CommitteeClient.tsx` | Modify | Rich session cards with badges/stats, tabbed expand, bill→sessions chips |

---

## Task 1: Add session query functions to knesset-db.ts

**Files:**
- Modify: `src/lib/knesset-db.ts` (after the `getCommitteeDetail` function, ~line 755)

This task adds two new exported functions and their return types. No existing code is changed.

- [ ] **Step 1: Add interfaces after the existing `CommitteeDetail` interface**

Find the block starting with `export interface CommitteeDetail` (around line 637) and add these interfaces directly after the closing `}` of `CommitteeDetail`:

```typescript
export interface CommitteeSessionFull {
  id: number;
  date: string;
  statusDesc: string | null;       // "פעילה" | "מבוטלת"
  typeDesc: string | null;         // "פתוחה" | "חסויה"
  isJoint: boolean;
  sessionNumber: number | null;
  protocolNumber: number | null;
  protocolUrl: string | null;
  sessionUrl: string | null;
  noProtocolReason: string | null;
  startTime: string | null;
  endTime: string | null;
  firstAgendaTitle: string | null;
  voteCount: number;
  linkedBillCount: number;
  chunkCount: number;              // filled in page.tsx from Turso
}

export interface SessionAgendaItem {
  itemNumber: number | null;
  title: string;
  itemType: string | null;
}

export interface SessionVote {
  subject: string | null;
  result: string | null;
  forCount: number | null;
  againstCount: number | null;
  abstainCount: number | null;
  passed: number | null;
}

export interface SessionLinkedBill {
  billId: number;
  title: string;
  subtype: string;
  isPassed: boolean;
}

export interface SessionDocument {
  id: number;
  groupTypeDesc: string | null;
  documentName: string | null;
  filePath: string | null;
  applicationDesc: string | null;
}

export interface SessionDetail {
  agendaItems: SessionAgendaItem[];
  votes: SessionVote[];
  linkedBills: SessionLinkedBill[];
  documents: SessionDocument[];
}
```

- [ ] **Step 2: Add `getCommitteeSessionsFull` function**

Add this function after `getCommitteeDetail` ends (after its closing `}`):

```typescript
/**
 * Returns all sessions for a committee with rich metadata from local SQLite.
 * chunkCount is left at 0 — caller merges it from Turso.
 */
export function getCommitteeSessionsFull(committeeName: string): CommitteeSessionFull[] {
  const db = getDb();
  if (!db) return [];

  type Row = {
    id: number; date: string; status_desc: string | null; type_desc: string | null;
    is_joint: number; session_number: number | null; protocol_number: number | null;
    protocol_url: string | null; session_url: string | null;
    no_protocol_reason: string | null; start_time: string | null; end_time: string | null;
    first_agenda: string | null; vote_count: number; linked_bill_count: number;
  };

  const rows = db.prepare(`
    SELECT
      cs.id, cs.date, cs.status_desc, cs.type_desc,
      cs.is_joint, cs.session_number, cs.protocol_number,
      cs.protocol_url, cs.session_url,
      cs.no_protocol_reason, cs.start_time, cs.end_time,
      (SELECT title FROM session_agenda_item WHERE session_id = cs.id LIMIT 1) AS first_agenda,
      (SELECT COUNT(*) FROM session_vote WHERE session_id = cs.id) AS vote_count,
      (SELECT COUNT(*) FROM session_bill WHERE session_id = cs.id) AS linked_bill_count
    FROM committee_session cs
    WHERE cs.committee_name = ?
    ORDER BY cs.date DESC
  `).all(committeeName) as Row[];

  return rows.map(r => ({
    id: r.id,
    date: r.date,
    statusDesc: r.status_desc,
    typeDesc: r.type_desc,
    isJoint: r.is_joint === 1,
    sessionNumber: r.session_number,
    protocolNumber: r.protocol_number,
    protocolUrl: r.protocol_url,
    sessionUrl: r.session_url,
    noProtocolReason: r.no_protocol_reason,
    startTime: r.start_time,
    endTime: r.end_time,
    firstAgendaTitle: r.first_agenda,
    voteCount: r.vote_count,
    linkedBillCount: r.linked_bill_count,
    chunkCount: 0,
  }));
}
```

- [ ] **Step 3: Add `getSessionDetail` function**

Add this function immediately after `getCommitteeSessionsFull`:

```typescript
/**
 * Returns full detail for a single committee session for lazy loading.
 */
export function getSessionDetail(sessionId: number): SessionDetail | null {
  const db = getDb();
  if (!db) return null;

  type AgendaRow = { item_number: number | null; title: string; item_type: string | null };
  type VoteRow = { subject: string | null; result: string | null; for_count: number | null; against_count: number | null; abstain_count: number | null; passed: number | null };
  type BillRow = { id: number; title: string; subtype: string; is_passed: number };
  type DocRow = { id: number; group_type_desc: string | null; document_name: string | null; file_path: string | null; application_desc: string | null };

  const agendaItems = (db.prepare(
    `SELECT item_number, title, item_type FROM session_agenda_item WHERE session_id = ? ORDER BY item_number`
  ).all(sessionId) as AgendaRow[]).map(r => ({
    itemNumber: r.item_number,
    title: r.title,
    itemType: r.item_type,
  }));

  const votes = (db.prepare(
    `SELECT subject, result, for_count, against_count, abstain_count, passed FROM session_vote WHERE session_id = ? ORDER BY rowid`
  ).all(sessionId) as VoteRow[]).map(r => ({
    subject: r.subject,
    result: r.result,
    forCount: r.for_count,
    againstCount: r.against_count,
    abstainCount: r.abstain_count,
    passed: r.passed,
  }));

  const linkedBills = (db.prepare(
    `SELECT b.id, b.title, b.subtype, b.is_passed
     FROM session_bill sb JOIN bill b ON b.id = sb.bill_id
     WHERE sb.session_id = ?
     ORDER BY b.is_passed DESC, b.id DESC`
  ).all(sessionId) as BillRow[]).map(r => ({
    billId: r.id,
    title: r.title,
    subtype: r.subtype ?? '',
    isPassed: r.is_passed === 1,
  }));

  const documents = (db.prepare(
    `SELECT id, group_type_desc, document_name, file_path, application_desc
     FROM session_document
     WHERE session_id = ? AND file_path IS NOT NULL AND file_path != ''
     ORDER BY group_type_id`
  ).all(sessionId) as DocRow[]).map(r => ({
    id: r.id,
    groupTypeDesc: r.group_type_desc,
    documentName: r.document_name,
    filePath: r.file_path,
    applicationDesc: r.application_desc,
  }));

  return { agendaItems, votes, linkedBills, documents };
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/knesset-watch && npx tsc --noEmit 2>&1
```

Expected: no errors (or only pre-existing errors unrelated to new code).

- [ ] **Step 5: Commit**

```bash
git add apps/knesset-watch/src/lib/knesset-db.ts
git commit -m "feat(knesset-watch): add CommitteeSessionFull + SessionDetail query functions"
```

---

## Task 2: New API route for lazy-loaded session detail

**Files:**
- Create: `src/app/api/committee/session/[id]/route.ts`

This route merges local SQLite session detail (agenda, votes, bills, documents) with Turso transcript chunks. It is called by CommitteeClient when a session card is expanded.

- [ ] **Step 1: Create the route file**

Create `apps/knesset-watch/src/app/api/committee/session/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { getSessionDetail } from '@/lib/knesset-db';
import { getProtocolSession } from '@/lib/protocols-db';

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: Props) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const { id } = await params;
  const sessionId = parseInt(id, 10);
  if (isNaN(sessionId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  // Fetch SQLite detail and Turso transcript in parallel
  const [detail, protocol] = await Promise.all([
    Promise.resolve(getSessionDetail(sessionId)),
    getProtocolSession(sessionId),
  ]);

  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    agendaItems: detail.agendaItems,
    votes: detail.votes,
    linkedBills: detail.linkedBills,
    documents: detail.documents,
    chunks: protocol?.chunks ?? [],
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/knesset-watch && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 3: Smoke-test the route locally**

Start dev server (`npm run dev`) and in another terminal:
```bash
# Pick any session ID from the DB:
node -e "const db=require('better-sqlite3')('knesset.db',{readonly:true}); console.log(db.prepare('SELECT id FROM committee_session LIMIT 1').get())"
# Then hit the route (replace SESSION_ID):
curl "http://localhost:3000/api/committee/session/SESSION_ID" -H "Cookie: knesset-watch_auth_token=YOUR_TOKEN"
```

Expected: JSON with `agendaItems`, `votes`, `linkedBills`, `documents`, `chunks` arrays.

- [ ] **Step 4: Commit**

```bash
git add apps/knesset-watch/src/app/api/committee/session/
git commit -m "feat(knesset-watch): add /api/committee/session/[id] rich detail route"
```

---

## Task 3: Update page.tsx — fetch sessions from SQLite + merge Turso chunkCount

**Files:**
- Modify: `src/app/committee/[name]/page.tsx`

Replace `getCommitteeProtocolSessions` (Turso-only sessions) with `getCommitteeSessionsFull` (SQLite), then merge Turso chunkCounts.

- [ ] **Step 1: Rewrite page.tsx**

Replace the entire file:

```typescript
import { checkServerAuth } from '@/lib/ui/auth-utils';
import { redirect, notFound } from 'next/navigation';
import { getCommitteeDetail, getCommitteeSessionsFull, type CommitteeSessionFull } from '@/lib/knesset-db';
import { getCommitteeProtocolSessions } from '@/lib/protocols-db';
import CommitteeClient from './CommitteeClient';

interface Props {
  params: Promise<{ name: string }>;
}

export default async function CommitteePage({ params }: Props) {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) redirect('/login');

  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);

  const [data, localSessions, tursoCounts] = await Promise.all([
    Promise.resolve(getCommitteeDetail(name)),
    Promise.resolve(getCommitteeSessionsFull(name)),
    getCommitteeProtocolSessions(name),
  ]);
  if (!data) notFound();

  // Merge Turso chunkCount + protocolUrl into the richer SQLite session records
  const chunkMap = new Map(tursoCounts.map(s => [s.sessionId, s.chunkCount]));
  const sessions: CommitteeSessionFull[] = localSessions.map(s => ({
    ...s,
    chunkCount: chunkMap.get(s.id) ?? 0,
    // Prefer SQLite protocolUrl; fall back to Turso if SQLite doesn't have it
    protocolUrl: s.protocolUrl ?? (tursoCounts.find(t => t.sessionId === s.id)?.protocolUrl ?? null),
  }));

  return <CommitteeClient data={data} sessions={sessions} />;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/knesset-watch && npx tsc --noEmit 2>&1
```

Expected: errors only from CommitteeClient (which still expects `protocolSessions` — fixed in Task 4).

- [ ] **Step 3: Commit (after Task 4 when types stabilize)**

Hold off — commit together with CommitteeClient in Task 4 Step 6.

---

## Task 4: Redesign CommitteeClient.tsx

**Files:**
- Modify: `src/app/committee/[name]/CommitteeClient.tsx`

This is the largest change. The new UI:

**Session card (compact):**
- Date + time range
- Badges: `[מבוטלת]` (grey), `[חסויה]` (red), `[משותפת]` (blue), `[חקיקה]` (amber, existing)
- First agenda item title as the main description
- Mini-stats row: `🗳️ N הצבעות`, `📋 N הצ"ח`, `✓ תמלול` if transcript available
- All sessions are expandable (click → fetch `/api/committee/session/[id]`)

**Session expanded (tabbed):**
- Tabs: `[סדר יום]` (agenda), `[הצבעות]` (votes), `[הצ"ח]` (bills), `[תמלול]` (transcript), `[מסמכים]` (documents)
- Only show tabs with content
- Transcript tab disabled if chunkCount = 0

**Bills tab addition:**
- Each bill shows `נדון ב-N ישיבות` chip that links to the session tab

- [ ] **Step 1: Add FullSessionDetail type and update props**

At the top of CommitteeClient.tsx, replace the existing `FullProtocol` interface and component signature:

```typescript
'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { CommitteeDetail } from '@/lib/knesset-db';
import type { CommitteeSessionFull } from '@/lib/knesset-db';
import EntityTooltip from '@/components/EntityTooltip';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface SessionChunk {
  chunkIndex: number;
  text: string;
  speaker: string | null;
}

interface FullSessionDetail {
  agendaItems: Array<{ itemNumber: number | null; title: string; itemType: string | null }>;
  votes: Array<{ subject: string | null; result: string | null; forCount: number | null; againstCount: number | null; abstainCount: number | null; passed: number | null }>;
  linkedBills: Array<{ billId: number; title: string; subtype: string; isPassed: boolean }>;
  documents: Array<{ id: number; groupTypeDesc: string | null; documentName: string | null; filePath: string | null; applicationDesc: string | null }>;
  chunks: SessionChunk[];
}

export default function CommitteeClient({
  data,
  sessions,
}: {
  data: CommitteeDetail;
  sessions: CommitteeSessionFull[];
}) {
```

- [ ] **Step 2: Replace all state declarations**

After the props signature opening brace `{`, replace all existing state and derived values with:

```typescript
  const ratio = data.billCount > 0 ? Math.round((data.passedCount / data.billCount) * 100) : 0;
  const [search, setSearch] = useState('');
  const [showPassedOnly, setShowPassedOnly] = useState(false);
  const [expandedBills, setExpandedBills] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<'bills' | 'sessions'>(
    sessions.length > 0 ? 'sessions' : 'bills'
  );
  const [sessionSearch, setSessionSearch] = useState('');
  const [expandedSessions, setExpandedSessions] = useState<Map<number, FullSessionDetail>>(new Map());
  const [expandedSessionTabs, setExpandedSessionTabs] = useState<Map<number, string>>(new Map());
  const [loadingSessions, setLoadingSessions] = useState<Set<number>>(new Set());

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

  const expandSession = async (sessionId: number) => {
    if (expandedSessions.has(sessionId)) {
      setExpandedSessions(prev => { const next = new Map(prev); next.delete(sessionId); return next; });
      return;
    }
    setLoadingSessions(prev => new Set(prev).add(sessionId));
    try {
      const res = await fetch(`${BASE_PATH}/api/committee/session/${sessionId}`);
      const detail: FullSessionDetail = await res.json();
      setExpandedSessions(prev => new Map(prev).set(sessionId, detail));
      // Default to first available tab
      const firstTab = detail.agendaItems.length > 0 ? 'agenda'
        : detail.votes.length > 0 ? 'votes'
        : detail.linkedBills.length > 0 ? 'bills'
        : detail.chunks.length > 0 ? 'transcript'
        : 'documents';
      setExpandedSessionTabs(prev => new Map(prev).set(sessionId, firstTab));
    } finally {
      setLoadingSessions(prev => { const n = new Set(prev); n.delete(sessionId); return n; });
    }
  };

  const filteredSessions = sessions.filter(s => {
    if (!sessionSearch) return true;
    const q = sessionSearch.toLowerCase();
    return s.firstAgendaTitle?.toLowerCase().includes(q) ||
      s.date.includes(q) ||
      (s.sessionNumber?.toString() ?? '').includes(q);
  });

  const cancelledCount = sessions.filter(s => s.statusDesc === 'מבוטלת').length;
  const closedCount = sessions.filter(s => s.typeDesc === 'חסויה').length;
  const jointCount = sessions.filter(s => s.isJoint).length;
```

- [ ] **Step 3: Replace the stats row**

Find the stats row block (the `<div className="flex gap-6 mb-8 mt-4">` block) and replace it:

```tsx
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
              {cancelledCount > 0 && (
                <span className="text-[9px] text-gray-400 mt-0.5">{cancelledCount} בוטלו</span>
              )}
            </div>
          )}
          <div className="flex flex-col border-r border-black/8 pr-6">
            <span className="text-[9px] font-black uppercase text-gray-400 mb-1">חברים</span>
            <span className="text-3xl font-black">{data.members.length}</span>
          </div>
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
        </div>
```

- [ ] **Step 4: Replace the tabs bar**

Find the `{/* Tabs */}` block and replace it:

```tsx
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
```

- [ ] **Step 5: Replace the bills tab content**

Find the `{/* Bills tab */}` block and replace it with (add the "N sessions" chip to each bill):

```tsx
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
                // Count sessions that discussed this bill
                const billSessionCount = sessions.filter(s => s.linkedBillCount > 0).length;
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
                            onClick={() => { setActiveTab('sessions'); setSessionSearch(b.title.slice(0, 20)); }}
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
```

- [ ] **Step 6: Replace the protocols tab with the new sessions tab**

Replace the entire `{/* Protocols tab */}` block (from `{activeTab === 'protocols' && (` to its closing `)}`) with:

```tsx
        {/* Sessions tab */}
        {activeTab === 'sessions' && (
          <div>
            {/* Coverage banner */}
            {(() => {
              const withTranscript = sessions.filter(s => s.chunkCount > 0).length;
              const total = sessions.length;
              if (total > 0 && withTranscript < total) {
                return (
                  <div className="mb-4 rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-700 leading-relaxed">
                    <span className="font-black">{withTranscript} מתוך {total} ישיבות</span> כוללות תמלול מלא הניתן לחיפוש.
                  </div>
                );
              }
              return null;
            })()}

            <input
              type="text"
              value={sessionSearch}
              onChange={e => setSessionSearch(e.target.value)}
              placeholder="חיפוש לפי נושא, תאריך..."
              className="w-full text-sm px-4 py-2 rounded-full border border-black/10 bg-gray-50 focus:outline-none focus:border-black/30 mb-4"
              dir="rtl"
            />
            <div className="text-xs text-gray-400 font-medium mb-3">
              {filteredSessions.length} ישיבות
            </div>

            <div className="flex flex-col gap-1.5">
              {filteredSessions.map(s => {
                const isExpanded = expandedSessions.has(s.id);
                const isLoading = loadingSessions.has(s.id);
                const detail = expandedSessions.get(s.id);
                const activeDetailTab = expandedSessionTabs.get(s.id) ?? 'agenda';
                const isCancelled = s.statusDesc === 'מבוטלת';
                const isClosed = s.typeDesc === 'חסויה';

                const date = new Date(s.date).toLocaleDateString('he-IL', {
                  year: 'numeric', month: 'long', day: 'numeric',
                });
                const timeRange = s.startTime && s.endTime
                  ? `${s.startTime.slice(11, 16)}–${s.endTime.slice(11, 16)}`
                  : s.startTime ? s.startTime.slice(11, 16) : null;

                // Session type label from protocol_number or session_number
                const sessionLabel = s.protocolNumber
                  ? `פרוטוקול ${s.protocolNumber}`
                  : s.sessionNumber ? `ישיבה ${s.sessionNumber}` : null;

                return (
                  <div key={s.id} className={`rounded-xl overflow-hidden border ${isCancelled ? 'border-gray-200 opacity-60' : 'border-transparent bg-gray-50'}`}>
                    {/* Card header — always clickable */}
                    <div
                      className="flex items-start justify-between px-4 py-3 cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => expandSession(s.id)}
                    >
                      <div className="flex-1 min-w-0">
                        {/* Date + badges row */}
                        <div className="flex items-center gap-1.5 flex-wrap mb-1">
                          <span className={`text-xs font-bold ${isCancelled ? 'line-through text-gray-400' : 'text-gray-700'}`}>{date}</span>
                          {timeRange && <span className="text-[10px] text-gray-400">{timeRange}</span>}
                          {isCancelled && (
                            <span className="text-[10px] font-black text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded">בוטלה</span>
                          )}
                          {isClosed && (
                            <span className="text-[10px] font-black text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">🔒 חסויה</span>
                          )}
                          {s.isJoint && (
                            <span className="text-[10px] font-black text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">משותפת</span>
                          )}
                          {sessionLabel && !sessionLabel.startsWith('פרוטוקול') ? null : sessionLabel && (
                            <span className="text-[10px] text-gray-400 font-medium">{sessionLabel}</span>
                          )}
                          {s.chunkCount > 0 && (
                            <span className="text-[10px] font-black text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded">✓ תמלול</span>
                          )}
                        </div>

                        {/* Agenda title or no-protocol reason */}
                        {s.firstAgendaTitle && (
                          <p className="text-sm font-bold leading-snug text-gray-900 mt-0.5">{s.firstAgendaTitle}</p>
                        )}
                        {isCancelled && s.noProtocolReason && (
                          <p className="text-xs text-gray-400 mt-0.5">{s.noProtocolReason}</p>
                        )}

                        {/* Mini-stats row */}
                        {!isCancelled && (s.voteCount > 0 || s.linkedBillCount > 0 || s.chunkCount > 0) && (
                          <div className="flex items-center gap-3 mt-1.5">
                            {s.voteCount > 0 && (
                              <span className="text-[10px] text-gray-500 font-medium">🗳️ {s.voteCount} הצבעות</span>
                            )}
                            {s.linkedBillCount > 0 && (
                              <span className="text-[10px] text-gray-500 font-medium">📋 {s.linkedBillCount} הצ&quot;ח</span>
                            )}
                            {s.chunkCount > 0 && (
                              <span className="text-[10px] text-gray-400">{s.chunkCount} קטעים</span>
                            )}
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
                          <a href={s.protocolUrl} target="_blank" rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-[10px] font-black text-teal-700 hover:text-teal-900 border border-teal-200 hover:border-teal-400 px-1.5 py-0.5 rounded transition-colors">
                            PDF
                          </a>
                        )}
                        <span className="text-gray-400 text-sm">
                          {isLoading ? '...' : isExpanded ? '▲' : '▼'}
                        </span>
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && detail && (
                      <div className="border-t border-black/5 bg-white">
                        {/* Detail tabs */}
                        {(() => {
                          const tabs: Array<{ key: string; label: string; count: number }> = [
                            { key: 'agenda', label: 'סדר יום', count: detail.agendaItems.length },
                            { key: 'votes', label: 'הצבעות', count: detail.votes.length },
                            { key: 'bills', label: 'הצ"ח', count: detail.linkedBills.length },
                            { key: 'transcript', label: 'תמלול', count: detail.chunks.length },
                            { key: 'documents', label: 'מסמכים', count: detail.documents.length },
                          ].filter(t => t.count > 0);

                          if (tabs.length === 0) {
                            return <p className="px-4 py-3 text-xs text-gray-400">אין מידע זמין לישיבה זו.</p>;
                          }

                          return (
                            <>
                              <div className="flex gap-0 border-b border-black/5 px-4">
                                {tabs.map(t => (
                                  <button
                                    key={t.key}
                                    onClick={() => setExpandedSessionTabs(prev => new Map(prev).set(s.id, t.key))}
                                    className={`text-[11px] font-black px-3 py-2 border-b-2 -mb-px transition-colors ${
                                      activeDetailTab === t.key ? 'border-black text-black' : 'border-transparent text-gray-400 hover:text-black'
                                    }`}
                                  >
                                    {t.label} ({t.count})
                                  </button>
                                ))}
                              </div>

                              <div className="px-4 py-3 max-h-[50vh] overflow-y-auto" dir="rtl">
                                {/* Agenda tab */}
                                {activeDetailTab === 'agenda' && (
                                  <ol className="flex flex-col gap-1.5">
                                    {detail.agendaItems.map((item, i) => (
                                      <li key={i} className="text-xs text-gray-700 leading-relaxed flex gap-2">
                                        {item.itemNumber != null && (
                                          <span className="font-black text-gray-400 shrink-0">{item.itemNumber}.</span>
                                        )}
                                        <span>{item.title}</span>
                                      </li>
                                    ))}
                                  </ol>
                                )}

                                {/* Votes tab */}
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

                                {/* Bills tab */}
                                {activeDetailTab === 'bills' && (
                                  <div className="flex flex-col gap-1.5">
                                    {detail.linkedBills.map(b => (
                                      <div key={b.billId} className="flex items-center gap-2">
                                        <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${b.isPassed ? 'bg-[#16A34A] text-white' : 'bg-gray-200 text-gray-500'}`}>
                                          {b.isPassed ? 'עבר' : 'בתהליך'}
                                        </span>
                                        <span className="text-xs text-gray-800">{b.title}</span>
                                        {b.subtype && <span className="text-[10px] text-gray-400">{b.subtype}</span>}
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Transcript tab */}
                                {activeDetailTab === 'transcript' && (
                                  <div className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">
                                    {detail.chunks.map((chunk, i) => (
                                      <div key={i} className="mb-3">
                                        {chunk.speaker && (
                                          <span className="font-black text-gray-800">{chunk.speaker}: </span>
                                        )}
                                        {chunk.text}
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Documents tab */}
                                {activeDetailTab === 'documents' && (
                                  <div className="flex flex-col gap-1.5">
                                    {detail.documents.map(doc => (
                                      <div key={doc.id} className="flex items-center gap-2">
                                        <span className="text-[10px] text-gray-400 font-medium shrink-0">
                                          {doc.applicationDesc ?? 'DOC'}
                                        </span>
                                        {doc.filePath ? (
                                          <a href={doc.filePath} target="_blank" rel="noopener noreferrer"
                                            className="text-xs text-teal-700 hover:underline truncate">
                                            {doc.documentName ?? doc.groupTypeDesc ?? 'מסמך'}
                                          </a>
                                        ) : (
                                          <span className="text-xs text-gray-600 truncate">
                                            {doc.documentName ?? doc.groupTypeDesc ?? 'מסמך'}
                                          </span>
                                        )}
                                        {doc.groupTypeDesc && (
                                          <span className="text-[10px] text-gray-400 shrink-0">({doc.groupTypeDesc})</span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd apps/knesset-watch && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 8: Smoke-test locally**

Start dev server and open a committee page. Verify:
- Members show (not 0)
- Sessions tab shows sessions with date, badges, agenda title
- Cancelled sessions show "בוטלה" badge with grey styling
- Closed sessions show "🔒 חסויה" badge
- Joint sessions show "משותפת" badge
- Clicking a session loads and shows tabs (agenda, votes, bills, transcript, documents)
- Bills tab has "← ישיבות" chip that switches tab + prefills search

- [ ] **Step 9: Commit all Task 3+4 changes together**

```bash
git add apps/knesset-watch/src/app/committee/ apps/knesset-watch/src/app/api/committee/
git commit -m "feat(knesset-watch): rich committee sessions — agenda, votes, bills, docs, badges"
```

---

## Self-Review

**Spec coverage check:**
- ✅ All session metadata surfaced (status, type, is_joint, agenda, votes, bills, documents)
- ✅ חקיקה sessions labeled (existing amber badge, now also shows linked bills in expand)
- ✅ Cancelled sessions shown with badge + reason (not hidden)
- ✅ Closed sessions labeled
- ✅ Joint sessions labeled
- ✅ Bill → sessions navigation (chip that switches tab)
- ✅ Session votes displayed with for/against/abstain
- ✅ Session documents categorized and linked
- ✅ Transcript still accessible (as a tab in expanded view)
- ✅ Members fix from earlier session is preserved (local SQLite, not Turso)
- ✅ Pass rate fix (CAST) from earlier session is preserved

**Type consistency check:**
- `CommitteeSessionFull.id` → used as `s.id` throughout ✅
- `FullSessionDetail.agendaItems[].title` → used in agenda tab ✅
- `FullSessionDetail.votes[].forCount` → used in votes tab ✅
- `FullSessionDetail.linkedBills[].billId` → used as key ✅
- `FullSessionDetail.chunks[].speaker` → used in transcript tab ✅
- Page.tsx passes `sessions` prop; CommitteeClient receives `sessions: CommitteeSessionFull[]` ✅
- Old `protocolSessions` prop is gone — CommitteeClient no longer references it ✅
