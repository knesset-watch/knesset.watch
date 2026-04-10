/**
 * Backfills gov_ministry_id, gov_ministry_name, query_number, type_desc, reply_date
 * from the Knesset OData API into all K25 mk_query rows.
 * Safe to re-run — never touches body/ministry_response/enriched_at/source_url/ministry_response_url.
 *
 * Run: cd apps/knesset-watch && npx tsx scripts/backfill-query-metadata.ts
 */
import Database from 'better-sqlite3';
import path from 'path';

const db = new Database(path.join(process.cwd(), 'knesset.db'));
const API = 'https://knesset.gov.il/OdataV4/ParliamentInfo';

async function fetchAll(url: string): Promise<any[]> {
  const results: any[] = [];
  let next: string | null = url;
  while (next) {
    const res = await fetch(next, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${next}`);
    const data = await res.json() as any;
    results.push(...(data.value ?? []));
    next = data['@odata.nextLink'] ?? null;
  }
  return results;
}

const updateMeta = db.prepare(`
  UPDATE mk_query SET
    gov_ministry_id   = ?,
    gov_ministry_name = ?,
    query_number      = ?,
    type_desc         = ?,
    reply_date        = ?
  WHERE id = ?
`);

async function main() {
  // Fetch ministry name lookup table
  console.log('Fetching KNS_GovMinistry names...');
  const ministryRows = await fetchAll(`${API}/KNS_GovMinistry?$select=Id,Name`);
  const ministryMap = new Map<number, string>();
  for (const m of ministryRows) {
    if (m.Id != null && m.Name) ministryMap.set(m.Id, m.Name);
  }
  console.log(`Loaded ${ministryMap.size} ministry names`);

  console.log('Fetching KNS_Query from API...');
  const rows = await fetchAll(
    `${API}/KNS_Query?$filter=${encodeURIComponent('KnessetNum eq 25')}`
  );
  console.log(`Fetched ${rows.length} rows`);

  const batchUpdate = db.transaction((rows: any[]) => {
    for (const r of rows) {
      const ministryId = r.GovMinistryID ?? null;
      const ministryName = ministryId != null ? (ministryMap.get(ministryId) ?? null) : null;
      updateMeta.run(
        ministryId,
        ministryName,
        r.Number ?? null,
        r.TypeDesc ?? null,
        r.ReplyMinisterDate ?? null,
        r.Id,
      );
    }
  });
  batchUpdate(rows);
  console.log('Metadata updated.');

  // Verify
  const sample = db.prepare(`
    SELECT id, query_number, type_desc, gov_ministry_name, reply_date
    FROM mk_query WHERE gov_ministry_name IS NOT NULL LIMIT 5
  `).all();
  console.log('Sample:', JSON.stringify(sample, null, 2));

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      COUNT(gov_ministry_id) as with_ministry,
      COUNT(query_number) as with_number,
      COUNT(type_desc) as with_type
    FROM mk_query
  `).get();
  console.log('Stats:', stats);
}

main().catch(e => { console.error(e); process.exit(1); });
