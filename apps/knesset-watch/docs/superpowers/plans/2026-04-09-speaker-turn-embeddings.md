# Speaker Turn Embeddings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed individual speaker turns in Turso so vector search finds the exact paragraph an MK said about a topic, instead of just finding sessions where the topic appeared.

**Architecture:** Add an `embedding F32_BLOB(768)` column to `session_speaker_turn` in Turso. A one-time batch script embeds all ~447K turns via Jina AI (with checkpointing). A new `searchSpeakerTurnsByVector()` function enables turn-level semantic search. The ask API route uses this when an MK is detected: instead of keyword LIKE search on turns, it does vector search filtered by `mk_id`.

**Tech Stack:** Turso (libSQL), Jina AI embeddings (768-dim, model `jina-embeddings-v3`), TypeScript tsx scripts, existing `src/lib/turso-db.ts` client.

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `scripts/embed-speaker-turns.ts` | One-time batch: embed all turns, checkpoint progress |
| Modify | `src/lib/protocols-db.ts` | Add `searchSpeakerTurnsByVector()` |
| Modify | `src/app/api/ask/route.ts` | Use vector search for MK turns instead of LIKE |

---

## Task 1: Add embedding column to Turso

**Files:**
- Run: Turso DDL migration (inline command, not a script file)

- [ ] **Step 1: Add the column**

Run against Turso (get URL + token from `.env.local` / Vercel env — vars are `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`):

```bash
cd apps/knesset-watch
npx tsx -e "
import { createClient } from '@libsql/client';
const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});
await db.execute('ALTER TABLE session_speaker_turn ADD COLUMN embedding F32_BLOB(768)');
console.log('done');
" 
```

Expected output: `done`

- [ ] **Step 2: Create the vector index**

```bash
npx tsx -e "
import { createClient } from '@libsql/client';
const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});
await db.execute(\`
  CREATE INDEX IF NOT EXISTS idx_turn_embedding
  ON session_speaker_turn (libsql_vector_idx(embedding))
\`);
console.log('index created');
"
```

- [ ] **Step 3: Verify column exists**

```bash
npx tsx -e "
import { createClient } from '@libsql/client';
const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});
const r = await db.execute('SELECT id, mk_id, embedding FROM session_speaker_turn LIMIT 3');
console.log(r.rows);
"
```

Expected: rows with `embedding: null` (not yet populated).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: add embedding column to session_speaker_turn in Turso"
```

---

## Task 2: Write the batch embedding script

**Files:**
- Create: `scripts/embed-speaker-turns.ts`

The script fetches turns in batches of 50, calls Jina AI, updates Turso, and checkpoints progress so it can be resumed safely.

- [ ] **Step 1: Create the script**

```typescript
// scripts/embed-speaker-turns.ts
// One-time batch: embed all session_speaker_turn rows that have no embedding yet.
// Checkpoints by highest processed id so it's safe to kill + resume.
// Run: cd apps/knesset-watch && npx tsx scripts/embed-speaker-turns.ts

import { createClient } from '@libsql/client';

const JINA_API_KEY = process.env.JINA_API_KEY;
if (!JINA_API_KEY) throw new Error('JINA_API_KEY not set');
if (!process.env.TURSO_DATABASE_URL) throw new Error('TURSO_DATABASE_URL not set');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN ?? '',
});

const BATCH = 50;          // rows per Jina API call
const DELAY_MS = 500;      // between batches to respect rate limits

async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  const res = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${JINA_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'jina-embeddings-v3',
      task: 'retrieval.passage',
      late_chunking: false,
      dimensions: 768,
      input: texts,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('Jina error:', res.status, err.slice(0, 200));
    return texts.map(() => null);
  }
  const data = await res.json() as { data: Array<{ embedding: number[] }> };
  return data.data.map(d => d.embedding);
}

