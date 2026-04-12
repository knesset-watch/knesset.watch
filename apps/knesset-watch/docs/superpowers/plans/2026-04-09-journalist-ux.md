# Journalist UX Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three journalist-facing features to the ask page: (1) an MK activity timeline on a topic, (2) a "who else voted this way?" panel, and (3) a coalition/opposition voting pattern breakdown.

**Architecture:** All three features are client-side components rendered below the LLM answer when an MK + topic is detected. They pull from existing SQLite data via new API routes — no new data needed. The timeline shows a date-ordered strip of events (sessions, votes, bills, queries). The "who else" panel finds MKs who voted identically to the detected MK across all related votes. The pattern breakdown shows coalition vs. opposition stance on the relevant votes.

**Tech Stack:** React (client components), Next.js API routes, existing knesset-db.ts queries, Tailwind CSS. RTL layout. No new dependencies.

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/app/api/mk-timeline/route.ts` | Returns date-ordered events for MK + topic |
| Create | `src/app/api/vote-coalition/route.ts` | Returns who-else-voted + coalition breakdown for a vote |
| Create | `src/components/MkTimeline.tsx` | Timeline strip component |
| Create | `src/components/VoteCoalition.tsx` | Who-else + coalition panel |
| Modify | `src/app/ask/AskClient.tsx` | Render timeline + coalition below the answer |
| Modify | `src/lib/knesset-db.ts` | Add `getMkTopicTimeline()`, `getVoteCoalition()` |

---

## Task 1: MK activity timeline API + component

### 1a: Add `getMkTopicTimeline()` to knesset-db.ts

- [ ] **Step 1: Add the function**

```typescript
// In src/lib/knesset-db.ts

export interface TimelineEvent {
  date: string;
  type: 'vote' | 'bill' | 'query' | 'session';
  title: string;
  id: number;
  detail: string | null; // vote result, bill status, etc.
}

