# RAG Search Reliability Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 4 bugs identified in the RAG test report (rate-limit handling, HTTP 500 on edge queries, empty titles, double-embedding waste) and validate all fixes with live API tests.

**Architecture:** All changes are in two files: `apps/knesset-watch/src/app/api/protocols/ask/route.ts` (Groq error handling + context quality) and `apps/knesset-watch/src/lib/protocols-db.ts` (embedding dedup, title normalization, error robustness). No new files. No schema changes. Deploys via force-build pattern.

**Tech Stack:** Next.js App Router API routes, Turso/libSQL vector search, Jina AI embeddings (jina-embeddings-v3), Groq API (llama-3.3-70b-versatile), git plumbing for commits (git commit hangs in this repo).

---

## Background: What the Test Found

Out of 20 queries:
- **60% returned 502** ("שגיאה בשירות ה-AI") — Groq rate-limit, no retry, no user-friendly message
- **1 returned 500** — unhandled exception on unusual input (e.g. "ספינות חלל ישראליות בירח")
- **100% had empty `title`** — all `committee_session.title` rows are `""`, DB never populated it
- **Double Jina calls** — `searchProtocols` is called twice in parallel (page 1 + page 2), each embedding the query separately — wasteful and doubles rate-limit exposure

## Data Facts (verified in DB)

- `committee_session.title` is `""` (empty string) for ALL 9611 sessions
- `committee_session.rag_card` always starts with `"CommitteeName | YYYY-MM-DD | פרוטוקול N | HH:MM–HH:MM"` — the protocol number (פרוטוקול N) is the only session-specific identifier available
- Foreign Affairs Committee (ועדת החוץ והביטחון) has 332 sessions with ~107K speaker turns — NOT empty, test failures were caused by rate-limiting, not missing data
- Groq free tier rate limit is 30 requests/minute on llama-3.3-70b-versatile

---

## Files Modified

| File | Change |
|------|--------|
| `apps/knesset-watch/src/app/api/protocols/ask/route.ts` | Groq retry logic, 429 message, empty-context guard, title from rag_card |
| `apps/knesset-watch/src/lib/protocols-db.ts` | Single embed call (no double), empty-string title → null, try/catch on embed, rag_card in getProtocolSession |
| `apps/knesset-watch/vercel.json` | Temporary force-deploy (exit 1 → restore) |

---

## Task 1: Fix Groq 429 — retry + user-friendly message

**Files:**
- Modify: `apps/knesset-watch/src/app/api/protocols/ask/route.ts`

The current code does `if (!groqRes.ok) return 502` with no retry and no distinction between 429 (rate-limit) and other errors. This causes 60% failure rate under normal load.

- [ ] **Step 1: Replace the Groq call block with retry logic**

Replace lines 88–117 in `route.ts` (the Groq fetch block) with this helper + call:

```typescript
  // 5. Call Groq with one retry on rate-limit (429)
  async function callGroq(ctx: string): Promise<Response> {
    return fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1024,
        messages: [
          {
            role: 'system',
            content: `אתה עוזר חוקר לניתוח פרוטוקולים של ועדות הכנסת הישראלי.
ענה על שאלות בעברית בלבד, בצורה ממוקדת ועובדתית.
הסתמך אך ורק על הקטעים שסופקו. אם המידע הנדרש אינו מצוי בקטעים — אמור זאת בפירוש.
ציין שמות דוברים, תאריכים ושמות ועדות כשרלוונטי.`,
          },
          {
            role: 'user',
            content: `שאלה: ${question}\n\nקטעים מפרוטוקולים:\n${ctx}`,
          },
        ],
      }),
    });
  }

  let groqRes = await callGroq(context);

  // One retry after 2s on rate-limit
  if (groqRes.status === 429) {
    await new Promise(r => setTimeout(r, 2000));
    groqRes = await callGroq(context);
  }

  if (!groqRes.ok) {
    const err = await groqRes.text();
    console.error('Groq error:', groqRes.status, err);
    const msg = groqRes.status === 429
      ? 'שירות ה-AI עמוס כרגע, נסה שוב בעוד כמה שניות'
      : 'שגיאה בשירות ה-AI';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
```

- [ ] **Step 2: Verify the file compiles**