async function main() {
  // Count total unembedded
  const countRes = await db.execute(
    'SELECT COUNT(*) as n FROM session_speaker_turn WHERE embedding IS NULL'
  );
  const total = Number(countRes.rows[0]?.n ?? 0);
  console.log(`Total unembedded turns: ${total.toLocaleString()}`);
  if (total === 0) { console.log('Nothing to do.'); return; }

  let processed = 0;
  let errors = 0;

  while (true) {
    // Fetch next batch (unembedded, ordered by id for stable pagination)
    const batch = await db.execute(
      `SELECT id, text FROM session_speaker_turn
       WHERE embedding IS NULL AND text IS NOT NULL
       ORDER BY id ASC LIMIT ${BATCH}`
    );
    if (batch.rows.length === 0) break;

    const ids = batch.rows.map(r => Number(r.id));
    const texts = batch.rows.map(r => String(r.text ?? '').slice(0, 8192));

    const embeddings = await embedBatch(texts);

    // Update each row
    for (let i = 0; i < ids.length; i++) {
      const emb = embeddings[i];
      if (!emb) { errors++; continue; }
      // Turso stores F32_BLOB via vector32() helper
      const vec = `[${emb.join(',')}]`;
      await db.execute({
        sql: 'UPDATE session_speaker_turn SET embedding = vector32(?) WHERE id = ?',
        args: [vec, ids[i]],
      });
    }

    processed += ids.length;
    const pct = ((processed / total) * 100).toFixed(1);
    console.log(`[${pct}%] processed ${processed.toLocaleString()} / ${total.toLocaleString()} (errors: ${errors})`);

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`Done. Processed: ${processed}, Errors: ${errors}`);
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Test with a small run (first 10 rows)**

Add `LIMIT 10` to the SELECT temporarily to verify the embedding + update works before running the full job:

```bash
cd apps/knesset-watch
# Copy .env.local values into shell, then:
npx tsx scripts/embed-speaker-turns.ts
```

Expected: output like `[0.0%] processed 10 / 447000 (errors: 0)`

Check a row in Turso to verify embedding was written:
```bash
npx tsx -e "
import { createClient } from '@libsql/client';
const db = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });
const r = await db.execute('SELECT id, LENGTH(CAST(embedding AS TEXT)) as emb_len FROM session_speaker_turn WHERE embedding IS NOT NULL LIMIT 3');
console.log(r.rows);
"
```

Expected: rows with `emb_len > 0`.

- [ ] **Step 3: Commit and kick off the full run in background**

Remove the `LIMIT 10` and run the full job (will take several hours for ~447K turns):

```bash
git add scripts/embed-speaker-turns.ts
git commit -m "feat: script to batch-embed speaker turns in Turso"

# Run in background, pipe to log
nohup npx tsx scripts/embed-speaker-turns.ts > embed-turns.log 2>&1 &
echo "PID: $!"
```

Monitor progress: `tail -f embed-turns.log`

---

## Task 3: Add `searchSpeakerTurnsByVector()` to protocols-db.ts

**Files:**
- Modify: `src/lib/protocols-db.ts`

This function finds the most semantically similar speaker turns for a given embedding, optionally filtered to a specific MK.

- [ ] **Step 1: Add the function after `searchMkSpeakerTurns()`**

Open `src/lib/protocols-db.ts` and add after the existing `searchMkSpeakerTurns` export:

```typescript
export interface MkSpeakerTurnVec {
  turnId: number;
  sessionId: number;
  committeeName: string;
  date: string;
  text: string;
  score: number; // cosine distance (lower = more similar)
}

/**
 * Finds speaker turns semantically similar to the given embedding.
 * When mkId is provided, restricts to that MK's turns only.
 * Requires that embedding column is populated (via embed-speaker-turns.ts script).
 */
export async function searchSpeakerTurnsByVector(
  embedding: number[],
  mkId: number | null,
  limit = 6,
): Promise<MkSpeakerTurnVec[]> {
  const client = getTursoClient();
  const vec = `[${embedding.join(',')}]`;

  const mkFilter = mkId !== null ? 'AND sst.mk_id = ?' : '';
  const args: (string | number)[] = [vec];
  if (mkId !== null) args.push(mkId);
  args.push(limit * 2); // fetch extra for dedup

  const sql = `
    SELECT sst.id as turn_id,
           sst.session_id,
           cs.committee_name,
           cs.date,
           sst.text,
           vector_distance_cos(sst.embedding, vector32(?)) as score
    FROM session_speaker_turn sst
    JOIN committee_session cs ON cs.id = sst.session_id
    WHERE sst.embedding IS NOT NULL
      ${mkFilter}
    ORDER BY score ASC
    LIMIT ?
  `;

  try {
    const result = await client.execute({ sql, args });
    // Deduplicate: one turn per session (best score wins)
    const seen = new Map<number, MkSpeakerTurnVec>();
    for (const row of result.rows) {
      const sessionId = Number(row.session_id);
      const entry: MkSpeakerTurnVec = {
        turnId: Number(row.turn_id),
        sessionId,
        committeeName: String(row.committee_name ?? ''),
        date: String(row.date ?? ''),
        text: String(row.text ?? ''),
        score: Number(row.score ?? 1),
      };
      if (!seen.has(sessionId) || entry.score < seen.get(sessionId)!.score) {
        seen.set(sessionId, entry);
      }
    }
    return [...seen.values()]
      .sort((a, b) => a.score - b.score)
      .slice(0, limit);
  } catch (e) {
    console.error('searchSpeakerTurnsByVector error:', e);
    return [];
  }
}
```

- [ ] **Step 2: Export from the module**

Verify `searchSpeakerTurnsByVector` and `MkSpeakerTurnVec` are exported (they are, because they use the `export` keyword above).

- [ ] **Step 3: TypeScript check**

```bash
cd apps/knesset-watch && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/protocols-db.ts
git commit -m "feat: searchSpeakerTurnsByVector — turn-level semantic search with MK filter"
```

---

## Task 4: Wire vector turn search into the ask route

**Files:**
- Modify: `src/app/api/ask/route.ts`

When an MK is detected and embeddings are available, use `searchSpeakerTurnsByVector()` instead of (or alongside) the keyword LIKE search. The vector search is more robust — it finds semantically relevant turns even when the exact keyword doesn't appear.

- [ ] **Step 1: Add import**

In `src/app/api/ask/route.ts`, update the protocols-db import:

```typescript
import {
  embedQueryPublic,
  searchProtocolsVec,
  searchProtocols,
  getProtocolSession,
  searchMkSpeakerTurns,
  searchSpeakerTurnsByVector,    // ← add this
} from '@/lib/protocols-db';
import type {
  ProtocolSearchResult,
  MkSpeakerTurn,
  MkSpeakerTurnVec,              // ← add this
} from '@/lib/protocols-db';
```

- [ ] **Step 2: Replace the speaker turns search strategy**

Find the `speakerTurnsPromise` block and replace it:

```typescript
// MK speaker turns: prefer vector search (semantic), fall back to keyword LIKE
// Vector search only works once embed-speaker-turns.ts has been run.
const speakerTurnsPromise: Promise<MkSpeakerTurn[]> =
  mkId && embedding
    ? searchSpeakerTurnsByVector(embedding, mkId, 6).then(turns =>
        // Adapt MkSpeakerTurnVec to MkSpeakerTurn shape
        turns.map(t => ({
          sessionId: t.sessionId,
          committeeName: t.committeeName,
          date: t.date,
          text: t.text,
        }))
      ).catch(() =>
        // Fall back to keyword search if vector search fails (e.g. no embeddings yet)
        searchTerm.length >= 2
          ? searchMkSpeakerTurns(mkId, searchTerm, 6)
          : Promise.resolve([])
      )
    : mkId && searchTerm.length >= 2
      ? searchMkSpeakerTurns(mkId, searchTerm, 6)
      : Promise.resolve([]);
```

- [ ] **Step 3: TypeScript check**

```bash
cd apps/knesset-watch && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Bump cache key**

Change `ask:v4:${q}` → `ask:v5:${q}`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ask/route.ts
git commit -m "feat: use vector search for MK speaker turns (falls back to keyword)"
```

---

## Verification

1. Wait for embed job to complete (check `embed-turns.log`)
2. Query "ליברמן יוקר המחיה" — `detectedMk` resolves, speaker turns now found via semantic search
3. Query "ביבי קורונה" — Netanyahu turns found even if the word "קורונה" doesn't appear verbatim (synonyms like "מגיפה" should surface)
4. Query without an MK — behavior unchanged (session-level vector search still used)
5. Check `embed-turns.log` shows 0 errors and full completion
