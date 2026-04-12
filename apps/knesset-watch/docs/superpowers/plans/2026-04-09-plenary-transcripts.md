# Plenary Transcript Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest plenary (מליאה) session transcripts — the floor speeches where MKs make their most quotable statements — into Turso alongside committee protocols, making them searchable via the ask engine.

**Architecture:** Plenary sessions are listed in `KNS_PlenumSitting` via the Knesset OData API. Protocol documents are fetched from `KNS_DocumentPlenumSitting` (GroupTypeID TBD — must be confirmed in Task 1). DOC/DOCX files are downloaded and parsed with mammoth (same as committee protocols). Speaker turns are stored in a new `plenary_speaker_turn` Turso table. Sessions get embeddings and a `rag_card`. The ask route's vector search covers both committee and plenary sessions.

**Tech Stack:** Knesset OData API, mammoth (DOCX→text), Turso/libSQL, Jina AI (768-dim embeddings), better-sqlite3 (local index), TypeScript tsx scripts.

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `scripts/sync-plenary.ts` | Sync plenary session metadata from OData → local SQLite |
| Create | `scripts/scrape-plenary.ts` | Download + parse DOCX, extract speaker turns, write to Turso |
| Create | `scripts/embed-plenary.ts` | Generate session embeddings + rag_cards for plenary sessions |
| Modify | `src/lib/protocols-db.ts` | Add `searchPlenaryVec()`, `searchMkPlenarySpeakerTurns()` |
| Modify | `src/app/api/ask/route.ts` | Merge plenary results into search pipeline |
| Modify | `knesset.db` | Add `plenary_session` table for local metadata index |

---

## Task 1: Investigate plenary document API (REQUIRED FIRST)

Before writing any code, confirm the API endpoints for plenary sessions and their protocol documents. Committee sessions use `KNS_CommitteeSession` with `KNS_DocumentCommitteeSession` (GroupTypeID=23). Plenary may differ.

- [ ] **Step 1: Probe plenary session OData**

```bash
cd apps/knesset-watch && npx tsx -e "
const BASE = 'https://knesset.gov.il/OdataV4/ParliamentInfo';
// Fetch 3 recent plenary sessions
const res = await fetch(\`\${BASE}/KNS_PlenumSession?\\\$filter=KnessetNum eq 25&\\\$top=3&\\\$orderby=StartDate desc\`);
const data = await res.json();
console.log(JSON.stringify(data.value?.[0], null, 2));
" 2>&1 | head -40
```

If `KNS_PlenumSession` doesn't exist, try:
- `KNS_PlenumSitting`
- `KNS_PlenarySession`

Note the correct entity name and its key field.

- [ ] **Step 2: Find document endpoint for a plenary session**

Using a session ID from Step 1:

```bash
npx tsx -e "
const sessionId = 12345; // replace with actual id from Step 1
const BASE = 'https://knesset.gov.il/OdataV4/ParliamentInfo';
const res = await fetch(\`\${BASE}/KNS_DocumentPlenumSession?\\\$filter=PlenumSessionID eq \${sessionId}&\\\$top=5\`);
const data = await res.json();
console.log(JSON.stringify(data.value, null, 2));
" 2>&1
```

Identify which GroupTypeID corresponds to the protocol document (look for FilePath ending in .doc/.docx).

- [ ] **Step 3: Confirm speaker name regex**

Download one plenary DOCX and check if the same speaker regex patterns work:

```bash
npx tsx -e "
import mammoth from 'mammoth';
const res = await fetch('https://knesset.gov.il/...'); // use actual FilePath from Step 2
const buf = Buffer.from(await res.arrayBuffer());
const { value } = await mammoth.extractRawText({ buffer: buf });
console.log(value.slice(0, 2000));
"
```

Plenary transcripts may have different speaker line formats than committee ones. Document differences.

- [ ] **Step 4: Document findings and update constants below**

Record:
- OData entity name: `___`
- Session ID field: `___`
- Document entity name: `___`
- Protocol GroupTypeID: `___`
- Any speaker regex changes needed: `___`

```bash
git commit --allow-empty -m "chore: document plenary API findings (see plan Task 1)"
```

---

## Task 2: Create plenary_session table in local SQLite

**Files:**
- Modify: `knesset.db` (migration), `scripts/sync-plenary.ts`

- [ ] **Step 1: Add table to knesset.db**