```bash
cd /Users/dror/Documents/AI\ Experiments/Personal/knesset
npx tsc --noEmit -p apps/knesset-watch/tsconfig.json 2>&1 | grep -v "node_modules"
```

Expected: no errors (or only pre-existing errors unrelated to this file).

---

## Task 2: Fix HTTP 500 — defensive embedding + context guard

**Files:**
- Modify: `apps/knesset-watch/src/lib/protocols-db.ts`
- Modify: `apps/knesset-watch/src/app/api/protocols/ask/route.ts`

The HTTP 500 comes from an unhandled exception somewhere in the pipeline on unusual input. Also, if vector search returns sessions but those sessions have no speaker turns, we send an empty context to Groq which wastes an API call.

- [ ] **Step 1: Wrap embedQuery in try/catch**

Replace the `embedQuery` function in `protocols-db.ts`:

```typescript
async function embedQuery(text: string): Promise<number[] | null> {
  if (!process.env.JINA_API_KEY) return null;
  try {
    const res = await fetch('https://api.jina.ai/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.JINA_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'jina-embeddings-v3',
        input: [text],
        dimensions: DIMS,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { data?: Array<{ embedding?: number[] }> };
    const emb = data.data?.[0]?.embedding;
    return Array.isArray(emb) && emb.length === DIMS ? emb : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Add context guard before Groq call in route.ts**

After the context-building loop (after line ~85 in current file), add:

```typescript
  // Guard: if context is too thin (< 100 chars), nothing useful to send to Groq
  if (context.trim().length < 100) {
    return NextResponse.json({
      answer: 'לא נמצא מידע מספיק בפרוטוקולים על נושא זה.',
      sources: [],
    });
  }
```

- [ ] **Step 3: Verify the file compiles**

```bash
cd /Users/dror/Documents/AI\ Experiments/Personal/knesset
npx tsc --noEmit -p apps/knesset-watch/tsconfig.json 2>&1 | grep -v "node_modules"
```

Expected: no errors.

---

## Task 3: Fix empty titles — normalize + derive from rag_card

**Files:**
- Modify: `apps/knesset-watch/src/lib/protocols-db.ts`
- Modify: `apps/knesset-watch/src/app/api/protocols/ask/route.ts`

All `committee_session.title` rows are `""` (empty string, not null). The code does `title != null ? String(title) : null` — so `""` passes through as an empty string rather than null, and the frontend shows nothing. We derive a display label from `rag_card` which always has `"CommitteeName | Date | פרוטוקול N | Time"` as first line.

- [ ] **Step 1: Add helper to extract protocol label from rag_card**

Add this helper at the top of `protocols-db.ts` (after the DIMS constant):

```typescript
// Extract "פרוטוקול N" from rag_card first line, or null
function protocolLabel(ragCard: unknown): string | null {
  const card = typeof ragCard === 'string' ? ragCard : '';
  const firstLine = card.split('\n')[0] ?? '';
  // rag_card format: "CommitteeName | YYYY-MM-DD | פרוטוקול N | HH:MM–HH:MM"
  const parts = firstLine.split('|');
  const label = parts[2]?.trim();
  return label && label.startsWith('פרוטוקול') ? label : null;
}
```

- [ ] **Step 2: Use protocolLabel in searchProtocols result mapping**

In `searchProtocols`, replace the title mapping line in both the vector path and the LIKE fallback path. Change:

```typescript
      title: r['title'] != null ? String(r['title']) : null,
```

to:

```typescript
      title: protocolLabel(r['rag_card']),
```

There are two places (vector path around line 113, LIKE fallback around line 155).

- [ ] **Step 3: Add rag_card to getProtocolSession query**

In `getProtocolSession`, update the SQL to also fetch `rag_card`:

```typescript
      sql: `SELECT id, committee_id, committee_name, date, title, protocol_url, rag_card
            FROM committee_session WHERE id = ?`,
```

And update the session object construction to use `protocolLabel`:

```typescript
    title: protocolLabel(sr['rag_card']),
