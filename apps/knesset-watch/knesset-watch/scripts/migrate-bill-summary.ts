/**
 * One-time migration: adds summary + doc_url columns to the bill table.
 *
 * - summary: SummaryLaw field from KNS_Bill (only populated for passed bills)
 * - doc_url: PDF link from KNS_DocumentBill (GroupType=1, prefer PDF over DOC)
 *
 * Usage:
 *   cd apps/knesset-watch
 *   npx tsx scripts/migrate-bill-summary.ts
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
      if (!res.ok) throw new Error(`API ${res.status}`);
      const json = await res.json();
      return { value: json.value ?? [], next: json['@odata.nextLink'] ?? null };
    } catch (err: any) {
      if (attempt < 4) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 3000));
      } else throw err;
    }
  }
  throw new Error('unreachable');
}

async function fetchAll(url: string, label: string): Promise<any[]> {
  const results: any[] = [];
  let next: string | null = url;
  while (next) {
    const page = await fetchPage(next);
    results.push(...page.value);
    next = page.next;
    process.stdout.write(`\r  ${label}: ${results.length.toLocaleString()}`);
  }
  console.log();
  return results;
}

async function migrate() {
  const db = new Database(DB_PATH);

  // Add columns if missing
  const cols = (db.prepare(`PRAGMA table_info(bill)`).all() as { name: string }[]).map(r => r.name);
  if (!cols.includes('summary')) {
    db.exec(`ALTER TABLE bill ADD COLUMN summary TEXT`);
    console.log('Added summary column');
  }
  if (!cols.includes('doc_url')) {
    db.exec(`ALTER TABLE bill ADD COLUMN doc_url TEXT`);
    console.log('Added doc_url column');
  }

  // ── Summaries (SummaryLaw — only on passed bills) ──────────────────────────
  console.log('\nFetching bill summaries (passed bills only)…');
  const summaryRows = await fetchAll(
    `${API}/KNS_Bill?$filter=${encodeURIComponent('KnessetNum eq 25 and SummaryLaw ne null')}&$select=Id,SummaryLaw`,
    'summaries',
  );

  const updateSummary = db.prepare(`UPDATE bill SET summary = ? WHERE id = ?`);
  db.transaction((rows: any[]) => {
    for (const r of rows) {
      if (r.SummaryLaw) updateSummary.run(r.SummaryLaw.trim(), r.Id);
    }
  })(summaryRows);
  console.log(`  Updated ${summaryRows.length} bill summaries`);

  // ── Doc URLs (KNS_DocumentBill — GroupType 1, prefer PDF) ─────────────────
  // Only 9191 total across all Knessets — fetch in one shot
  console.log('\nFetching bill document links…');

  // Prefer PDF (ApplicationID=4), fallback to DOC (ApplicationID=1)
  const [pdfRows, docRows] = await Promise.all([
    fetchAll(
      `${API}/KNS_DocumentBill?$filter=${encodeURIComponent('GroupTypeID eq 1 and ApplicationID eq 4')}&$select=BillID,FilePath`,
      'PDFs',
    ),
    fetchAll(
      `${API}/KNS_DocumentBill?$filter=${encodeURIComponent('GroupTypeID eq 1 and ApplicationID eq 1')}&$select=BillID,FilePath`,
      'DOCs',
    ),
  ]);

  // Build BillID → URL map (PDF takes priority)
  const docMap = new Map<number, string>();
  const normalise = (p: string) => p.replace(/\\/g, '/').replace(/\/\//g, '/').replace('https:/', 'https://');

  for (const r of docRows) docMap.set(r.BillID, normalise(r.FilePath));
  for (const r of pdfRows) docMap.set(r.BillID, normalise(r.FilePath)); // overwrites DOC

  // Get all bill IDs in our DB
  const billIds = (db.prepare('SELECT id FROM bill').all() as { id: number }[]).map(r => r.id);
  const updateDocUrl = db.prepare(`UPDATE bill SET doc_url = ? WHERE id = ?`);

  let updated = 0;
  db.transaction((ids: number[]) => {
    for (const id of ids) {
      const url = docMap.get(id);
      if (url) { updateDocUrl.run(url, id); updated++; }
    }
  })(billIds);

  console.log(`  Updated ${updated.toLocaleString()} bill doc URLs (out of ${billIds.length.toLocaleString()} bills)`);

  // Stats
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN summary IS NOT NULL THEN 1 ELSE 0 END) as with_summary,
      SUM(CASE WHEN doc_url IS NOT NULL THEN 1 ELSE 0 END) as with_doc
    FROM bill
  `).get() as { total: number; with_summary: number; with_doc: number };

  console.log(`\nDone. Bills: ${stats.total}, with summary: ${stats.with_summary}, with doc: ${stats.with_doc}`);
  db.close();
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