```bash
cd apps/knesset-watch && npx tsx -e "
import Database from 'better-sqlite3';
const db = new Database('knesset.db');
db.exec(\`
  CREATE TABLE IF NOT EXISTS plenary_session (
    id INTEGER PRIMARY KEY,
    date TEXT,
    title TEXT,
    session_number INTEGER,
    knesset_num INTEGER,
    protocol_url TEXT,
    has_protocol INTEGER DEFAULT 0,
    last_synced TEXT
  )
\`);
db.exec('CREATE INDEX IF NOT EXISTS idx_plenary_date ON plenary_session(date)');
console.log('plenary_session table created');
"
```

- [ ] **Step 2: Write sync-plenary.ts**

```typescript
// scripts/sync-plenary.ts
// Syncs plenary session metadata from Knesset OData → local knesset.db.
// Run: cd apps/knesset-watch && npx tsx scripts/sync-plenary.ts

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const db = new Database(DB_PATH);
const API_BASE = process.env.KNESSET_API_BASE ?? 'https://knesset.gov.il/OdataV4/ParliamentInfo';

// ── Update these after Task 1 investigation ──────────────────────────────────
const PLENARY_ENTITY = 'KNS_PlenumSession'; // confirm in Task 1
const SESSION_ID_FIELD = 'Id';               // confirm in Task 1
const DOC_ENTITY = 'KNS_DocumentPlenumSession'; // confirm in Task 1
const PROTOCOL_GROUP_TYPE_ID = 23;          // confirm in Task 1
// ─────────────────────────────────────────────────────────────────────────────

const upsert = db.prepare(`
  INSERT INTO plenary_session (id, date, title, session_number, knesset_num, protocol_url, has_protocol, last_synced)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    date = excluded.date,
    title = excluded.title,
    protocol_url = excluded.protocol_url,
    has_protocol = excluded.has_protocol,
    last_synced = excluded.last_synced
`);

async function fetchPage(url: string) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json() as Promise<{ value: unknown[]; '@odata.nextLink'?: string }>;
}

async function main() {
  let url = `${API_BASE}/${PLENARY_ENTITY}?$filter=KnessetNum eq 25&$orderby=${SESSION_ID_FIELD} asc&$top=200`;
  let total = 0;

  while (url) {
    const page = await fetchPage(url);
    for (const session of page.value as Record<string, unknown>[]) {
      const id = Number(session[SESSION_ID_FIELD]);
      // Fetch protocol document URL for this session
      const docRes = await fetch(
        `${API_BASE}/${DOC_ENTITY}?$filter=${SESSION_ID_FIELD.replace('Id', '')}SessionID eq ${id} and GroupTypeID eq ${PROTOCOL_GROUP_TYPE_ID}&$select=FilePath&$top=1`,
        { headers: { Accept: 'application/json' } }
      );
      const docData = await docRes.json() as { value: Array<{ FilePath: string }> };
      const protocolUrl = docData.value[0]?.FilePath ?? null;

      upsert.run(
        id,
        String(session['StartDate'] ?? session['SessionDate'] ?? ''),
        String(session['Title'] ?? session['Name'] ?? ''),
        Number(session['SessionNum'] ?? 0),
        25,
        protocolUrl,
        protocolUrl ? 1 : 0,
        new Date().toISOString(),
      );
      total++;
    }
    console.log(`Synced ${total} sessions so far...`);
    url = page['@odata.nextLink'] as string ?? '';
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`Done. Total plenary sessions synced: ${total}`);
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Run and verify**

```bash
npx tsx scripts/sync-plenary.ts
npx tsx -e "
import Database from 'better-sqlite3';
const db = new Database('knesset.db', { readonly: true });
console.log(db.prepare('SELECT COUNT(*) as n, MIN(date) as min_d, MAX(date) as max_d FROM plenary_session').get());
console.log(db.prepare('SELECT COUNT(*) as with_protocol FROM plenary_session WHERE has_protocol = 1').get());
"
```

Expected: hundreds of sessions, many with protocol URLs.

- [ ] **Step 4: Commit**

```bash
git add scripts/sync-plenary.ts
git commit -m "feat: sync plenary session metadata from Knesset OData"
```

---

## Task 3: Create plenary tables in Turso + scrape script

**Files:**
- Create: `scripts/scrape-plenary.ts`
- Modify: `scripts/migrate-to-turso.ts` (document the schema)

- [ ] **Step 1: Create Turso tables**

```bash
cd apps/knesset-watch && npx tsx -e "
import { createClient } from '@libsql/client';
const db = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });

await db.execute(\`
  CREATE TABLE IF NOT EXISTS plenary_session (
    id              INTEGER PRIMARY KEY,
    date            TEXT,
    title           TEXT,
    session_number  INTEGER,
    knesset_num     INTEGER,
    rag_card        TEXT,
    embedding       F32_BLOB(768)
  )
\`);

await db.execute(\`
  CREATE TABLE IF NOT EXISTS plenary_speaker_turn (
    id           INTEGER PRIMARY KEY,
    session_id   INTEGER NOT NULL,
    turn_number  INTEGER,
    speaker_role TEXT,
    mk_id        INTEGER,
    raw_name     TEXT,
    faction_name TEXT,
    text         TEXT,
    embedding    F32_BLOB(768)
  )
\`);

await db.execute('CREATE INDEX IF NOT EXISTS idx_plenary_turn_session ON plenary_speaker_turn(session_id)');
await db.execute('CREATE INDEX IF NOT EXISTS idx_plenary_turn_mk ON plenary_speaker_turn(mk_id)');
console.log('Turso plenary tables created');
"
```

- [ ] **Step 2: Create scrape-plenary.ts**

This follows the same pattern as `scrape-protocols.ts` but for plenary sessions.

```typescript
// scripts/scrape-plenary.ts
// Downloads plenary DOCXs, parses speaker turns, writes to Turso.
// Run: cd apps/knesset-watch && npx tsx scripts/scrape-plenary.ts
// Safe to re-run — skips sessions already in Turso.

import Database from 'better-sqlite3';
import mammoth from 'mammoth';
import { createClient } from '@libsql/client';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const localDb = new Database(DB_PATH, { readonly: true });
const turso = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN ?? '',
});

// Same regex as committee protocol parser
const SPEAKER_RE = /^(היו"ר|ח"כ|מר|גב'|ד"ר|פרופ'|שר|סגן שר|ראש הממשלה)\s+([^\n:：]{2,40})[:：]/mu;
const SPEAKER_LINE_RE = /^([^\n:：]{2,40})[:：]\s*$/mu;
const MIN_TURN_CHARS = 200;

function extractSpeakerTurns(text: string): Array<{ rawName: string; role: string; text: string }> {
  const lines = text.split('\n');
  const turns: Array<{ rawName: string; role: string; text: string }> = [];
  let current: { rawName: string; role: string; lines: string[] } | null = null;

  for (const line of lines) {
    const m1 = SPEAKER_RE.exec(line);
    const m2 = !m1 && SPEAKER_LINE_RE.exec(line);
    const speaker = m1 ? { role: m1[1], name: m1[2].trim() } : m2 ? { role: '', name: m2[1].trim() } : null;

    if (speaker) {
      if (current && current.lines.join(' ').length >= MIN_TURN_CHARS) {
        turns.push({ rawName: current.rawName, role: current.role, text: current.lines.join('\n').trim() });
      }
      current = { rawName: speaker.name, role: speaker.role, lines: [line.slice(line.indexOf(':') + 1)] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current && current.lines.join(' ').length >= MIN_TURN_CHARS) {
    turns.push({ rawName: current.rawName, role: current.role, text: current.lines.join('\n').trim() });
  }
  return turns;
}

async function getMkIdByName(rawName: string): Promise<number | null> {
  const db = new Database(DB_PATH, { readonly: true });
  const mks = db.prepare('SELECT person_id, first_name, last_name FROM mk_person').all() as Array<{ person_id: number; first_name: string; last_name: string }>;
  for (const mk of mks) {
    if (rawName.includes(mk.last_name)) return mk.person_id;
  }
  return null;
}

async function main() {
  // Get sessions with protocol URLs not yet in Turso
  const sessions = localDb.prepare(`
    SELECT id, date, title, session_number, protocol_url
    FROM plenary_session
    WHERE has_protocol = 1
    ORDER BY date DESC
  `).all() as Array<{ id: number; date: string; title: string; session_number: number; protocol_url: string }>;

  // Check which are already in Turso
  const existing = await turso.execute('SELECT id FROM plenary_session');
  const existingIds = new Set(existing.rows.map(r => Number(r.id)));

  const pending = sessions.filter(s => !existingIds.has(s.id));
  console.log(`Sessions to scrape: ${pending.length} (${existingIds.size} already done)`);

  let done = 0;
  let errors = 0;

  for (const session of pending) {
    try {
      // Download DOCX
      const res = await fetch(session.protocol_url, {
        headers: { 'User-Agent': 'KnessetWatch/1.0' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());

      // Parse text
      const { value: text } = await mammoth.extractRawText({ buffer: buf });
      const turns = extractSpeakerTurns(text);

      // Build rag_card
      const ragCard = `מליאה | ${session.date.slice(0, 10)} | ישיבה ${session.session_number}\n${turns.slice(0, 5).map(t => `${t.rawName}: ${t.text.slice(0, 100)}`).join('\n')}`;

      // Insert session into Turso
      await turso.execute({
        sql: 'INSERT OR REPLACE INTO plenary_session (id, date, title, session_number, knesset_num, rag_card) VALUES (?, ?, ?, ?, ?, ?)',
        args: [session.id, session.date, session.title, session.session_number, 25, ragCard],
      });

      // Insert speaker turns
      for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        const mkId = await getMkIdByName(turn.rawName);
        await turso.execute({
          sql: 'INSERT INTO plenary_speaker_turn (session_id, turn_number, speaker_role, mk_id, raw_name, text) VALUES (?, ?, ?, ?, ?, ?)',
          args: [session.id, i, turn.role, mkId, turn.rawName, turn.text],
        });
      }

      done++;
      if (done % 10 === 0) console.log(`[${done}/${pending.length}] ${session.date.slice(0, 10)} — ${turns.length} turns`);
    } catch (e) {
      console.error(`  Error session ${session.id}: ${e}`);
      errors++;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`Done. Scraped: ${done}, Errors: ${errors}`);
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Test with 5 sessions**

Add `const pending = sessions.filter(...).slice(0, 5)` temporarily:

```bash
npx tsx scripts/scrape-plenary.ts
```

Check Turso:
```bash
npx tsx -e "
import { createClient } from '@libsql/client';
const db = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });
const r = await db.execute('SELECT COUNT(*) as sessions FROM plenary_session');
const t = await db.execute('SELECT COUNT(*) as turns FROM plenary_speaker_turn');
console.log({ sessions: r.rows[0], turns: t.rows[0] });
"
```

- [ ] **Step 4: Commit and run full scrape**

```bash
git add scripts/scrape-plenary.ts scripts/sync-plenary.ts
git commit -m "feat: scrape + parse plenary session transcripts into Turso"
nohup npx tsx scripts/scrape-plenary.ts > scrape-plenary.log 2>&1 &
```

---

## Task 4: Embed plenary sessions

**Files:**
- Create: `scripts/embed-plenary.ts`

Same pattern as `embed-sessions.ts` but for `plenary_session`.

- [ ] **Step 1: Create embed-plenary.ts**

```typescript
// scripts/embed-plenary.ts
// Generates Jina embeddings for plenary sessions (using rag_card as input).
// Run after scrape-plenary.ts completes.

