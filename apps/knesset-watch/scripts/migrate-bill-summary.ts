/**
 * Enrich Knesset 25 bills with summaries and document URLs.
 *
 * - summary: SummaryLaw from KNS_Bill
 * - doc_url: document URL from KNS_DocumentBill
 *   (prefer PDF over DOC)
 * - text_content: column prepared for the document extraction step
 */

import Database from 'better-sqlite3';
import path from 'path';

const API = 'https://knesset.gov.il/OdataV4/ParliamentInfo';
const DB_PATH = path.join(process.cwd(), 'knesset.db');

async function fetchPage(
  url: string,
): Promise<{ value: any[]; next: string | null }> {
  const maxAttempts = 10;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0',
        },
        signal: AbortSignal.timeout(30000),
      });

      const text = await res.text();

      let json: any = null;

      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        // Response body is not valid JSON.
      }

      // Knesset API sometimes returns 500
      // even when the body contains valid OData data.
      if (json && Array.isArray(json.value)) {
        if (!res.ok) {
          console.warn(
            `\n  Warning: API returned ${res.status}, but response contained valid data`,
          );
        }

        return {
          value: json.value,
          next: json['@odata.nextLink'] ?? null,
        };
      }

      if (
        res.status >= 400 &&
        res.status < 500 &&
        res.status !== 429
      ) {
        const error: any =
          new Error(`API ${res.status}`);

        error.retryable = false;

        throw error;
      }

      if (!res.ok) {
        throw new Error(`API ${res.status}`);
      }

      throw new Error('API response did not contain a value array');
    } catch (err: any) {
      if (err.retryable === false) {
        throw err;
      }
      if (attempt < maxAttempts - 1) {
        const delay = Math.min((attempt + 1) * 3000, 30000);

        console.warn(
          `\n  Request failed (${err.message}). Retrying in ${delay / 1000}s...`,
        );

        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
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

    process.stdout.write(
      `\r  ${label}: ${results.length.toLocaleString()}`,
    );

    if (next) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log();

  return results;
}


async function migrate() {
  const db = new Database(DB_PATH);

  try {
    // -----------------------------------------------------------------------
    // Ensure required columns exist
    // -----------------------------------------------------------------------

    const cols = (
      db.prepare(`PRAGMA table_info(bill)`).all() as { name: string }[]
    ).map(r => r.name);

    if (!cols.includes('summary')) {
      db.exec(`ALTER TABLE bill ADD COLUMN summary TEXT`);
      console.log('Added summary column');
    }

    if (!cols.includes('doc_url')) {
      db.exec(`ALTER TABLE bill ADD COLUMN doc_url TEXT`);
      console.log('Added doc_url column');
    }

    if (!cols.includes('text_content')) {
      db.exec(`ALTER TABLE bill ADD COLUMN text_content TEXT`);
      console.log('Added text_content column');
    }


    // -----------------------------------------------------------------------
    // Step 1: Fetch ONLY bills from Knesset 25
    // -----------------------------------------------------------------------

    console.log('\nFetching bills from Knesset 25…');

    const currentBills = await fetchAll(
      `${API}/KNS_Bill?$filter=${encodeURIComponent(
        'KnessetNum eq 25',
      )}&$select=Id,SummaryLaw`,
      'Knesset 25 bills',
    );

    const localBillIds = new Set<number>(
      (
        db.prepare(`
          SELECT DISTINCT id
          FROM bill
          WHERE id IS NOT NULL
        `).all() as { id: number }[]
      ).map(r => r.id),
    );

    // Only bills that:
    // 1. belong to Knesset 25
    // 2. exist in our local bill table
    const currentBillIds = new Set<number>();

    for (const bill of currentBills) {
      if (localBillIds.has(bill.Id)) {
        currentBillIds.add(bill.Id);
      }
    }

    console.log(
      `  Knesset 25 bills from API: ${currentBills.length.toLocaleString()}`,
    );

    console.log(
      `  Matching bills in local DB: ${currentBillIds.size.toLocaleString()}`,
    );

    if (currentBillIds.size === 0) {
      throw new Error(
        'No Knesset 25 bill IDs matched the local bill table',
      );
    }


    // -----------------------------------------------------------------------
    // Save summaries
    // -----------------------------------------------------------------------

    console.log('\nUpdating summaries…');

    const updateSummary = db.prepare(`
      UPDATE bill
      SET summary = ?
      WHERE id = ?
    `);

    const saveSummaries = db.transaction((rows: any[]) => {
      let updated = 0;

      for (const row of rows) {
        if (
          currentBillIds.has(row.Id) &&
          row.SummaryLaw &&
          row.SummaryLaw.trim()
        ) {
          updated += updateSummary.run(
            row.SummaryLaw.trim(),
            row.Id,
          ).changes;
        }
      }

      return updated;
    });

    const summariesUpdated = saveSummaries(currentBills);

    console.log(
      `  Updated ${summariesUpdated.toLocaleString()} summary rows`,
    );


    // -----------------------------------------------------------------------
    // Step 2: Fetch document links ONLY for verified Knesset 25 Bill IDs
    // -----------------------------------------------------------------------

    console.log('\nFetching Knesset 25 bill document links…');

    const billsWithDoc = new Set<number>(
      (
        db.prepare(`
      SELECT DISTINCT id
      FROM bill
      WHERE doc_url IS NOT NULL
        AND TRIM(doc_url) <> ''
    `).all() as { id: number }[]
      ).map(row => row.id),
    );

    const billIds = [...currentBillIds].filter(
      id => !billsWithDoc.has(id),
    );

    console.log(
      `  Bills already with document URL: ${billsWithDoc.size.toLocaleString()}`,
    );

    console.log(
      `  Bills still to check: ${billIds.length.toLocaleString()}`,
    );

    const normalise = (path: string) =>
      path
        .replace(/\\/g, '/')
        .replace(/\/\//g, '/')
        .replace('https:/', 'https://');


    const updateDocUrl = db.prepare(`
  UPDATE bill
  SET doc_url = ?
  WHERE id = ?
`);

    async function fetchDocumentsForBills(): Promise<void> {
      let checked = 0;
      let documentsFound = 0;
      let updated = 0;
      let failed = 0;

      for (const billId of billIds) {
        try {
          const filter = `BillID eq ${billId}`;

          let next: string | null =
            `${API}/KNS_DocumentBill?$filter=${encodeURIComponent(
              filter,
            )}&$select=BillID,FilePath,ApplicationID`;

          const rows: any[] = [];

          while (next) {
            const page = await fetchPage(next);

            rows.push(...page.value);
            next = page.next;

            if (next) {
              await new Promise(r => setTimeout(r, 400));
            }
          }

          // Prefer PDF (ApplicationID = 4)
          // and use DOC (ApplicationID = 1) only as fallback.
          const pdf = rows.find(
            r =>
              Number(r.ApplicationID) === 4 &&
              r.FilePath,
          );

          const doc = rows.find(
            r =>
              Number(r.ApplicationID) === 1 &&
              r.FilePath,
          );

          const chosen = pdf ?? doc;

          if (chosen) {
            const fileUrl = normalise(chosen.FilePath);

            updated += updateDocUrl.run(
              fileUrl,
              billId,
            ).changes;

            documentsFound++;
          }
        } catch (err: any) {
          failed++;

          console.warn(
            `\n  Failed BillID ${billId}: ${err.message}`,
          );
        }

        checked++;

        process.stdout.write(
          `\r  Documents: checked ${checked}/${billIds.length}, ` +
          `found ${documentsFound}, updated ${updated}, failed ${failed}`,
        );

        await new Promise(r => setTimeout(r, 400));
      }

      console.log();
    }

    await fetchDocumentsForBills();

    // -----------------------------------------------------------------------
    // Final statistics
    // -----------------------------------------------------------------------

    const stats = db.prepare(`
      SELECT
        COUNT(*) AS total_rows,

        COUNT(DISTINCT id) AS unique_bills,

        SUM(
          CASE
            WHEN summary IS NOT NULL
             AND TRIM(summary) <> ''
            THEN 1
            ELSE 0
          END
        ) AS rows_with_summary,

        COUNT(
          DISTINCT CASE
            WHEN summary IS NOT NULL
             AND TRIM(summary) <> ''
            THEN id
          END
        ) AS bills_with_summary,

        SUM(
          CASE
            WHEN doc_url IS NOT NULL
             AND TRIM(doc_url) <> ''
            THEN 1
            ELSE 0
          END
        ) AS rows_with_doc,

        COUNT(
          DISTINCT CASE
            WHEN doc_url IS NOT NULL
             AND TRIM(doc_url) <> ''
            THEN id
          END
        ) AS bills_with_doc

      FROM bill
    `).get() as {
      total_rows: number;
      unique_bills: number;
      rows_with_summary: number;
      bills_with_summary: number;
      rows_with_doc: number;
      bills_with_doc: number;
    };


    console.log('\nDone.');

    console.log(
      `  Bill rows: ${stats.total_rows.toLocaleString()}`,
    );

    console.log(
      `  Unique bills: ${stats.unique_bills.toLocaleString()}`,
    );

    console.log(
      `  Unique bills with summary: ${stats.bills_with_summary.toLocaleString()}`,
    );

    console.log(
      `  Unique bills with document URL: ${stats.bills_with_doc.toLocaleString()}`,
    );

  } finally {
    db.close();
  }
}


migrate().catch(err => {
  console.error('\nMigration failed:', err.message);
  process.exit(1);
});