```

(Remove the old `sr['title'] != null ? String(sr['title']) : null` line)

- [ ] **Step 4: Verify the file compiles**

```bash
cd /Users/dror/Documents/AI\ Experiments/Personal/knesset
npx tsc --noEmit -p apps/knesset-watch/tsconfig.json 2>&1 | grep -v "node_modules"
```

Expected: no errors.

---

## Task 4: Fix double embedding — embed once, search twice

**Files:**
- Modify: `apps/knesset-watch/src/lib/protocols-db.ts`
- Modify: `apps/knesset-watch/src/app/api/protocols/ask/route.ts`

Currently `searchProtocols` is called twice in parallel, each calling `embedQuery()` → 2 Jina API calls per user request. Since vector search is ordered by cosine distance, page 2 (offset 20–40) just gives less-relevant results. Better: embed once, pass vector directly, get top 40 in one call.

- [ ] **Step 1: Add searchProtocolsWithVector overload to protocols-db.ts**

Add a new exported function that accepts a pre-computed embedding:

```typescript
export async function searchProtocolsVec(
  embedding: number[],
  committee: string | null,
  limit: number,
): Promise<ProtocolSearchResult[]> {
  const client = getTurso();
  if (!client) return [];

  const vecRes = await client.execute({
    sql: `
      SELECT cs.id, cs.committee_id, cs.committee_name, cs.date, cs.rag_card,
             vector_distance_cos(embedding, vector32(?)) as distance
      FROM committee_session cs
      WHERE cs.embedding IS NOT NULL
        ${committee ? 'AND cs.committee_name = ?' : ''}
      ORDER BY distance ASC
      LIMIT ?
    `,
    args: committee
      ? [JSON.stringify(embedding), committee, limit]
      : [JSON.stringify(embedding), limit],
  });

  return vecRes.rows.map(r => ({
    chunkId: Number(r['id']),
    sessionId: Number(r['id']),
    committeeId: Number(r['committee_id'] ?? 0),
    committeeName: String(r['committee_name'] ?? ''),
    date: String(r['date'] ?? ''),
    title: protocolLabel(r['rag_card']),
    speaker: null,
    snippet: String(r['rag_card'] ?? '').slice(0, 300),
  }));
}

export async function embedQueryPublic(text: string): Promise<number[] | null> {
  return embedQuery(text);
}
```

- [ ] **Step 2: Rewrite ask/route.ts to use single embed + searchProtocolsVec**

Replace the two `searchProtocols` calls at the top of the POST handler:

```typescript
  // 1. Embed once, then vector search top 40 sessions
  const { embedQueryPublic, searchProtocolsVec } = await import('@/lib/protocols-db');
  const embedding = await embedQueryPublic(question);

  let allResults: ProtocolSearchResult[] = [];
  if (embedding) {
    allResults = await searchProtocolsVec(embedding, null, 40);
  } else {
    // No embedding available — fall back to LIKE search via searchProtocols
    const page1 = await searchProtocols(question, null, 1);
    allResults = page1.results;
  }
```

Also update the import at the top of route.ts to include the new exports:

```typescript
import { searchProtocols, searchProtocolsVec, embedQueryPublic, getProtocolSession } from '@/lib/protocols-db';
import type { ProtocolSearchResult } from '@/lib/protocols-db';
```

- [ ] **Step 3: Verify the file compiles**

```bash
cd /Users/dror/Documents/AI\ Experiments/Personal/knesset
npx tsc --noEmit -p apps/knesset-watch/tsconfig.json 2>&1 | grep -v "node_modules"
```

Expected: no errors.

---

## Task 5: Deploy and verify

**Files:**
- Modify: `apps/knesset-watch/vercel.json` (temporary force-build, then restore)

- [ ] **Step 1: Commit all changes with git plumbing**

```bash
cd /Users/dror/Documents/AI\ Experiments/Personal/knesset
git add apps/knesset-watch/src/app/api/protocols/ask/route.ts \
        apps/knesset-watch/src/lib/protocols-db.ts