export function getMkTopicTimeline(mkId: number, keywords: string[]): TimelineEvent[] {
  const db = getDb();
  if (!db || keywords.length === 0) return [];

  const kw = keywords.map(k => `%${k}%`);
  const events: TimelineEvent[] = [];

  // Votes
  const voteConditions = keywords.map(() => '(pv.title LIKE ? OR pv.micro_agenda LIKE ?)').join(' OR ');
  const voteParams = keywords.flatMap(k => [`%${k}%`, `%${k}%`]);
  const votes = db.prepare(`
    SELECT pv.id, pv.date, pv.title, pv.is_passed, mvr.result_code
    FROM plenary_vote pv
    JOIN mk_vote_result mvr ON mvr.vote_id = pv.id AND mvr.mk_id = ?
    WHERE (${voteConditions})
    ORDER BY pv.date DESC
    LIMIT 20
  `).all(mkId, ...voteParams) as Array<{ id: number; date: string; title: string; is_passed: number; result_code: number }>;

  const CODE: Record<number, string> = { 7: 'בעד', 8: 'נגד', 6: 'נמנע', 9: 'נוכח' };
  for (const v of votes) {
    events.push({ date: v.date, type: 'vote', title: v.title, id: v.id, detail: `${CODE[v.result_code] ?? ''} | ${v.is_passed ? 'עבר' : 'לא עבר'}` });
  }

  // Bills
  const billConditions = keywords.map(() => 'b.title LIKE ?').join(' OR ');
  const bills = db.prepare(`
    SELECT b.id, b.title, b.publication_date, b.is_passed
    FROM bill b
    JOIN bill_initiator bi ON bi.bill_id = b.id AND bi.mk_id = ?
    WHERE (${billConditions})
    ORDER BY b.publication_date DESC
    LIMIT 10
  `).all(mkId, ...kw) as Array<{ id: number; title: string; publication_date: string; is_passed: number }>;

  for (const b of bills) {
    events.push({ date: b.publication_date, type: 'bill', title: b.title, id: b.id, detail: b.is_passed ? 'עבר' : null });
  }

  // Queries
  const queryConditions = keywords.map(() => '(q.title LIKE ? OR q.body LIKE ?)').join(' OR ');
  const queryParams = keywords.flatMap(k => [`%${k}%`, `%${k}%`]);
  const queries = db.prepare(`
    SELECT q.id, q.title, q.submit_date
    FROM mk_query q
    WHERE q.mk_id = ? AND (${queryConditions})
    ORDER BY q.submit_date DESC
    LIMIT 10
  `).all(mkId, ...queryParams) as Array<{ id: number; title: string; submit_date: string }>;

  for (const q of queries) {
    events.push({ date: q.submit_date, type: 'query', title: q.title, id: q.id, detail: null });
  }

  return events.sort((a, b) => b.date.localeCompare(a.date));
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd apps/knesset-watch && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

### 1b: Create API route

- [ ] **Step 3: Create `src/app/api/mk-timeline/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { getMkTopicTimeline } from '@/lib/knesset-db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const mkId = Number(req.nextUrl.searchParams.get('mkId'));
  const keywords = req.nextUrl.searchParams.get('keywords')?.split(',').filter(Boolean) ?? [];

  if (!mkId || keywords.length === 0) {
    return NextResponse.json({ error: 'missing mkId or keywords' }, { status: 400 });
  }

  const events = getMkTopicTimeline(mkId, keywords);
  return NextResponse.json({ events });
}
```

- [ ] **Step 4: Quick test**

```bash
# Start dev server first: npm run dev
curl "http://localhost:3001/api/mk-timeline?mkId=427&keywords=יוקר,מחיה" 2>/dev/null | npx tsx -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{ const j=JSON.parse(d); console.log('events:', j.events?.length); console.log(j.events?.slice(0,2)); })"
```

Expected: `events: N` with N > 0 for Lieberman + cost of living.

### 1c: Create MkTimeline component

- [ ] **Step 5: Create `src/components/MkTimeline.tsx`**

```typescript
'use client';

import type { TimelineEvent } from '@/lib/knesset-db';

const TYPE_LABEL: Record<string, string> = {
  vote: 'הצבעה',
  bill: 'הצ"ח',
  query: 'שאילתה',
  session: 'ועדה',
};

const TYPE_COLOR: Record<string, string> = {
  vote: 'bg-blue-100 text-blue-800',
  bill: 'bg-green-100 text-green-800',
  query: 'bg-orange-100 text-orange-800',
  session: 'bg-purple-100 text-purple-800',
};

export function MkTimeline({ events, mkName }: { events: TimelineEvent[]; mkName: string }) {
  if (events.length === 0) return null;
  return (
    <div className="mt-6 border-t pt-4" dir="rtl">
      <h3 className="text-sm font-semibold text-gray-500 mb-3">ציר הזמן — {mkName}</h3>
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute right-16 top-0 bottom-0 w-px bg-gray-200" />
        <div className="space-y-2">
          {events.map((ev, i) => (
            <div key={i} className="flex items-start gap-3 pr-2">
              {/* Date */}
              <div className="w-14 text-xs text-gray-400 text-left flex-shrink-0 pt-1">
                {ev.date.slice(0, 10)}
              </div>
              {/* Dot */}
              <div className="w-2 h-2 rounded-full bg-gray-400 mt-1.5 flex-shrink-0 relative z-10" />
              {/* Content */}
              <div className="flex-1 min-w-0">
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${TYPE_COLOR[ev.type]}`}>
                  {TYPE_LABEL[ev.type]}
                </span>
                <p className="text-sm text-gray-700 mt-0.5 leading-snug line-clamp-2">{ev.title}</p>
                {ev.detail && <p className="text-xs text-gray-500 mt-0.5">{ev.detail}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/knesset-db.ts src/app/api/mk-timeline/route.ts src/components/MkTimeline.tsx
git commit -m "feat: MK activity timeline for topic — API + component"
```

---

## Task 2: Coalition/opposition breakdown API + component

### 2a: Add `getVoteCoalition()` to knesset-db.ts

- [ ] **Step 1: Add the function**

```typescript
// In src/lib/knesset-db.ts

export interface VoteCoalitionBreakdown {
  voteId: number;
  title: string;
  date: string;
  isPassed: boolean;
  coalition: { for: number; against: number; abstain: number };
  opposition: { for: number; against: number; abstain: number };
  topAligned: Array<{ mkName: string; mkId: number; result: string }>; // MKs who voted same as detected MK
}

export function getVoteCoalition(voteId: number, detectedMkResult: number): VoteCoalitionBreakdown | null {
  const db = getDb();
  if (!db) return null;

  const vote = db.prepare(
    'SELECT id, title, date, is_passed FROM plenary_vote WHERE id = ?'
  ).get(voteId) as { id: number; title: string; date: string; is_passed: number } | undefined;
  if (!vote) return null;

  const results = db.prepare(`
    SELECT mvr.mk_id, mvr.result_code, mp.first_name, mp.last_name, mp.is_coalition
    FROM mk_vote_result mvr
    JOIN mk_person mp ON mp.person_id = mvr.mk_id
    WHERE mvr.vote_id = ?
  `).all(voteId) as Array<{ mk_id: number; result_code: number; first_name: string; last_name: string; is_coalition: number }>;

  const coalition = { for: 0, against: 0, abstain: 0 };
  const opposition = { for: 0, against: 0, abstain: 0 };
  const topAligned: VoteCoalitionBreakdown['topAligned'] = [];
  const CODE: Record<number, string> = { 7: 'בעד', 8: 'נגד', 6: 'נמנע' };

  for (const r of results) {
    const bucket = r.is_coalition ? coalition : opposition;
    if (r.result_code === 7) bucket.for++;
    else if (r.result_code === 8) bucket.against++;
    else if (r.result_code === 6) bucket.abstain++;

    if (r.result_code === detectedMkResult && topAligned.length < 5) {
      topAligned.push({ mkName: `${r.first_name} ${r.last_name}`, mkId: r.mk_id, result: CODE[r.result_code] ?? '' });
    }
  }

  return {
    voteId: vote.id,
    title: vote.title,
    date: vote.date,
    isPassed: !!vote.is_passed,
    coalition,
    opposition,
    topAligned,
  };
}
```

### 2b: Create API route

- [ ] **Step 2: Create `src/app/api/vote-coalition/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/ui/auth-utils';
import { getVoteCoalition } from '@/lib/knesset-db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authError = await validateApiAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (authError) return authError;

  const voteId = Number(req.nextUrl.searchParams.get('voteId'));
  const mkResult = Number(req.nextUrl.searchParams.get('mkResult') ?? '7');
  if (!voteId) return NextResponse.json({ error: 'missing voteId' }, { status: 400 });

  const breakdown = getVoteCoalition(voteId, mkResult);
  if (!breakdown) return NextResponse.json({ error: 'vote not found' }, { status: 404 });
  return NextResponse.json({ breakdown });
}
```

### 2c: Create VoteCoalition component

- [ ] **Step 3: Create `src/components/VoteCoalition.tsx`**

```typescript
'use client';