import { createClient } from '@libsql/client';

const JINA_API_KEY = process.env.JINA_API_KEY!;
const turso = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN ?? '' });
const BATCH = 20;

async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  const res = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${JINA_API_KEY}` },
    body: JSON.stringify({ model: 'jina-embeddings-v3', task: 'retrieval.passage', dimensions: 768, input: texts }),
  });
  if (!res.ok) return texts.map(() => null);
  const data = await res.json() as { data: Array<{ embedding: number[] }> };
  return data.data.map(d => d.embedding);
}

async function main() {
  const rows = await turso.execute('SELECT id, rag_card FROM plenary_session WHERE embedding IS NULL AND rag_card IS NOT NULL');
  console.log(`To embed: ${rows.rows.length}`);

  for (let i = 0; i < rows.rows.length; i += BATCH) {
    const batch = rows.rows.slice(i, i + BATCH);
    const embeddings = await embedBatch(batch.map(r => String(r.rag_card)));
    for (let j = 0; j < batch.length; j++) {
      if (!embeddings[j]) continue;
      const vec = `[${embeddings[j]!.join(',')}]`;
      await turso.execute({ sql: 'UPDATE plenary_session SET embedding = vector32(?) WHERE id = ?', args: [vec, batch[j].id] });
    }
    console.log(`Embedded ${Math.min(i + BATCH, rows.rows.length)} / ${rows.rows.length}`);
    await new Promise(r => setTimeout(r, 500));
  }
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run**

```bash
npx tsx scripts/embed-plenary.ts
git add scripts/embed-plenary.ts
git commit -m "feat: embed plenary sessions in Turso"
```

---

## Task 5: Add plenary search to protocols-db.ts and ask route

**Files:**
- Modify: `src/lib/protocols-db.ts` — add `searchPlenaryVec()`, `searchMkPlenary()`
- Modify: `src/app/api/ask/route.ts` — merge plenary results

- [ ] **Step 1: Add search functions to protocols-db.ts**

```typescript
export interface PlenarySearchResult {
  sessionId: number;
  date: string;
  title: string;
  sessionNumber: number;
  ragCard: string;
}