TREE=$(git write-tree)
COMMIT=$(git commit-tree $TREE -p HEAD -m "fix: RAG search reliability — Groq retry, error handling, titles, single embed")
git update-ref refs/heads/main $COMMIT
git push origin main
```

- [ ] **Step 2: Force deploy (ignoreCommand bypass)**

```bash
# Edit vercel.json: change ignoreCommand to "exit 1"
# Then push that change:
git add apps/knesset-watch/vercel.json
TREE=$(git write-tree)
COMMIT=$(git commit-tree $TREE -p HEAD -m "chore: force deploy")
git update-ref refs/heads/main $COMMIT
git push origin main
```

Wait ~45s then check:
```bash
cd /Users/dror/Documents/AI\ Experiments/Personal/knesset/apps/knesset-watch
npx vercel ls 2>&1 | head -5
```
Expected: newest deployment shows `● Ready`.

- [ ] **Step 3: Restore ignoreCommand**

```bash
# Edit vercel.json back to:
# "[ -z \"$VERCEL_GIT_PREVIOUS_SHA\" ] && exit 1; git diff --quiet $VERCEL_GIT_PREVIOUS_SHA $VERCEL_GIT_COMMIT_SHA -- apps/knesset-watch/ packages/"
git add apps/knesset-watch/vercel.json
TREE=$(git write-tree)
COMMIT=$(git commit-tree $TREE -p HEAD -m "chore: restore vercel ignoreCommand")
git update-ref refs/heads/main $COMMIT
git push origin main
```

- [ ] **Step 4: Run 10 live API tests against production**

Get auth token:
```bash
TOKEN=$(curl -s -X POST "https://knesset.watch/api/auth" \
  -H "Content-Type: application/json" \
  -d '{"password":"Pixelbilbo26"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
```

Run 10 test queries:
```bash
for Q in "תקציב המדינה" "בריאות הציבור" "ביטחון לאומי" "דיור ושכר דירה" "גיוס חרדים" "חינוך ינואר 2023" "ועדת הכספים 2024" "ראש הממשלה בוועדה" "כלכלה 2025" "חוק הלאום"; do
  RESP=$(curl -s -X POST "https://knesset.watch/api/protocols/ask" \
    -H "Content-Type: application/json" \
    -H "Cookie: knesset-watch_auth_token=$TOKEN" \
    -d "{\"question\":\"$Q\"}" )
  ANSWER=$(echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('answer') and not d.get('error') else 'FAIL: '+str(d.get('error','?')))" 2>/dev/null)
  SOURCES=$(echo $RESP | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('sources',[])))" 2>/dev/null)
  TITLE=$(echo $RESP | python3 -c "import sys,json; d=json.load(sys.stdin); s=d.get('sources',[]); print(s[0].get('title','NO TITLE') if s else '-')" 2>/dev/null)
  echo "$Q | $ANSWER | sources:$SOURCES | title:$TITLE"
done
```

Expected:
- All 10 return "OK" (no errors)
- `sources` count ≥ 1 for relevant queries
- `title` shows "פרוטוקול N" not empty/null

---

## Long-Term Roadmap (future sessions)

These are improvements beyond this session's scope, ordered by value:

### Phase 2 — Query quality
- **Smarter context selection**: Currently takes top 5 sessions × 30 chunks. Better: score individual speaker turns by TF-IDF or BM25 against the query, take top 30 turns across all sessions.
- **Hebrew keyword fallback**: The LIKE fallback splits the query into words and ORs them — gives results for single-word queries even without Jina.
- **Query translation**: Accept Hebrew or English queries; translate English → Hebrew before embedding.

### Phase 3 — Data quality
- **Populate session titles**: Build a worker that generates agenda titles from the first substantive speaker turn in each session (not the procedural opening). Store in `committee_session.title`.
- **Index Foreign Affairs committee**: Sessions exist but may have parsing gaps — verify chunk quality.
- **Increase rag_card depth**: Currently rag_card shows attendees only; add agenda topics extracted from first 5 turns.

### Phase 4 — Reliability
- **Response caching**: Cache query → answer pairs for 1 hour in Vercel KV (or edge config). Most users ask similar questions.
- **Health endpoint**: `GET /api/health` that checks Turso, Jina, and Groq reachability. Frontend shows a banner if AI is degraded.
- **Groq quota monitoring**: Alert (email/Slack) when daily quota > 80%.
- **Rate limiting per user**: Currently no per-user rate limiting on the ask endpoint.

### Phase 5 — UX
- **Streaming responses**: Use Groq's streaming API to stream the answer token-by-token for faster perceived response.
- **Source deep-links**: Each source citation links directly to the session page (`/session/[id]`) with the relevant passage highlighted.
- **Suggested questions**: Show 3 example queries on the ask UI to onboard new users.