import type { VoteCoalitionBreakdown } from '@/lib/knesset-db';

function Bar({ label, for: f, against: a, abstain: ab }: { label: string; for: number; against: number; abstain: number }) {
  const total = f + a + ab || 1;
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="flex h-4 rounded overflow-hidden text-xs">
        <div style={{ width: `${(f / total) * 100}%` }} className="bg-green-500 flex items-center justify-center text-white font-medium">{f > 0 ? f : ''}</div>
        <div style={{ width: `${(a / total) * 100}%` }} className="bg-red-500 flex items-center justify-center text-white font-medium">{a > 0 ? a : ''}</div>
        <div style={{ width: `${(ab / total) * 100}%` }} className="bg-gray-300 flex items-center justify-center text-gray-600 font-medium">{ab > 0 ? ab : ''}</div>
      </div>
      <div className="flex gap-3 mt-1 text-xs text-gray-500">
        <span>✓ {f} בעד</span>
        <span>✗ {a} נגד</span>
        {ab > 0 && <span>— {ab} נמנע</span>}
      </div>
    </div>
  );
}

export function VoteCoalition({ breakdown }: { breakdown: VoteCoalitionBreakdown }) {
  return (
    <div className="mt-4 p-3 bg-gray-50 rounded-lg border" dir="rtl">
      <p className="text-xs font-semibold text-gray-600 mb-2 line-clamp-1">{breakdown.title}</p>
      <div className="space-y-2">
        <Bar label="קואליציה" for={breakdown.coalition.for} against={breakdown.coalition.against} abstain={breakdown.coalition.abstain} />
        <Bar label="אופוזיציה" for={breakdown.opposition.for} against={breakdown.opposition.against} abstain={breakdown.opposition.abstain} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: TypeScript check**

```bash
cd apps/knesset-watch && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/knesset-db.ts src/app/api/vote-coalition/route.ts src/components/VoteCoalition.tsx
git commit -m "feat: coalition/opposition vote breakdown — API + component"
```

---

## Task 3: Wire timeline + coalition into AskClient

**Files:**
- Modify: `src/app/ask/AskClient.tsx`

- [ ] **Step 1: Read AskClient.tsx first**

```bash
head -50 src/app/ask/AskClient.tsx
```

Understand the current structure: where sources are rendered, what state exists, what the `detectedMk` shape is.

- [ ] **Step 2: Add timeline state and fetch**

Inside `AskClient`, after the answer is loaded and `detectedMk` is set, fetch the timeline:

```typescript
const [timeline, setTimeline] = useState<TimelineEvent[]>([]);

useEffect(() => {
  if (!result?.detectedMk || !topicKeywords.length) return;
  const { mkId } = result.detectedMk;
  fetch(`/api/mk-timeline?mkId=${mkId}&keywords=${topicKeywords.join(',')}`)
    .then(r => r.json())
    .then(d => setTimeline(d.events ?? []))
    .catch(() => {});
}, [result?.detectedMk, topicKeywords.join(',')]);
```

Note: `topicKeywords` must be derived from the search result or query string — extract from the query using the same logic as the route (strip MK name + stop words). Pass them through from the API response or compute client-side.

The simplest approach: include `topicKeywords` in the `AskResponse` from the API:
- In `route.ts`, add `topicKeywords` to the response JSON
- In `AskClient.tsx`, read them from `result.topicKeywords`

- [ ] **Step 3: Update AskResponse in route.ts to include topicKeywords**

```typescript
// In route.ts, update the response object:
const response: AskResponse = {
  answer,
  sources,
  detectedMk: detectedMk ?? null,
  topicKeywords,   // add this
};

// Update the AskResponse interface:
interface AskResponse {
  answer: string;
  sources: Source[];
  detectedMk: { mkId: number; fullName: string } | null;
  topicKeywords: string[];
}
```

- [ ] **Step 4: Render MkTimeline below the answer**

In `AskClient.tsx`, import `MkTimeline` and render after the answer div:

```typescript
import { MkTimeline } from '@/components/MkTimeline';

// In the JSX, after the answer section:
{result?.detectedMk && timeline.length > 0 && (
  <MkTimeline events={timeline} mkName={result.detectedMk.fullName} />
)}
```

- [ ] **Step 5: Smoke test in browser**

```bash
npm run dev
# Open http://localhost:3001/ask
# Query: ליברמן יוקר המחיה
# Expect: answer + timeline strip below with votes/bills/queries in date order
```

- [ ] **Step 6: Commit**

```bash
git add src/app/ask/AskClient.tsx src/app/api/ask/route.ts
git commit -m "feat: render MK activity timeline on ask page"
```

---

## Task 4: Bump cache key and ship

- [ ] **Step 1: Bump cache key in route.ts**

Change to `ask:v6:${q}` (or next version if already bumped).

- [ ] **Step 2: Final TypeScript check**

```bash
cd apps/knesset-watch && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: journalist UX — timeline, coalition breakdown, ask page improvements"
```

---

## Verification

1. Query "ליברמן יוקר המחיה" → timeline shows 6+ votes (all בעד against government) + any bills or queries
2. Timeline is sorted newest-first with dates visible
3. Coalition breakdown (if rendered on vote sources) shows coalition vs. opposition split
4. No layout breakage on mobile (RTL, small screen)
5. TypeScript clean: `npx tsc --noEmit` exits 0
