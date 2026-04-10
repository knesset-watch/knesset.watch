/**
 * Backfills source_url and ministry_response_url from KNS_DocumentQuery.
 * source_url = FilePath of GroupTypeID=38 DOCX (query body)
 * ministry_response_url = FilePath of GroupTypeID=142 DOCX (ministry response)
 *
 * Only processes rows that have body text but no source_url.
 * Safe to re-run — skips rows where source_url IS NOT NULL.
 *
 * Run: cd apps/knesset-watch && npx tsx scripts/backfill-query-urls.ts
 */
import Database from 'better-sqlite3';
import path from 'path';

const db = new Database(path.join(process.cwd(), 'knesset.db'));
const API = 'https://knesset.gov.il/OdataV4/ParliamentInfo';

const updateUrls = db.prepare(`
  UPDATE mk_query SET source_url = ?, ministry_response_url = ? WHERE id = ?
`);

async function fetchDocUrls(queryId: number): Promise<{bodyUrl: string|null; responseUrl: string|null}> {
  const url = `${API}/KNS_DocumentQuery?$filter=QueryID eq ${queryId}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return { bodyUrl: null, responseUrl: null };
  const raw = await res.json() as any;
  const docs: any[] = Array.isArray(raw) ? raw : (raw.value ?? []);

  const pick = (groupTypeId: number) =>
    docs.filter(d => (d.groupTypeID ?? d.GroupTypeID) === groupTypeId)
        .sort((a, b) => (a.applicationID ?? a.ApplicationID ?? 99) - (b.applicationID ?? b.ApplicationID ?? 99))[0];

  const bodyDoc = pick(38);
  const responseDoc = pick(142);

  return {
    bodyUrl: bodyDoc?.filePath ?? bodyDoc?.FilePath ?? null,
    responseUrl: responseDoc?.filePath ?? responseDoc?.FilePath ?? null,
  };
}

async function main() {
  const pending = db.prepare(`
    SELECT id FROM mk_query WHERE source_url IS NULL AND body IS NOT NULL ORDER BY id DESC
  `).all() as { id: number }[];

  console.log(`Queries needing URL backfill: ${pending.length}`);

  const BATCH = 10;
  const DELAY = 300;
  let done = 0;

  for (let i = 0; i < pending.length; i += BATCH) {
    const chunk = pending.slice(i, i + BATCH);
    await Promise.all(chunk.map(async ({ id }) => {
      try {
        const { bodyUrl, responseUrl } = await fetchDocUrls(id);
        updateUrls.run(bodyUrl, responseUrl, id);
      } catch (e) {
        console.error(`  Error id=${id}:`, e);
      }
    }));
    done += chunk.length;
    if (done % 100 === 0 || done === pending.length) {
      console.log(`[${done}/${pending.length}] URLs backfilled`);
    }
    await new Promise(r => setTimeout(r, DELAY));
  }

  const withUrl = db.prepare(`SELECT COUNT(*) as n FROM mk_query WHERE source_url IS NOT NULL`).get() as {n:number};
  console.log(`Done. ${withUrl.n} queries now have source_url`);
}

main().catch(e => { console.error(e); process.exit(1); });
