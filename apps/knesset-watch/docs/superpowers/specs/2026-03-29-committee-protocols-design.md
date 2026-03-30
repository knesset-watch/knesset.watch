# Committee Protocols — Design Spec
**Date:** 2026-03-29
**App:** knesset-watch (Israeli political tracker)

## Overview

Scrape all K25 Knesset committee session protocols (meeting transcripts), store them as searchable full text, and surface them in the app via a global search page and a per-committee tab. The storage schema is designed for RAG (Retrieval-Augmented Generation) from the start — an in-app chatbot is the intended future phase.

---

## 1. Data Pipeline

### Script: `scripts/scrape-protocols.ts` (one-time, runs locally)

Three phases:

**Phase 1 — Discover documents**
- Iterate all rows in `committee_session` (9,611 K25 sessions)
- For each session, call `KNS_DocumentCommitteeSession?$filter=CommitteeSessionID eq {id}`
- Filter to the protocol `GroupTypeID` — the correct value must be verified by probing the API on a known session before the full scrape runs
- Prefer `.docx` over `.doc` (old binary format); `.doc` files are skipped since `mammoth` only handles `.docx`; skip sessions with no usable protocol document
- Collect: `session_id → doc_url`

**Phase 2 — Download & parse**
- Download each `.docx` file
- Extract plain text with `mammoth`
- Strip boilerplate headers/footers

**Phase 3 — Chunk & store**
- Split text into ~500-token chunks with ~50-token overlap
- Prefer splitting on speaker boundaries (`היו"ר`, `ח"כ`, etc.) to avoid cutting mid-speaker
- Parse speaker name per chunk where detectable
- Store each chunk in `protocols.db`

**Rate limiting:** 5 concurrent downloads, polite delays between batches.
**Estimated runtime:** 3–6 hours for all K25 sessions.
**Resumable:** skips sessions already present in `protocols.db`.

### Incremental updates
A separate `scripts/sync-protocols.ts` script (not added to the existing `sync.ts`) picks up new sessions added after the initial seed and appends their protocols to `protocols.db`.

---

## 2. Storage: `protocols.db`

Separate SQLite file (not part of `knesset.db`). Tracked in git via **Git LFS** due to expected size (200–400MB).

### Schema

```sql
CREATE TABLE session_protocol (
  session_id    INTEGER PRIMARY KEY,  -- matches committee_session.id
  committee_id  INTEGER NOT NULL,
  committee_name TEXT,               -- denormalized from knesset.db for standalone queries
  date          TEXT NOT NULL,
  title         TEXT,
  doc_url       TEXT,
  chunk_count   INTEGER DEFAULT 0
);

CREATE TABLE protocol_chunk (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    INTEGER NOT NULL REFERENCES session_protocol(session_id),
  chunk_index   INTEGER NOT NULL,
  text          TEXT NOT NULL,
  speaker       TEXT,   -- parsed speaker name, NULL if not detectable
  embedding     BLOB    -- NULL in this phase; filled by future embedding script
);

CREATE INDEX idx_chunk_session ON protocol_chunk(session_id, chunk_index);

-- Standalone FTS table (stores text directly, no triggers needed for write-once data)
CREATE VIRTUAL TABLE protocol_chunk_fts USING fts5(
  text,
  chunk_id UNINDEXED,  -- rowid of protocol_chunk for join
  tokenize='unicode61'
);
-- Scrape script inserts into both protocol_chunk and protocol_chunk_fts explicitly.
```

### RAG readiness
- `embedding BLOB` column is present from day one — NULL until a future script fills it
- `speaker` metadata enables per-speaker filtering in RAG queries
- Chunk size (~500 tokens) is appropriate for embedding models
- No re-scraping needed when adding vector search — just run the embedding script over existing chunks

---

## 3. API Layer

New file: `src/lib/protocols-db.ts` — opens `protocols.db`, same pattern as `knesset-db.ts`.

### Routes

**`GET /api/protocols/search?q=&committee=&page=`**
- Queries FTS5: `SELECT ... FROM protocol_chunk_fts WHERE protocol_chunk_fts MATCH ?`
- Joins with `session_protocol` for metadata
- Optional `committee` param filters by `committee_name`
- Returns 20 results per page: `{ chunks: [...], total, page }`
- Each chunk result includes: `chunkId, sessionId, committeeId, committeeName, date, title, snippet (highlighted), speaker`

**`GET /api/protocols/session/[id]`**
- Returns all chunks for a session ordered by `chunk_index`
- Also returns session metadata: `{ session: {...}, chunks: [{text, speaker, chunkIndex}] }`
- Used when user expands a protocol inline

---

## 4. UI

### New page: `/protocols`

Global protocol search page.

- Hebrew RTL, same design language as the rest of the app
- Search input at top
- Committee filter chips below (one per committee that has protocols)
- Results list: each result card shows:
  - Committee name + session date
  - Speaker name (if available)
  - Text excerpt with search term highlighted
- Clicking a result expands inline to show the full session protocol text, with search term highlighted throughout
- Full text is fetched from `/api/protocols/session/[id]` on first expand (lazy)

### Committee page: new tab

Adds a "פרוטוקולים" tab to `/committee/[name]`.

- Lists sessions for this committee that have protocols, sorted by date descending
- Search input filters within this committee's protocols only
- Same expand-inline behavior as the global page
- Session count in the header (already present) now reflects real data

---

## 5. Future Phase: In-App RAG Chatbot

Not in scope for this implementation, but the schema supports it directly:

1. **Embedding script** (`scripts/embed-protocols.ts`): iterates chunks with `embedding IS NULL`, calls an embedding API, stores vectors in the `embedding` column
2. **`sqlite-vec` extension**: enables vector similarity search over `protocols.db`
3. **`/protocols/chat` page**: conversational interface — user asks a question, app retrieves top-k chunks by vector similarity, passes to Claude API for a grounded answer

---

## 6. Git LFS Setup

```bash
git lfs install
git lfs track "apps/knesset-watch/protocols.db"
# Adds entry to .gitattributes
git add .gitattributes
git commit -m "chore: track protocols.db via Git LFS"
```

Vercel automatically fetches LFS objects during build — no additional configuration needed.

---

## Out of Scope

- Full-text search across protocols in languages other than Hebrew
- Displaying vote records or bill links within protocol context (future)
- Per-MK protocol appearance tracking (future — attendance table already exists for this)
