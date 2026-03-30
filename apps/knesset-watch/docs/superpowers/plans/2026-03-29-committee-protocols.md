# Committee Protocols Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scrape all K25 Knesset committee session protocols, store them as chunked full text in a RAG-ready SQLite DB, and surface them via a global search page and a per-committee tab.

**Architecture:** A one-time scrape script downloads protocol `.docx` files from the Knesset API, parses them with `mammoth`, splits into ~500-token chunks (with speaker detection), and stores them in `protocols.db` with SQLite FTS5 for keyword search. The DB is tracked in git via LFS and read at runtime by Next.js API routes — same pattern as the existing `knesset.db`. An `embedding BLOB` column in the chunk table is left NULL for a future vector-search phase.

**Tech Stack:** TypeScript, better-sqlite3, mammoth (docx→text), SQLite FTS5 with unicode61 tokenizer, Git LFS, Next.js App Router, Tailwind CSS

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `scripts/probe-protocol-api.ts` | Create | One-time probe: discover correct GroupTypeID for protocols |
| `scripts/scrape-protocols.ts` | Create | One-time full scrape: fetch URLs → download → parse → chunk → store |
| `scripts/sync-protocols.ts` | Create | Incremental sync: append new sessions' protocols to protocols.db |
| `protocols.db` | Create (LFS) | SQLite DB with session_protocol, protocol_chunk, protocol_chunk_fts tables |
| `src/lib/protocols-db.ts` | Create | DB access layer: open protocols.db, search, get session |
| `src/app/api/protocols/search/route.ts` | Create | FTS5 search API: `?q=&committee=&page=` |
| `src/app/api/protocols/session/[id]/route.ts` | Create | Full session text API |
| `src/app/protocols/page.tsx` | Create | Global protocols search page (server, auth) |
| `src/app/protocols/ProtocolsClient.tsx` | Create | Client component: search input, committee chips, results, inline expand |
| `src/app/committee/[name]/CommitteeClient.tsx` | Modify | Add "פרוטוקולים" tab |
| `src/app/committee/[name]/page.tsx` | Modify | Pass protocol session list to client |
| `src/lib/knesset-db.ts` | Modify | Add `getCommitteeProtocolSessions()` helper |
| `next.config.ts` | Modify | Add `protocols.db` to `outputFileTracingIncludes` |
| `package.json` | Modify | Add `mammoth` dep + script entries |
| `.gitattributes` | Create/Modify | Track protocols.db via Git LFS |

---

## Task 1: Git LFS + mammoth setup

**Files:**
- Modify: `package.json`
- Create/Modify: `.gitattributes`

- [ ] **Step 1: Install mammoth and its types**

```bash
cd apps/knesset-watch
npm install mammoth
npm install --save-dev @types/mammoth
```

Expected output: mammoth added to `node_modules/`, `package.json` updated.

- [ ] **Step 2: Enable Git LFS and track protocols.db**

Run from the monorepo root:
```bash
git lfs install
git lfs track "apps/knesset-watch/protocols.db"
```

This creates or updates `.gitattributes` at the monorepo root with:
```
apps/knesset-watch/protocols.db filter=lfs diff=lfs merge=lfs -text
```

- [ ] **Step 3: Verify .gitattributes and commit**

```bash
cat .gitattributes
git add .gitattributes
git commit -m "chore: track apps/knesset-watch/protocols.db via Git LFS"
```

- [ ] **Step 4: Add script entries to apps/knesset-watch/package.json**

In the `"scripts"` section, add:
```json
"db:probe-protocols": "tsx scripts/probe-protocol-api.ts",
"db:scrape-protocols": "tsx scripts/scrape-protocols.ts",
"db:sync-protocols": "tsx scripts/sync-protocols.ts"
```

- [ ] **Step 5: Commit package.json**

```bash
git add apps/knesset-watch/package.json
git commit -m "chore(knesset-watch): add mammoth dep and protocol script entries"
```

---

## Task 2: Probe Knesset API to verify document structure

This script runs once to find the correct `GroupTypeID` for protocol documents. Do not proceed to the full scrape until you know this value.

**Files:**
- Create: `apps/knesset-watch/scripts/probe-protocol-api.ts`

- [ ] **Step 1: Write the probe script**

```typescript
// scripts/probe-protocol-api.ts
// Run: npm run db:probe-protocols
// Purpose: Discover what GroupTypeID corresponds to protocol documents.

import Database from 'better-sqlite3';
import path from 'path';

const API = 'https://knesset.gov.il/OdataV4/ParliamentInfo';
const DB_PATH = path.join(process.cwd(), 'knesset.db');

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function probe() {
  const db = new Database(DB_PATH, { readonly: true });

  // Pick 20 sessions spread across different committees
  const sessions = db.prepare(`
    SELECT id, committee_id, date FROM committee_session
    ORDER BY id DESC LIMIT 20
  `).all() as Array<{ id: number; committee_id: number; date: string }>;

  console.log(`Probing ${sessions.length} sessions...\n`);

  const groupTypeCounts: Record<string, number> = {};
  let sessionsWithDocs = 0;

  for (const s of sessions) {
    const url = `${API}/KNS_DocumentCommitteeSession?$filter=CommitteeSessionID eq ${s.id}&$select=GroupTypeID,GroupTypeDesc,ApplicationID,ApplicationDesc,FilePath`;
    try {
      const json = await fetchJson(url);
      const docs: any[] = json.value ?? [];
      if (docs.length > 0) {
        sessionsWithDocs++;
        for (const doc of docs) {
          const key = `GroupTypeID=${doc.GroupTypeID} (${doc.GroupTypeDesc}) | AppID=${doc.ApplicationID} (${doc.ApplicationDesc})`;
          groupTypeCounts[key] = (groupTypeCounts[key] ?? 0) + 1;
          if (doc.FilePath) {
            console.log(`Session ${s.id}: ${key}`);
            console.log(`  FilePath: ${doc.FilePath}`);
          }
        }
      }
    } catch (e: any) {
      console.log(`Session ${s.id}: ERROR — ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n=== GroupType Summary ===');
  for (const [k, v] of Object.entries(groupTypeCounts)) {
    console.log(`  ${v}x ${k}`);
  }
  console.log(`\nSessions with documents: ${sessionsWithDocs}/${sessions.length}`);
  db.close();
}