export async function searchPlenaryVec(
  embedding: number[],
  limit = 10,
): Promise<PlenarySearchResult[]> {
  const client = getTursoClient();
  const vec = `[${embedding.join(',')}]`;
  try {
    const result = await client.execute({
      sql: `SELECT id as session_id, date, title, session_number,
                   rag_card, vector_distance_cos(embedding, vector32(?)) as score
            FROM plenary_session
            WHERE embedding IS NOT NULL
            ORDER BY score ASC LIMIT ?`,
      args: [vec, limit],
    });
    return result.rows.map(r => ({
      sessionId: Number(r.session_id),
      date: String(r.date ?? ''),
      title: String(r.title ?? ''),
      sessionNumber: Number(r.session_number ?? 0),
      ragCard: String(r.rag_card ?? ''),
    }));
  } catch { return []; }
}

export async function searchMkPlenarySpeakerTurns(
  mkId: number,
  keyword: string,
  limit = 5,
): Promise<MkSpeakerTurn[]> {
  const client = getTursoClient();
  try {
    const result = await client.execute({
      sql: `SELECT sst.session_id, ps.date, sst.text
            FROM plenary_speaker_turn sst
            JOIN plenary_session ps ON ps.id = sst.session_id
            WHERE sst.mk_id = ? AND sst.text LIKE ?
            ORDER BY ps.date DESC, LENGTH(sst.text) DESC
            LIMIT ?`,
      args: [mkId, `%${keyword}%`, limit * 3],
    });
    // Dedup: one turn per session
    const seen = new Map<number, MkSpeakerTurn>();
    for (const row of result.rows) {
      const sid = Number(row.session_id);
      if (!seen.has(sid)) {
        seen.set(sid, {
          sessionId: sid,
          committeeName: 'מליאה',
          date: String(row.date ?? ''),
          text: String(row.text ?? ''),
        });
      }
    }
    return [...seen.values()].slice(0, limit);
  } catch { return []; }
}
```

- [ ] **Step 2: Wire into ask route**

In `src/app/api/ask/route.ts`, import `searchPlenaryVec` and `searchMkPlenarySpeakerTurns`. Add to the parallel search block:

```typescript
const plenaryVecPromise = embedding
  ? searchPlenaryVec(embedding, 20).catch(() => [])
  : Promise.resolve([]);

const plenaryTurnsPromise = mkId && searchTerm.length >= 2
  ? searchMkPlenarySpeakerTurns(mkId, searchTerm, 4).catch(() => [])
  : Promise.resolve([]);

const [...existing, plenaryResults, plenaryTurns] = await Promise.all([
  ...existingPromises,
  plenaryVecPromise,
  plenaryTurnsPromise,
]);
```

Merge `plenaryTurns` with `speakerTurns` (label them as "מליאה" so the LLM knows it's a floor speech). Merge top plenary sessions into the vector results for the generic path.

- [ ] **Step 3: Bump cache key to v6**

- [ ] **Step 4: TypeScript check + commit**

```bash
npx tsc --noEmit 2>&1 | head -20
git add src/lib/protocols-db.ts src/app/api/ask/route.ts scripts/embed-plenary.ts
git commit -m "feat: plenary transcript search in ask pipeline"
```

---

## Verification

1. `SELECT COUNT(*) FROM plenary_session` in Turso — should be hundreds.
2. `SELECT COUNT(*) FROM plenary_speaker_turn WHERE mk_id IS NOT NULL` — non-zero.
3. Query "ליברמן מליאה" or "נתניהו קורונה" — sources should include מליאה sessions.
4. Check that מליאה is labelled distinctly from committee sessions in the LLM context.
