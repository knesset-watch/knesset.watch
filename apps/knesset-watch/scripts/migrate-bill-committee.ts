/**
 * One-time migration: adds committee_id + committee_name to the bill table
 * and backfills them from the Knesset API.
 *
 * Usage:
 *   cd apps/knesset-watch
 *   npx tsx scripts/migrate-bill-committee.ts
 */

import Database from 'better-sqlite3';
import path from 'path';

const API = 'https://knesset.gov.il/OdataV4/ParliamentInfo';
const DB_PATH = path.join(process.cwd(), 'knesset.db');

async function fetchPage(url: string): Promise<{ value: any[]; next: string | null }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`Knesset API ${res.status}`);
      const json = await res.json();
      return { value: json.value ?? [], next: json['@odata.nextLink'] ?? null };
    } catch (err: any) {
      if (attempt < 4) {
        const wait = (attempt + 1) * 3000;
        process.stdout.write(`\n  Retry ${attempt + 1}/4 after ${wait / 1000}s (${err.message})…`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }
  throw new Error('unreachable');
}

async function fetchAll(url: string): Promise<any[]> {
  const results: any[] = [];
  let next: string | null = url;
  while (next) {
    const page = await fetchPage(next);
    results.push(...page.value);
    next = page.next;
    if (results.length % 500 === 0) process.stdout.write(`\r  ${results.length.toLocaleString()} fetched`);
  }
  return results;
}

async function migrate() {
  const db = new Database(DB_PATH);

  // Add columns if they don't already exist
  const cols = (db.prepare(`PRAGMA table_info(bill)`).all() as { name: string }[]).map(r => r.name);
  if (!cols.includes('committee_id')) {
    db.exec(`ALTER TABLE bill ADD COLUMN committee_id INTEGER`);
    console.log('Added committee_id column');
  }
  if (!cols.includes('committee_name')) {
    db.exec(`ALTER TABLE bill ADD COLUMN committee_name TEXT`);
    console.log('Added committee_name column');
  }

  // Fetch committee names
  console.log('Fetching committees…');
  const committeeRows = await fetchAll(`${API}/KNS_Committee?$select=Id,Name`);
  const committeeMap = new Map<number, string>();
  for (const r of committeeRows) {
    if (r.Id != null && r.Name) committeeMap.set(r.Id, r.Name);
  }
  console.log(`  ${committeeMap.size} committees loaded`);

  // Check how many bills already have committee data
  const alreadyTagged = (db.prepare('SELECT COUNT(*) as n FROM bill WHERE committee_name IS NOT NULL').get() as { n: number }).n;
  console.log(`  ${alreadyTagged.toLocaleString()} bills already tagged`);

  // Fetch all K25 bill IDs + committee IDs
  console.log('Fetching K25 bill committee assignments…');
  const billRows = await fetchAll(
    `${API}/KNS_Bill?$filter=${encodeURIComponent('KnessetNum eq 25')}&$select=Id,CommitteeID`,
  );
  console.log(`\n  ${billRows.length.toLocaleString()} bills fetched`);

  // Batch update
  const update = db.prepare(`UPDATE bill SET committee_id = ?, committee_name = ? WHERE id = ?`);
  const batchUpdate = db.transaction((rows: any[]) => {
    let updated = 0;
    for (const r of rows) {
      if (!r.CommitteeID) continue;
      const name = committeeMap.get(r.CommitteeID) ?? null;
      update.run(r.CommitteeID, name, r.Id);
      updated++;
    }
    return updated;
  });

  const updated = batchUpdate(billRows);
  console.log(`Updated ${updated.toLocaleString()} bills with committee assignments`);

  db.close();
  console.log('Migration complete.');
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
