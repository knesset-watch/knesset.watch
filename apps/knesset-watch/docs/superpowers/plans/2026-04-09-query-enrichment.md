# Parliamentary Query Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the 1,423 שאילתות (parliamentary queries) in the DB with full body text and ministry responses, making them fully searchable and useful for journalists.

**Architecture:** The Knesset OData API only exposes query titles. Full text is available on Knesset website HTML pages. A scraper script fetches each query page, extracts body + ministry response, and stores them in `mk_query`. The ask route's keyword search and LLM context then include the actual content of queries, not just titles.

**Tech Stack:** Node.js fetch + cheerio HTML parsing, better-sqlite3, TypeScript tsx scripts. The Knesset website uses ASP.NET WebForms; query pages are at a discoverable URL pattern.

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `scripts/enrich-queries.ts` | Scrape query body + ministry response for all mk_query rows |
| Modify | `scripts/sync.ts` | Add `body` + `ministry_response` fields to future query syncs |
| Modify | `src/lib/knesset-db.ts` | Update `searchQueriesByKeyword()` to search body text too |
| Run | SQL migration | Add columns to `mk_query` in knesset.db |

---

## Task 1: Investigate query page URL pattern

The Knesset website has individual pages for each query. Before building the scraper, confirm the URL and HTML structure.

- [ ] **Step 1: Find the query page URL pattern**

Pick a known query ID from the DB and check the Knesset website manually. The URL is likely one of:
- `https://knesset.gov.il/query/heb/query_det.aspx?queryId=2198600`
- `https://knesset.gov.il/api/queries/{id}`

Run this to get 5 sample query IDs:
```bash
cd apps/knesset-watch && npx tsx -e "
import Database from 'better-sqlite3';
const db = new Database('knesset.db', { readonly: true });
const rows = db.prepare('SELECT id, title FROM mk_query ORDER BY submit_date DESC LIMIT 5').all();
console.log(rows);
"
```

Fetch a sample page:
```bash
curl -s "https://knesset.gov.il/query/heb/query_det.aspx?queryId=2239610" | grep -i "query\|שאילתה\|תוכן\|body" | head -20
```

- [ ] **Step 2: Identify body and response HTML selectors**

Inspect the page source to find:
- The element containing the query body text (the actual question asked)
- The element containing the ministry response (if present)
- Common patterns: `<div id="ContentBody">`, `<td class="query-text">`, etc.

Document the selectors here before proceeding.

- [ ] **Step 3: Commit findings**

```bash
# No code change — just update this plan with the confirmed selectors before next task
git commit --allow-empty -m "chore: document query page URL pattern (see plan)"
```

---

## Task 2: Add body columns to mk_query

**Files:**
- Modify: `knesset.db` (local) via migration command
- Modify: `scripts/sync.ts` (add columns to CREATE TABLE if run fresh)

- [ ] **Step 1: Add columns to local knesset.db**

```bash
cd apps/knesset-watch && npx tsx -e "
import Database from 'better-sqlite3';
const db = new Database('knesset.db');
db.exec(\`
  ALTER TABLE mk_query ADD COLUMN body TEXT;
  ALTER TABLE mk_query ADD COLUMN ministry_response TEXT;
  ALTER TABLE mk_query ADD COLUMN enriched_at TEXT;
\`);
console.log('columns added');
"
```

Expected: `columns added`

- [ ] **Step 2: Verify**

```bash
npx tsx -e "
import Database from 'better-sqlite3';
const db = new Database('knesset.db', { readonly: true });
const row = db.prepare('SELECT * FROM mk_query LIMIT 1').get();
console.log(Object.keys(row));
"
```

Expected: `[ 'id', 'mk_id', 'title', 'submit_date', 'body', 'ministry_response', 'enriched_at' ]`

- [ ] **Step 3: Update sync.ts to preserve the new columns**

In `scripts/sync.ts`, find the `CREATE TABLE IF NOT EXISTS mk_query` statement and update the schema:

```sql
CREATE TABLE IF NOT EXISTS mk_query (
  id INTEGER PRIMARY KEY,
  mk_id INTEGER,
  title TEXT,
  submit_date TEXT,
  body TEXT,
  ministry_response TEXT,
  enriched_at TEXT
)
```

And update the upsert to not overwrite `body`/`ministry_response` if already set:

```sql
INSERT INTO mk_query (id, mk_id, title, submit_date)
VALUES (?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  mk_id = excluded.mk_id,
  title = excluded.title,
  submit_date = excluded.submit_date
  -- body, ministry_response, enriched_at intentionally NOT overwritten
```

- [ ] **Step 4: Commit**

```bash
git add scripts/sync.ts
git commit -m "feat: add body + ministry_response columns to mk_query"
```

---

## Task 3: Write the query enrichment scraper

**Files:**
- Create: `scripts/enrich-queries.ts`

**Note:** Fill in the `BODY_SELECTOR` and `RESPONSE_SELECTOR` constants from Task 1 findings before running.

- [ ] **Step 1: Install cheerio if not already present**

```bash
cd apps/knesset-watch && npm list cheerio 2>/dev/null || npm install cheerio
```

- [ ] **Step 2: Create the script**