probe().catch(err => {
  console.error(err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Run the probe**

```bash
cd apps/knesset-watch
npm run db:probe-protocols
```

Expected output: a table of `GroupTypeID` values and their descriptions. Look for entries whose description contains "פרוטוקול" (protocol). Note the `GroupTypeID` and whether docs are `.docx` or `.doc`.

If the API returns errors, wait and retry — the Knesset API has intermittent downtime. If it consistently fails, check `https://knesset.gov.il/OdataV4/ParliamentInfo/KNS_DocumentCommitteeSession?$top=3` in a browser to verify connectivity.

- [ ] **Step 3: Record the GroupTypeID**

Once you know the correct value, note it here and use it in Task 3. The spec assumed GroupTypeID=23 but this must be confirmed from the probe output.

**Protocol GroupTypeID confirmed: _____ (fill in from probe output)**

- [ ] **Step 4: Commit the probe script (keep it for reference)**

```bash
git add apps/knesset-watch/scripts/probe-protocol-api.ts
git commit -m "chore(knesset-watch): add probe script for protocol document API"
```

---

## Task 3: Initialize protocols.db schema

**Files:**
- Create: `apps/knesset-watch/scripts/init-protocols-db.ts`

- [ ] **Step 1: Write the init script**

```typescript
// scripts/init-protocols-db.ts
// Run: npx tsx scripts/init-protocols-db.ts
// Creates protocols.db with the full schema. Safe to re-run (CREATE IF NOT EXISTS).

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'protocols.db');

function init() {
  const db = new Database(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_protocol (
      session_id    INTEGER PRIMARY KEY,
      committee_id  INTEGER NOT NULL,
      committee_name TEXT,
      date          TEXT NOT NULL,
      title         TEXT,
      doc_url       TEXT,
      chunk_count   INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS protocol_chunk (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    INTEGER NOT NULL REFERENCES session_protocol(session_id),
      chunk_index   INTEGER NOT NULL,
      text          TEXT NOT NULL,
      speaker       TEXT,
      embedding     BLOB
    );

    CREATE INDEX IF NOT EXISTS idx_chunk_session
      ON protocol_chunk(session_id, chunk_index);

    CREATE VIRTUAL TABLE IF NOT EXISTS protocol_chunk_fts USING fts5(
      text,
      chunk_id UNINDEXED,
      session_id UNINDEXED,
      committee_name UNINDEXED,
      date UNINDEXED,
      speaker UNINDEXED,
      tokenize='unicode61'
    );
  `);

  db.close();
  console.log(`protocols.db initialized at ${DB_PATH}`);
}

init();
```

- [ ] **Step 2: Run it**

```bash
cd apps/knesset-watch
npx tsx scripts/init-protocols-db.ts
```

Expected: `protocols.db initialized at .../apps/knesset-watch/protocols.db`

- [ ] **Step 3: Verify schema**

```bash
sqlite3 protocols.db ".tables"
```

Expected output:
```
protocol_chunk      protocol_chunk_fts  session_protocol
```

- [ ] **Step 4: Add init script to package.json and commit**

In `apps/knesset-watch/package.json` scripts:
```json
"db:init-protocols": "tsx scripts/init-protocols-db.ts"
```

```bash
git add apps/knesset-watch/scripts/init-protocols-db.ts apps/knesset-watch/package.json
git commit -m "feat(knesset-watch): protocols.db schema init script"
```

---

## Task 4: Scrape script — full pipeline

This is the main one-time script. It runs for several hours. It's resumable: any session already in `session_protocol` is skipped.

**Files:**
- Create: `apps/knesset-watch/scripts/scrape-protocols.ts`

- [ ] **Step 1: Write the scrape script**

Replace `PROTOCOL_GROUP_TYPE_ID` with the value you confirmed in Task 2.

```typescript
// scripts/scrape-protocols.ts
// Run: npm run db:scrape-protocols
// One-time full scrape of all K25 committee session protocols.
// Resumable: already-scraped sessions are skipped.

import Database from 'better-sqlite3';
import mammoth from 'mammoth';
import path from 'path';

const API = 'https://knesset.gov.il/OdataV4/ParliamentInfo';
const KNESSET_DB = path.join(process.cwd(), 'knesset.db');
const PROTOCOLS_DB = path.join(process.cwd(), 'protocols.db');

// !! FILL IN from Task 2 probe output !!
const PROTOCOL_GROUP_TYPE_ID = 23;
// ApplicationID: 4=PDF, 1=DOC, 2=DOCX — prefer highest fidelity docx
const PREFERRED_APP_IDS = [2, 1]; // docx first, then doc; skip PDF (not parseable by mammoth)

const CHUNK_SIZE = 3000;    // characters (~500 Hebrew tokens)
const CHUNK_OVERLAP = 300;  // characters

// Speaker line patterns (Hebrew Knesset protocols)
const SPEAKER_RE = /^(היו"ר|ח"כ|מר|גב'|ד"ר|פרופ'|שר|סגן שר)\s+([^\n:：]{2,40})[:：]/mu;
const SPEAKER_LINE_RE = /^([^\n:：]{2,40})[:：]\s*$/mu;

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchAll(url: string): Promise<any[]> {
  const results: any[] = [];
  let next: string | null = url;
  while (next) {
    const json = await fetchJson(next);
    results.push(...(json.value ?? []));
    next = json['@odata.nextLink'] ?? null;
  }
  return results;
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`Download HTTP ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function extractSpeaker(line: string): string | null {
  const m = line.match(SPEAKER_RE);
  if (m) return `${m[1]} ${m[2]}`.trim();
  const m2 = line.match(SPEAKER_LINE_RE);
  if (m2) return m2[1].trim();
  return null;
}

function chunkText(text: string): Array<{ text: string; speaker: string | null }> {
  // Split on speaker turns first
  const lines = text.split('\n');
  const turns: Array<{ speaker: string | null; text: string }> = [];
  let currentSpeaker: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const speaker = extractSpeaker(line);
    if (speaker && currentLines.join('\n').length > 50) {
      // Flush current turn
      const t = currentLines.join('\n').trim();
      if (t.length > 20) turns.push({ speaker: currentSpeaker, text: t });
      currentSpeaker = speaker;
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.length) {
    const t = currentLines.join('\n').trim();
    if (t.length > 20) turns.push({ speaker: currentSpeaker, text: t });
  }

  // Now split each turn into CHUNK_SIZE chunks if needed
  const chunks: Array<{ text: string; speaker: string | null }> = [];
  for (const turn of turns) {
    if (turn.text.length <= CHUNK_SIZE) {
      chunks.push(turn);
    } else {
      let i = 0;
      while (i < turn.text.length) {
        const slice = turn.text.slice(i, i + CHUNK_SIZE);
        chunks.push({ text: slice, speaker: turn.speaker });
        i += CHUNK_SIZE - CHUNK_OVERLAP;
      }
    }
  }
  return chunks;
}

async function processSession(
  session: { id: number; committee_id: number; committee_name: string | null; date: string; title: string | null },
  db: Database.Database,
  insertSession: Database.Statement,
  insertChunk: Database.Statement,
  insertFts: Database.Statement,
): Promise<boolean> {
  // Fetch available documents for this session
  const docs = await fetchAll(
    `${API}/KNS_DocumentCommitteeSession?$filter=CommitteeSessionID eq ${session.id} and GroupTypeID eq ${PROTOCOL_GROUP_TYPE_ID}&$select=ApplicationID,ApplicationDesc,FilePath`,
  );

  if (docs.length === 0) return false; // No protocol for this session

  // Pick best available document: prefer docx, then doc; skip PDF
  let chosen: { url: string; appId: number } | null = null;
  for (const preferredId of PREFERRED_APP_IDS) {
    const doc = docs.find((d: any) => d.ApplicationID === preferredId && d.FilePath);
    if (doc) {
      chosen = { url: doc.FilePath, appId: preferredId };
      break;
    }
  }
  if (!chosen) return false;

  // Download and parse
  const buf = await downloadBuffer(chosen.url);
  const result = await mammoth.extractRawText({ buffer: buf });
  const text = result.value.trim();
  if (text.length < 100) return false; // Empty or unreadable

  // Chunk
  const chunks = chunkText(text);
  if (chunks.length === 0) return false;

  // Store — single transaction per session
  db.transaction(() => {
    insertSession.run(
      session.id,
      session.committee_id,
      session.committee_name,
      session.date,
      session.title,
      chosen!.url,
      chunks.length,
    );
    for (let i = 0; i < chunks.length; i++) {
      const result = insertChunk.run(
        session.id,
        i,
        chunks[i].text,
        chunks[i].speaker ?? null,
      );
      const chunkId = result.lastInsertRowid;
      insertFts.run(
        chunks[i].text,
        chunkId,
        session.id,
        session.committee_name ?? '',
        session.date,
        chunks[i].speaker ?? '',
      );
    }
  })();

  return true;
}

async function scrape() {
  const knessetDb = new Database(KNESSET_DB, { readonly: true });
  const db = new Database(PROTOCOLS_DB);

  // Prepare statements
  const insertSession = db.prepare(`
    INSERT OR REPLACE INTO session_protocol
      (session_id, committee_id, committee_name, date, title, doc_url, chunk_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertChunk = db.prepare(`
    INSERT INTO protocol_chunk (session_id, chunk_index, text, speaker)
    VALUES (?, ?, ?, ?)
  `);
  const insertFts = db.prepare(`
    INSERT INTO protocol_chunk_fts (text, chunk_id, session_id, committee_name, date, speaker)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // Get all K25 sessions, skip already processed
  const alreadyDone = new Set(
    (db.prepare('SELECT session_id FROM session_protocol').all() as any[]).map(r => r.session_id)
  );

  const sessions = knessetDb.prepare(`
    SELECT cs.id, cs.committee_id, cs.date, cs.title,
           b.committee_name
    FROM committee_session cs
    LEFT JOIN (
      SELECT DISTINCT committee_id, committee_name FROM bill
      WHERE committee_id != -1 AND committee_name IS NOT NULL
    ) b ON b.committee_id = cs.committee_id
    ORDER BY cs.id ASC
  `).all() as Array<{
    id: number; committee_id: number; date: string; title: string | null; committee_name: string | null;
  }>;

  const todo = sessions.filter(s => !alreadyDone.has(s.id));
  console.log(`${sessions.length} total sessions, ${alreadyDone.size} already done, ${todo.length} to process`);

  let processed = 0;
  let withProtocol = 0;
  let errors = 0;
  const CONCURRENCY = 5;
  const DELAY_MS = 250;

  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(s => processSession(s, db, insertSession, insertChunk, insertFts))
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        if (r.value) withProtocol++;
      } else {
        errors++;
      }
    }
    processed += batch.length;
    if (processed % 100 === 0) {
      console.log(`  ${processed}/${todo.length} — ${withProtocol} protocols found, ${errors} errors`);
    }
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`\nDone. ${withProtocol} protocols scraped, ${errors} errors out of ${processed} sessions.`);
  knessetDb.close();
  db.close();
}

scrape().catch(err => {
  console.error('Scrape failed:', err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Run a test on 10 sessions to verify the pipeline works before the full run**

Edit the `ORDER BY cs.id ASC` line to add `LIMIT 10` temporarily, run:

```bash
cd apps/knesset-watch
npm run db:scrape-protocols
```

Expected: output like `10/10 — 4 protocols found, 0 errors`

Check the DB:
```bash
sqlite3 protocols.db "SELECT COUNT(*) FROM session_protocol; SELECT COUNT(*) FROM protocol_chunk;"
```

Expected: non-zero counts.

Inspect one protocol:
```bash
sqlite3 protocols.db "SELECT session_id, chunk_count, date FROM session_protocol LIMIT 3;"
sqlite3 protocols.db "SELECT id, session_id, chunk_index, length(text), speaker FROM protocol_chunk LIMIT 5;"
```

- [ ] **Step 3: Remove the LIMIT 10, run the full scrape**

This will take 3–6 hours. Run in a terminal you can leave open:
```bash
cd apps/knesset-watch
npm run db:scrape-protocols
```

The script logs progress every 100 sessions. It's resumable if interrupted.

- [ ] **Step 4: Verify final counts**

```bash
sqlite3 protocols.db "SELECT COUNT(*) FROM session_protocol;"
sqlite3 protocols.db "SELECT COUNT(*) FROM protocol_chunk;"
sqlite3 protocols.db "SELECT protocol_chunk_fts MATCH 'ביטוח לאומי' FROM protocol_chunk_fts LIMIT 3;" 2>/dev/null || \
  sqlite3 protocols.db "SELECT text FROM protocol_chunk_fts WHERE protocol_chunk_fts MATCH 'ביטוח לאומי' LIMIT 3;"
```

Expected: thousands of sessions and chunks; FTS search returns results.

- [ ] **Step 5: Commit the scrape script and protocols.db**

```bash
cd apps/knesset-watch
git add scripts/scrape-protocols.ts
git add protocols.db   # tracked via LFS — git lfs will handle the large file
git commit -m "feat(knesset-watch): protocol scrape script + protocols.db (K25)"
```

Verify LFS is handling it:
```bash
git lfs ls-files | grep protocols.db
```
Expected: `* apps/knesset-watch/protocols.db`

---

## Task 5: protocols-db.ts — data access layer

**Files:**
- Create: `apps/knesset-watch/src/lib/protocols-db.ts`

- [ ] **Step 1: Write protocols-db.ts**

```typescript
// src/lib/protocols-db.ts
// Data access layer for protocols.db — same singleton pattern as knesset-db.ts.

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'protocols.db');

let _db: Database.Database | null = null;

function getDb(): Database.Database | null {
  if (_db) return _db;
  if (!fs.existsSync(DB_PATH)) return null;
  _db = new Database(DB_PATH, { readonly: true });
  return _db;
}

export function protocolsDbAvailable(): boolean {
  return fs.existsSync(DB_PATH);
}

export interface ProtocolSearchResult {
  chunkId: number;
  sessionId: number;
  committeeId: number;
  committeeName: string;
  date: string;
  title: string | null;
  speaker: string | null;
  snippet: string;
}

export interface ProtocolSearchResponse {
  results: ProtocolSearchResult[];
  total: number;
  page: number;
}

export function searchProtocols(
  query: string,
  committee: string | null,
  page: number,
): ProtocolSearchResponse {
  const db = getDb();
  if (!db) return { results: [], total: 0, page };

  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  // Escape special FTS5 characters
  const safeQuery = query.replace(/["*^()]/g, ' ').trim();
  if (!safeQuery) return { results: [], total: 0, page };

  const committeeFilter = committee ? 'AND f.committee_name = ?' : '';
  const params: (string | number)[] = [safeQuery];
  if (committee) params.push(committee);

  const countParams = [...params];
  const queryParams = [...params, pageSize, offset];

  const countSql = `
    SELECT COUNT(*) as cnt
    FROM protocol_chunk_fts f
    WHERE f MATCH ?
    ${committeeFilter}
  `;

  const searchSql = `
    SELECT
      f.chunk_id as chunkId,
      f.session_id as sessionId,
      sp.committee_id as committeeId,
      f.committee_name as committeeName,
      f.date,
      sp.title,
      f.speaker,
      snippet(protocol_chunk_fts, 0, '<mark>', '</mark>', '...', 20) as snippet
    FROM protocol_chunk_fts f
    JOIN session_protocol sp ON sp.session_id = f.session_id
    WHERE f MATCH ?
    ${committeeFilter}
    ORDER BY rank
    LIMIT ? OFFSET ?
  `;

  const total = (db.prepare(countSql).get(...countParams) as { cnt: number }).cnt;
  const rows = db.prepare(searchSql).all(...queryParams) as ProtocolSearchResult[];

  return { results: rows, total, page };
}

export interface ProtocolSession {
  sessionId: number;
  committeeId: number;
  committeeName: string | null;
  date: string;
  title: string | null;
  docUrl: string | null;
  chunkCount: number;
}

export interface ProtocolChunk {
  chunkIndex: number;
  text: string;
  speaker: string | null;
}

export function getProtocolSession(sessionId: number): { session: ProtocolSession; chunks: ProtocolChunk[] } | null {
  const db = getDb();
  if (!db) return null;

  const session = db.prepare(`
    SELECT session_id as sessionId, committee_id as committeeId, committee_name as committeeName,
           date, title, doc_url as docUrl, chunk_count as chunkCount
    FROM session_protocol WHERE session_id = ?
  `).get(sessionId) as ProtocolSession | undefined;

  if (!session) return null;

  const chunks = db.prepare(`
    SELECT chunk_index as chunkIndex, text, speaker
    FROM protocol_chunk
    WHERE session_id = ?
    ORDER BY chunk_index ASC
  `).all(sessionId) as ProtocolChunk[];

  return { session, chunks };
}

export interface CommitteeProtocolSession {
  sessionId: number;
  date: string;
  title: string | null;
  chunkCount: number;
}

export function getCommitteeProtocolSessions(committeeName: string): CommitteeProtocolSession[] {
  const db = getDb();
  if (!db) return [];

  return db.prepare(`
    SELECT session_id as sessionId, date, title, chunk_count as chunkCount
    FROM session_protocol
    WHERE committee_name = ?
    ORDER BY date DESC
  `).all(committeeName) as CommitteeProtocolSession[];
}

export function getProtocolCommitteeNames(): string[] {
  const db = getDb();
  if (!db) return [];

  return (
    db.prepare(`
      SELECT DISTINCT committee_name FROM session_protocol
      WHERE committee_name IS NOT NULL
      ORDER BY committee_name ASC
    `).all() as Array<{ committee_name: string }>
  ).map(r => r.committee_name);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/knesset-watch
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/knesset-watch/src/lib/protocols-db.ts
git commit -m "feat(knesset-watch): protocols-db.ts data access layer"
```

---

## Task 6: Update next.config.ts to include protocols.db

**Files:**
- Modify: `apps/knesset-watch/next.config.ts`

- [ ] **Step 1: Add protocols.db to outputFileTracingIncludes**

In `next.config.ts`, change:
```typescript
  outputFileTracingIncludes: {
    '/api/**/*': ['./knesset.db'],
  },
```
to:
```typescript
  outputFileTracingIncludes: {
    '/api/**/*': ['./knesset.db', './protocols.db'],
    '/protocols': ['./protocols.db'],
  },
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/knesset-watch
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/knesset-watch/next.config.ts
git commit -m "feat(knesset-watch): include protocols.db in Vercel output file tracing"
```

---

## Task 7: Search API route

**Files:**
- Create: `apps/knesset-watch/src/app/api/protocols/search/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/protocols/search/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { validateApiAuth } from '@minimal-db/ui/auth-utils';
import { searchProtocols } from '@/lib/protocols-db';

export async function GET(req: NextRequest) {
  const isAuthenticated = await validateApiAuth(req, 'SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const q = (searchParams.get('q') ?? '').trim();
  const committee = searchParams.get('committee') || null;
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));

  if (!q) return NextResponse.json({ results: [], total: 0, page });

  const data = searchProtocols(q, committee, page);
  return NextResponse.json(data);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/knesset-watch
npx tsc --noEmit
```

- [ ] **Step 3: Test the route locally**

Start the dev server (`npm run dev` from monorepo root or `npm run dev -w apps/knesset-watch`), then open:
```
http://localhost:3001/knesset-watch/api/protocols/search?q=ביטוח
```

Expected: JSON with `results`, `total`, `page` fields.

- [ ] **Step 4: Commit**

```bash
git add apps/knesset-watch/src/app/api/protocols/search/route.ts
git commit -m "feat(knesset-watch): /api/protocols/search route"
```

---

## Task 8: Session API route

**Files:**
- Create: `apps/knesset-watch/src/app/api/protocols/session/[id]/route.ts`

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/protocols/session/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { validateApiAuth } from '@minimal-db/ui/auth-utils';
import { getProtocolSession } from '@/lib/protocols-db';

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: Props) {
  const isAuthenticated = await validateApiAuth(req, 'SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const sessionId = parseInt(id, 10);
  if (isNaN(sessionId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const data = getProtocolSession(sessionId);
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(data);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/knesset-watch
npx tsc --noEmit
```

- [ ] **Step 3: Test locally**

Get a real session_id from the DB:
```bash
sqlite3 apps/knesset-watch/protocols.db "SELECT session_id FROM session_protocol LIMIT 1;"
```

Then open `http://localhost:3001/knesset-watch/api/protocols/session/{that_id}`.

Expected: JSON with `session` and `chunks` arrays.

- [ ] **Step 4: Commit**

```bash
git add apps/knesset-watch/src/app/api/protocols/session/
git commit -m "feat(knesset-watch): /api/protocols/session/[id] route"
```

---

## Task 9: Global /protocols search page

**Files:**
- Create: `apps/knesset-watch/src/app/protocols/page.tsx`
- Create: `apps/knesset-watch/src/app/protocols/ProtocolsClient.tsx`

- [ ] **Step 1: Write page.tsx (server component, auth)**

```typescript
// src/app/protocols/page.tsx
import { checkServerAuth } from '@minimal-db/ui/auth-utils';
import { redirect } from 'next/navigation';
import { getProtocolCommitteeNames } from '@/lib/protocols-db';
import ProtocolsClient from './ProtocolsClient';

export default async function ProtocolsPage() {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) redirect('/login');

  const committees = getProtocolCommitteeNames();

  return <ProtocolsClient committees={committees} />;
}
```

- [ ] **Step 2: Write ProtocolsClient.tsx**

```typescript
// src/app/protocols/ProtocolsClient.tsx
'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface SearchResult {
  chunkId: number;
  sessionId: number;
  committeeId: number;
  committeeName: string;
  date: string;
  title: string | null;
  speaker: string | null;
  snippet: string;
}

interface FullProtocol {
  session: {
    sessionId: number;
    committeeName: string | null;
    date: string;
    title: string | null;
    chunkCount: number;
  };
  chunks: Array<{ chunkIndex: number; text: string; speaker: string | null }>;
}

interface Props {
  committees: string[];
}

export default function ProtocolsClient({ committees }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [selectedCommittee, setSelectedCommittee] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [expandedSessions, setExpandedSessions] = useState<Map<number, FullProtocol>>(new Map());
  const [loadingSessions, setLoadingSessions] = useState<Set<number>>(new Set());

  const search = useCallback(async (q: string, committee: string | null, p: number) => {
    if (!q.trim()) { setResults([]); setTotal(0); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ q, page: String(p) });
      if (committee) params.set('committee', committee);
      const res = await fetch(`${BASE_PATH}/api/protocols/search?${params}`);
      const data = await res.json();
      setResults(data.results ?? []);
      setTotal(data.total ?? 0);
      setPage(p);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = (q: string) => {
    setQuery(q);
    if (q.trim().length >= 2) search(q, selectedCommittee, 1);
    else { setResults([]); setTotal(0); }
  };

  const handleCommittee = (c: string | null) => {
    setSelectedCommittee(c);
    if (query.trim().length >= 2) search(query, c, 1);
  };

  const expandSession = async (sessionId: number) => {
    if (expandedSessions.has(sessionId)) {
      setExpandedSessions(prev => { const next = new Map(prev); next.delete(sessionId); return next; });
      return;
    }
    setLoadingSessions(prev => new Set(prev).add(sessionId));
    try {
      const res = await fetch(`${BASE_PATH}/api/protocols/session/${sessionId}`);
      const data: FullProtocol = await res.json();
      setExpandedSessions(prev => new Map(prev).set(sessionId, data));
    } finally {
      setLoadingSessions(prev => { const next = new Set(prev); next.delete(sessionId); return next; });
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' });

  const highlightSnippet = (snippet: string) =>
    snippet.split(/(<mark>.*?<\/mark>)/g).map((part, i) =>
      part.startsWith('<mark>') ? (
        <mark key={i} className="bg-yellow-200 rounded px-0.5">{part.replace(/<\/?mark>/g, '')}</mark>
      ) : part
    );

  // Group results by sessionId for display
  const sessionGroups = results.reduce<Map<number, SearchResult[]>>((acc, r) => {
    const arr = acc.get(r.sessionId) ?? [];
    arr.push(r);
    acc.set(r.sessionId, arr);
    return acc;
  }, new Map());

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <button onClick={() => router.back()} className="text-sm font-black text-gray-400 hover:text-black transition-colors mb-6">
          חזרה →
        </button>

        <h1 className="text-3xl font-black mb-6">פרוטוקולים</h1>

        {/* Search input */}
        <input
          type="text"
          value={query}
          onChange={e => handleSearch(e.target.value)}
          placeholder="חיפוש בפרוטוקולי ועדות..."
          className="w-full text-sm px-4 py-3 rounded-2xl border border-black/10 bg-gray-50 focus:outline-none focus:border-black/30 mb-4"
          dir="rtl"
        />

        {/* Committee filter chips */}
        {committees.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-6">
            <button
              onClick={() => handleCommittee(null)}
              className={`text-xs font-black px-3 py-1.5 rounded-full transition-colors ${
                selectedCommittee === null ? 'bg-black text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              כל הוועדות
            </button>
            {committees.map(c => (
              <button
                key={c}
                onClick={() => handleCommittee(c)}
                className={`text-xs font-black px-3 py-1.5 rounded-full transition-colors ${
                  selectedCommittee === c ? 'bg-black text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {/* Results count */}
        {total > 0 && (
          <p className="text-xs text-gray-400 font-medium mb-4">
            {total.toLocaleString('he-IL')} תוצאות
          </p>
        )}

        {loading && <p className="text-sm text-gray-400">טוען...</p>}

        {/* Results grouped by session */}
        <div className="flex flex-col gap-3">
          {Array.from(sessionGroups.entries()).map(([sessionId, sessionResults]) => {
            const first = sessionResults[0];
            const isExpanded = expandedSessions.has(sessionId);
            const isLoadingSession = loadingSessions.has(sessionId);
            const protocol = expandedSessions.get(sessionId);

            return (
              <div key={sessionId} className="rounded-2xl border border-black/8 overflow-hidden">
                {/* Session header */}
                <div
                  className="flex items-start justify-between gap-3 px-5 py-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => expandSession(sessionId)}
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-black text-gray-400">{formatDate(first.date)}</span>
                      <span className="text-xs font-black px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        {first.committeeName}
                      </span>
                    </div>
                    {first.title && <p className="text-sm font-bold text-gray-800">{first.title}</p>}
                    {/* Matching excerpts */}
                    <div className="mt-2 flex flex-col gap-1.5">
                      {sessionResults.map(r => (
                        <div key={r.chunkId} className="text-xs text-gray-600 leading-relaxed">
                          {r.speaker && <span className="font-bold text-gray-700">{r.speaker}: </span>}
                          {highlightSnippet(r.snippet)}
                        </div>
                      ))}
                    </div>
                  </div>
                  <span className="text-gray-400 text-sm shrink-0 mt-0.5">
                    {isLoadingSession ? '...' : isExpanded ? '▲' : '▼'}
                  </span>
                </div>

                {/* Full protocol inline */}
                {isExpanded && protocol && (
                  <div className="border-t border-black/5 px-5 py-4 bg-gray-50 max-h-[60vh] overflow-y-auto">
                    <div className="text-xs text-gray-500 leading-relaxed whitespace-pre-wrap font-mono" dir="rtl">
                      {protocol.chunks.map((chunk, i) => (
                        <div key={i} className="mb-4">
                          {chunk.speaker && (
                            <span className="font-black text-gray-700 not-italic">{chunk.speaker}: </span>
                          )}
                          {chunk.text}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        {total > 20 && (
          <div className="flex items-center gap-3 mt-6 justify-center">
            <button
              onClick={() => search(query, selectedCommittee, page - 1)}
              disabled={page === 1}
              className="text-xs font-black px-4 py-2 rounded-full bg-gray-100 disabled:opacity-30 hover:bg-gray-200 transition-colors"
            >
              הקודם
            </button>
            <span className="text-xs text-gray-500">עמוד {page} מתוך {Math.ceil(total / 20)}</span>
            <button
              onClick={() => search(query, selectedCommittee, page + 1)}
              disabled={page >= Math.ceil(total / 20)}
              className="text-xs font-black px-4 py-2 rounded-full bg-gray-100 disabled:opacity-30 hover:bg-gray-200 transition-colors"
            >
              הבא
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/knesset-watch
npx tsc --noEmit
```

- [ ] **Step 4: Test the page locally**

Open `http://localhost:3001/knesset-watch/protocols`. Search for any Hebrew term.

Expected:
- Results appear with highlighted excerpts
- Clicking a result expands the full protocol inline
- Committee filter chips work

- [ ] **Step 5: Commit**

```bash
git add apps/knesset-watch/src/app/protocols/
git commit -m "feat(knesset-watch): /protocols global search page"
```

---

## Task 10: Committee page — protocols tab

**Files:**
- Modify: `apps/knesset-watch/src/lib/knesset-db.ts` (re-export helper)
- Modify: `apps/knesset-watch/src/app/committee/[name]/page.tsx`
- Modify: `apps/knesset-watch/src/app/committee/[name]/CommitteeClient.tsx`

- [ ] **Step 1: Update committee page.tsx to pass protocol sessions**

In `apps/knesset-watch/src/app/committee/[name]/page.tsx`, change:

```typescript
import { checkServerAuth } from '@minimal-db/ui/auth-utils';
import { redirect, notFound } from 'next/navigation';
import { getCommitteeDetail } from '@/lib/knesset-db';
import { getCommitteeProtocolSessions, type CommitteeProtocolSession } from '@/lib/protocols-db';
import CommitteeClient from './CommitteeClient';

interface Props {
  params: Promise<{ name: string }>;
}

export default async function CommitteePage({ params }: Props) {
  const isAuthenticated = await checkServerAuth('SITE_PASSWORD', 'knesset-watch_auth_token');
  if (!isAuthenticated) redirect('/login');

  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);

  const data = getCommitteeDetail(name);
  if (!data) notFound();

  const protocolSessions = getCommitteeProtocolSessions(name);

  return <CommitteeClient data={data} protocolSessions={protocolSessions} />;
}
```

- [ ] **Step 2: Update CommitteeClient.tsx to add the protocols tab**

At the top of `CommitteeClient.tsx`, update the import and props:

```typescript
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { CommitteeDetail } from '@/lib/knesset-db';
import type { CommitteeProtocolSession } from '@/lib/protocols-db';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface FullProtocol {
  session: {
    sessionId: number;
    committeeName: string | null;
    date: string;
    title: string | null;
    chunkCount: number;
  };
  chunks: Array<{ chunkIndex: number; text: string; speaker: string | null }>;
}

export default function CommitteeClient({
  data,
  protocolSessions,
}: {
  data: CommitteeDetail;
  protocolSessions: CommitteeProtocolSession[];
}) {
  const router = useRouter();
  const ratio = data.billCount > 0 ? Math.round((data.passedCount / data.billCount) * 100) : 0;
  const [search, setSearch] = useState('');
  const [showPassedOnly, setShowPassedOnly] = useState(false);
  const [expandedBills, setExpandedBills] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<'bills' | 'protocols'>('bills');
  const [protocolSearch, setProtocolSearch] = useState('');
  const [expandedProtocols, setExpandedProtocols] = useState<Map<number, FullProtocol>>(new Map());
  const [loadingProtocols, setLoadingProtocols] = useState<Set<number>>(new Set());
```

Then, after the bills filter/search block and before the bills list, wrap everything in tabs. Find the existing JSX and restructure:

Replace the section from `{/* Bills */}` to the end of the bills list with:

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
          {protocolSessions.length > 0 && (
            <button
              onClick={() => setActiveTab('protocols')}
              className={`text-xs font-black px-4 py-2.5 transition-colors border-b-2 -mb-px ${
                activeTab === 'protocols' ? 'border-black text-black' : 'border-transparent text-gray-400 hover:text-black'
              }`}
            >
              פרוטוקולים ({protocolSessions.length})
            </button>
          )}
        </div>

        {activeTab === 'bills' && (
          <div>
            {/* Search + filter — existing code unchanged */}
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
              {/* existing bills map — keep exactly as-is */}
              {filtered.map(b => {
                const isExpanded = expandedBills.has(b.billId);
                return (
                  <div key={b.billId} className="rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors">
                    <div className="flex items-start gap-3 px-4 py-3">
                      <span className={`shrink-0 mt-0.5 text-[10px] font-black px-2 py-0.5 rounded-full ${b.isPassed ? 'bg-[#16A34A] text-white' : 'bg-gray-200 text-gray-500'}`}>
                        {b.isPassed ? 'עבר' : 'הוגש'}
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

        {activeTab === 'protocols' && (
          <div>
            <input
              type="text"
              value={protocolSearch}
              onChange={e => setProtocolSearch(e.target.value)}
              placeholder="חיפוש בפרוטוקולים..."
              className="w-full text-sm px-4 py-2 rounded-full border border-black/10 bg-gray-50 focus:outline-none focus:border-black/30 mb-4"
              dir="rtl"
            />
            <div className="flex flex-col gap-1.5">
              {protocolSessions
                .filter(s => !protocolSearch || s.title?.includes(protocolSearch))
                .map(s => {
                  const isExpanded = expandedProtocols.has(s.sessionId);
                  const isLoading = loadingProtocols.has(s.sessionId);
                  const protocol = expandedProtocols.get(s.sessionId);
                  const date = new Date(s.date).toLocaleDateString('he-IL', {
                    year: 'numeric', month: 'long', day: 'numeric',
                  });

                  const expand = async () => {
                    if (isExpanded) {
                      setExpandedProtocols(prev => { const next = new Map(prev); next.delete(s.sessionId); return next; });
                      return;
                    }
                    setLoadingProtocols(prev => new Set(prev).add(s.sessionId));
                    try {
                      const res = await fetch(`${BASE_PATH}/api/protocols/session/${s.sessionId}`);
                      const data: FullProtocol = await res.json();
                      setExpandedProtocols(prev => new Map(prev).set(s.sessionId, data));
                    } finally {
                      setLoadingProtocols(prev => { const n = new Set(prev); n.delete(s.sessionId); return n; });
                    }
                  };

                  return (
                    <div key={s.sessionId} className="rounded-xl bg-gray-50 overflow-hidden">
                      <div
                        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-100 transition-colors"
                        onClick={expand}
                      >
                        <div>
                          <span className="text-xs font-bold text-gray-700">{date}</span>
                          {s.title && <p className="text-sm font-bold mt-0.5">{s.title}</p>}
                        </div>
                        <span className="text-gray-400 text-sm">
                          {isLoading ? '...' : isExpanded ? '▲' : '▼'}
                        </span>
                      </div>
                      {isExpanded && protocol && (
                        <div className="border-t border-black/5 px-4 py-3 max-h-[60vh] overflow-y-auto bg-white">
                          <div className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap font-mono" dir="rtl">
                            {protocol.chunks.map((chunk, i) => (
                              <div key={i} className="mb-3">
                                {chunk.speaker && (
                                  <span className="font-black text-gray-800">{chunk.speaker}: </span>
                                )}
                                {chunk.text}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}
```

**Important:** This step requires careful editing — keep all existing bill rendering code intact. Only add the tab switcher above it and wrap each section in `{activeTab === '...' && ...}`.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/knesset-watch
npx tsc --noEmit
```

Fix any type errors (most likely: missing `CommitteeProtocolSession` import).

- [ ] **Step 4: Test the committee page locally**

Open a committee page like `http://localhost:3001/knesset-watch/committee/[encoded-name]`.

Expected:
- "הצ\"ח (N)" and "פרוטוקולים (M)" tabs appear
- Switching to protocols tab shows session list
- Clicking a session expands full text inline

- [ ] **Step 5: Commit**

```bash
git add apps/knesset-watch/src/app/committee/
git commit -m "feat(knesset-watch): committee page protocols tab"
```

---

## Task 11: Incremental sync script

**Files:**
- Create: `apps/knesset-watch/scripts/sync-protocols.ts`

- [ ] **Step 1: Write the sync script**

Replace `PROTOCOL_GROUP_TYPE_ID` with the confirmed value from Task 2.

```typescript
// scripts/sync-protocols.ts
// Run: npm run db:sync-protocols
// Incremental: fetches protocol documents for sessions added since the last sync.

import Database from 'better-sqlite3';
import mammoth from 'mammoth';
import path from 'path';

const API = 'https://knesset.gov.il/OdataV4/ParliamentInfo';
const KNESSET_DB = path.join(process.cwd(), 'knesset.db');
const PROTOCOLS_DB = path.join(process.cwd(), 'protocols.db');
const PROTOCOL_GROUP_TYPE_ID = 23; // confirmed in Task 2

// Re-use chunking logic from scrape-protocols.ts
const CHUNK_SIZE = 3000;
const CHUNK_OVERLAP = 300;
const SPEAKER_RE = /^(היו"ר|ח"כ|מר|גב'|ד"ר|פרופ'|שר|סגן שר)\s+([^\n:：]{2,40})[:：]/mu;
const SPEAKER_LINE_RE = /^([^\n:：]{2,40})[:：]\s*$/mu;

function extractSpeaker(line: string): string | null {
  const m = line.match(SPEAKER_RE);
  if (m) return `${m[1]} ${m[2]}`.trim();
  const m2 = line.match(SPEAKER_LINE_RE);
  if (m2) return m2[1].trim();
  return null;
}

function chunkText(text: string): Array<{ text: string; speaker: string | null }> {
  const lines = text.split('\n');
  const turns: Array<{ speaker: string | null; text: string }> = [];
  let currentSpeaker: string | null = null;
  let currentLines: string[] = [];
  for (const line of lines) {
    const speaker = extractSpeaker(line);
    if (speaker && currentLines.join('\n').length > 50) {
      const t = currentLines.join('\n').trim();
      if (t.length > 20) turns.push({ speaker: currentSpeaker, text: t });
      currentSpeaker = speaker;
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.length) {
    const t = currentLines.join('\n').trim();
    if (t.length > 20) turns.push({ speaker: currentSpeaker, text: t });
  }
  const chunks: Array<{ text: string; speaker: string | null }> = [];
  for (const turn of turns) {
    if (turn.text.length <= CHUNK_SIZE) {
      chunks.push(turn);
    } else {
      let i = 0;
      while (i < turn.text.length) {
        chunks.push({ text: turn.text.slice(i, i + CHUNK_SIZE), speaker: turn.speaker });
        i += CHUNK_SIZE - CHUNK_OVERLAP;
      }
    }
  }
  return chunks;
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function sync() {
  const knessetDb = new Database(KNESSET_DB, { readonly: true });
  const db = new Database(PROTOCOLS_DB);

  const done = new Set(
    (db.prepare('SELECT session_id FROM session_protocol').all() as any[]).map(r => r.session_id)
  );

  const newSessions = (knessetDb.prepare(`
    SELECT cs.id, cs.committee_id, cs.date, cs.title,
           b.committee_name
    FROM committee_session cs
    LEFT JOIN (
      SELECT DISTINCT committee_id, committee_name FROM bill
      WHERE committee_id != -1 AND committee_name IS NOT NULL
    ) b ON b.committee_id = cs.committee_id
    ORDER BY cs.id ASC
  `).all() as any[]).filter((s: any) => !done.has(s.id));

  if (newSessions.length === 0) {
    console.log('No new sessions to sync.');
    knessetDb.close(); db.close(); return;
  }

  console.log(`Syncing ${newSessions.length} new sessions...`);

  const insertSession = db.prepare(`INSERT OR REPLACE INTO session_protocol (session_id, committee_id, committee_name, date, title, doc_url, chunk_count) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertChunk = db.prepare(`INSERT INTO protocol_chunk (session_id, chunk_index, text, speaker) VALUES (?, ?, ?, ?)`);
  const insertFts = db.prepare(`INSERT INTO protocol_chunk_fts (text, chunk_id, session_id, committee_name, date, speaker) VALUES (?, ?, ?, ?, ?, ?)`);

  let withProtocol = 0;
  for (const s of newSessions) {
    try {
      const json = await fetchJson(
        `${API}/KNS_DocumentCommitteeSession?$filter=CommitteeSessionID eq ${s.id} and GroupTypeID eq ${PROTOCOL_GROUP_TYPE_ID}&$select=ApplicationID,FilePath`
      );
      const docs = json.value ?? [];
      const doc = docs.find((d: any) => d.ApplicationID === 2 && d.FilePath) ??
                  docs.find((d: any) => d.ApplicationID === 1 && d.FilePath);
      if (!doc) continue;
      const bufRes = await fetch(doc.FilePath, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!bufRes.ok) continue;
      const buf = Buffer.from(await bufRes.arrayBuffer());
      const { value: text } = await mammoth.extractRawText({ buffer: buf });
      if (text.trim().length < 100) continue;
      const chunks = chunkText(text.trim());
      if (!chunks.length) continue;
      db.transaction(() => {
        insertSession.run(s.id, s.committee_id, s.committee_name, s.date, s.title, doc.FilePath, chunks.length);
        for (let i = 0; i < chunks.length; i++) {
          const r = insertChunk.run(s.id, i, chunks[i].text, chunks[i].speaker ?? null);
          insertFts.run(chunks[i].text, r.lastInsertRowid, s.id, s.committee_name ?? '', s.date, chunks[i].speaker ?? '');
        }
      })();
      withProtocol++;
    } catch { /* skip failed sessions */ }
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`Done. ${withProtocol}/${newSessions.length} sessions had protocols.`);
  knessetDb.close(); db.close();
}

sync().catch(err => { console.error(err.message); process.exit(1); });
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/knesset-watch
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/knesset-watch/scripts/sync-protocols.ts
git commit -m "feat(knesset-watch): incremental protocol sync script"
```

---

## Task 12: Final verification + deploy

- [ ] **Step 1: Full TypeScript check**

```bash
cd apps/knesset-watch
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 2: Smoke test all new routes**

With `npm run dev` running at port 3001:

```
http://localhost:3001/knesset-watch/protocols                          → search page loads
http://localhost:3001/knesset-watch/protocols (search "ביטוח")        → results with highlights
http://localhost:3001/knesset-watch/committee/[name] (protocols tab)   → sessions list, expand works
http://localhost:3001/knesset-watch/api/protocols/search?q=ביטוח       → JSON response
```

- [ ] **Step 3: Verify protocols.db is tracked by LFS**

```bash
git lfs ls-files
```

Expected: `apps/knesset-watch/protocols.db` appears.

- [ ] **Step 4: Push to deploy**

```bash
git push origin main
```

Vercel will automatically build and deploy. LFS objects are fetched during the build.

- [ ] **Step 5: Verify live**

After deploy, check:
- `/knesset-watch/protocols` loads and search works
- A committee page with protocols shows the new tab

---

## Notes for the implementer

- **GroupTypeID**: Task 2 must be completed before Task 4. The value `23` in the scrape script is a placeholder — replace it with the confirmed value.
- **mammoth limitation**: Only `.docx` is supported. Old `.doc` files (binary Word format) are skipped. Some sessions may have PDF-only protocols — also skipped for now.
- **Knesset API intermittent 500s**: The API goes down occasionally. The scrape script's 5-concurrent-request design and per-session error handling mean individual failures are skipped gracefully. Re-run to fill gaps.
- **protocols.db size**: Expected 200–400MB. Git LFS handles this transparently for Vercel deployments.
