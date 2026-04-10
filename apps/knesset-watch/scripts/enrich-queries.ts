/**
 * Enriches mk_query rows with full body text and ministry response.
 * Uses KNS_DocumentQuery OData endpoint to find DOCX files, downloads and parses them.
 * Safe to re-run — skips rows where enriched_at IS NOT NULL.
 *
 * Run: cd apps/knesset-watch && npx tsx scripts/enrich-queries.ts
 */
import Database from 'better-sqlite3';
import mammoth from 'mammoth';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const db = new Database(DB_PATH);
const API_BASE = 'https://knesset.gov.il/OdataV4/ParliamentInfo';

const CONCURRENCY = 5;
const DELAY_MS = 300;

const update = db.prepare(
  `UPDATE mk_query SET body = ?, ministry_response = ?, enriched_at = ?, source_url = ?, ministry_response_url = ? WHERE id = ?`
);

async function fetchDocList(queryId: number): Promise<Array<{ GroupTypeID: number; FilePath: string; ApplicationID: number }>> {
  const url = `${API_BASE}/KNS_DocumentQuery?$filter=QueryID eq ${queryId}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return [];
  // API returns a plain JSON array (not wrapped in {value:...}) with camelCase fields
  const raw = await res.json() as Array<{ groupTypeID?: number; GroupTypeID?: number; filePath?: string; FilePath?: string; applicationID?: number; ApplicationID?: number }> | { value: Array<{ groupTypeID?: number; GroupTypeID?: number; filePath?: string; FilePath?: string; applicationID?: number; ApplicationID?: number }> };
  const arr = Array.isArray(raw) ? raw : (raw.value ?? []);
  // Normalize to PascalCase
  return arr.map(d => ({
    GroupTypeID: d.GroupTypeID ?? d.groupTypeID ?? 0,
    FilePath: d.FilePath ?? d.filePath ?? '',
    ApplicationID: d.ApplicationID ?? d.applicationID ?? 99,
  }));
}

async function downloadDocx(filePath: string): Promise<string> {
  const res = await fetch(filePath, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${filePath}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return value.trim();
}

async function enrichQuery(id: number): Promise<{ body: string | null; ministryResponse: string | null; bodyUrl: string | null; responseUrl: string | null }> {
  const docs = await fetchDocList(id);
  // Prefer DOC (ApplicationID=1) over PDF; pick first match per GroupTypeID
  const pick = (groupTypeId: number) =>
    docs.filter(d => d.GroupTypeID === groupTypeId)
        .sort((a, b) => a.ApplicationID - b.ApplicationID)[0];

  const bodyDoc = pick(38);
  const responseDoc = pick(142);

  const bodyUrl = bodyDoc?.FilePath ?? null;
  const responseUrl = responseDoc?.FilePath ?? null;

  let body: string | null = null;
  let ministryResponse: string | null = null;

  if (bodyUrl) {
    try { body = await downloadDocx(bodyUrl); } catch { /* leave null */ }
  }
  if (responseUrl) {
    try { ministryResponse = await downloadDocx(responseUrl); } catch { /* leave null */ }
  }
  return { body, ministryResponse, bodyUrl, responseUrl };
}

async function processChunk(chunk: Array<{ id: number; title: string }>) {
  await Promise.all(chunk.map(async (row) => {
    try {
      const { body, ministryResponse, bodyUrl, responseUrl } = await enrichQuery(row.id);
      update.run(body, ministryResponse, new Date().toISOString(), bodyUrl, responseUrl, row.id);
    } catch (e) {
      console.error(`  Error id=${row.id}: ${e}`);
    }
  }));
}

async function main() {
  const pending = db.prepare(
    `SELECT id, title FROM mk_query WHERE enriched_at IS NULL ORDER BY id DESC`
  ).all() as Array<{ id: number; title: string }>;

  console.log(`Queries to enrich: ${pending.length}`);
  if (pending.length === 0) { console.log('All done.'); return; }

  let done = 0;
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const chunk = pending.slice(i, i + CONCURRENCY);
    await processChunk(chunk);
    done += chunk.length;
    if (done % 50 === 0 || done === pending.length) {
      console.log(`[${done}/${pending.length}] last: "${pending[i].title.slice(0, 50)}"`);
    }
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  const enriched = db.prepare(`SELECT COUNT(*) as n FROM mk_query WHERE body IS NOT NULL`).get() as { n: number };
  console.log(`Done. ${enriched.n} queries now have body text.`);
}

main().catch(e => { console.error(e); process.exit(1); });