```typescript
// scripts/enrich-queries.ts
// Fetches full query body + ministry response for all mk_query rows.
// Run: cd apps/knesset-watch && npx tsx scripts/enrich-queries.ts
// Safe to re-run — skips rows already enriched (enriched_at IS NOT NULL).

import Database from 'better-sqlite3';
import * as cheerio from 'cheerio';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const db = new Database(DB_PATH);

// ── Fill these in from Task 1 investigation ──────────────────────────────────
// URL pattern for individual query pages
const QUERY_URL = (id: number) =>
  `https://knesset.gov.il/query/heb/query_det.aspx?queryId=${id}`;

// CSS selectors for body text and ministry response (update after Task 1)
const BODY_SELECTOR = '#ContentBody'; // placeholder — confirm in Task 1
const RESPONSE_SELECTOR = '#ContentResponse'; // placeholder — confirm in Task 1
// ─────────────────────────────────────────────────────────────────────────────

const DELAY_MS = 1000; // be polite to the Knesset server
const BATCH = 20;      // rows per iteration

async function fetchQueryPage(id: number): Promise<{ body: string; ministryResponse: string }> {
  const url = QUERY_URL(id);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; KnessetWatch research bot)',
      'Accept-Language': 'he-IL,he;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const body = $(BODY_SELECTOR).text().trim();
  const ministryResponse = $(RESPONSE_SELECTOR).text().trim();
  return { body, ministryResponse };
}

async function main() {
  const pending = db.prepare(
    `SELECT id, title FROM mk_query WHERE enriched_at IS NULL ORDER BY id DESC`
  ).all() as Array<{ id: number; title: string }>;

  console.log(`Queries to enrich: ${pending.length}`);
  if (pending.length === 0) { console.log('Nothing to do.'); return; }

  const update = db.prepare(
    `UPDATE mk_query SET body = ?, ministry_response = ?, enriched_at = ? WHERE id = ?`
  );

  let done = 0;
  let errors = 0;

  for (const row of pending) {
    try {
      const { body, ministryResponse } = await fetchQueryPage(row.id);
      update.run(body || null, ministryResponse || null, new Date().toISOString(), row.id);
      done++;
      if (done % 10 === 0) {
        console.log(`[${done}/${pending.length}] Last: "${row.title.slice(0, 50)}"`);
      }
    } catch (e) {
      console.error(`  Error on id=${row.id}: ${e}`);
      errors++;
    }
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`Done. Enriched: ${done}, Errors: ${errors}`);
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Test with 3 rows**

Temporarily change the SELECT to `LIMIT 3` and run:

```bash
cd apps/knesset-watch && npx tsx scripts/enrich-queries.ts
```

Check output:
```bash
npx tsx -e "
import Database from 'better-sqlite3';
const db = new Database('knesset.db', { readonly: true });
const rows = db.prepare('SELECT id, title, LENGTH(body) as body_len, enriched_at FROM mk_query WHERE enriched_at IS NOT NULL LIMIT 3').all();
console.log(rows);
"
```

Expected: rows with `body_len > 0`.

- [ ] **Step 4: Run full enrichment in background**

Remove the LIMIT and run:

```bash
git add scripts/enrich-queries.ts
git commit -m "feat: script to scrape query body + ministry response"

nohup npx tsx scripts/enrich-queries.ts > enrich-queries.log 2>&1 &
echo "PID: $!"
```

---

## Task 4: Update search to include body text

**Files:**
- Modify: `src/lib/knesset-db.ts` — `searchQueriesByKeyword()`

- [ ] **Step 1: Update the LIKE condition to include body text**

Find `searchQueriesByKeyword` in `knesset-db.ts` and update the WHERE clause to also search `body`:

The current query has `WHERE q.mk_id = ? AND q.title LIKE ?`. Update to:

```sql
WHERE q.mk_id = ? AND (q.title LIKE ? OR q.body LIKE ?)
```

And the keyword-only variant:
```sql
WHERE (q.title LIKE ? OR q.body LIKE ?)
```

In practice: find the SQL in `searchQueriesByKeyword` and wherever `title LIKE ?` appears in that function, add `OR q.body LIKE ?` with the same parameter value.

- [ ] **Step 2: TypeScript check**

```bash
cd apps/knesset-watch && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Also update the LLM context builder in ask/route.ts**

In `src/app/api/ask/route.ts`, find where queries are added to context:

```typescript
context += `• ${qr.submitDate} — ${qr.title}\n`;
```

Update to include body excerpt when available:

```typescript
const bodyExcerpt = qr.body ? `\n  ${qr.body.slice(0, 300)}` : '';
const responseNote = qr.ministryResponse ? ` [תשובה: ${qr.ministryResponse.slice(0, 150)}]` : '';
context += `• ${qr.submitDate} — ${qr.title}${bodyExcerpt}${responseNote}\n`;
```

Update `searchQueriesByKeyword` return type to include `body` and `ministryResponse` fields if not already present.

- [ ] **Step 4: Bump cache key to v5 (or v6 if already v5)**

- [ ] **Step 5: Commit**

```bash
git add src/lib/knesset-db.ts src/app/api/ask/route.ts
git commit -m "feat: include query body + ministry response in search and LLM context"
```

---

## Verification

1. After enrichment script completes: `SELECT COUNT(*) FROM mk_query WHERE body IS NOT NULL` — should be close to 1,423.
2. Query "ליברמן יוקר המחיה" — שאילתות section should now show body excerpts.
3. Query on a topic where only the query body (not title) mentions the keyword — should now surface.
4. Ministry responses visible in the LLM context when present.
