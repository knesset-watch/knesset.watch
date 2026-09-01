// scripts/backfill-vote-bill-ids.ts
//
// Run:
//   npx tsx scripts/backfill-vote-bill-ids.ts
//
// Purpose:
// KNS_PlenumVote.ItemID
//        ↓
// plenary_vote.bill_id
//
// Only saves ItemID when that ID actually exists in the local bill table.

import Database from "better-sqlite3";
import path from "path";

const API =
  (process.env.KNESSET_API_BASE || "https://knesset.gov.il") +
  "/OdataV4/ParliamentInfo";

const DB_PATH = path.join(process.cwd(), "knesset.db");

// הכנסת ה-25 התחילה בנובמבר 2022.
// נמשוך את כל ההצבעות מתקופה זו.
const K25_START = "2022-11-15T00:00:00+00:00";

// ── OData with retry ─────────────────────────────────────────────────────────

async function fetchPage(
  url: string,
): Promise<{ value: any[]; next: string | null }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0",
        },
        signal: AbortSignal.timeout(30000),
      });

      const text = await res.text();

      let json: any = null;

      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        // Body is not valid JSON
      }

      // לפעמים ה-API מחזיר 500 למרות שיש נתונים תקינים בגוף
      if (json && Array.isArray(json.value)) {
        if (!res.ok) {
          console.warn(
            `Warning: API returned ${res.status}, but response contained valid data`,
          );
        }

        return {
          value: json.value,
          next: json["@odata.nextLink"] ?? null,
        };
      }

      if (!res.ok) {
        throw new Error(`API ${res.status}`);
      }

      throw new Error("API response did not contain a value array");
    } catch (err: any) {
      if (attempt < 4) {
        const delay = (attempt + 1) * 3000;

        console.warn(
          `Request failed (${err.message}). Retrying in ${delay / 1000}s...`,
        );

        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }

  throw new Error("unreachable");
}

async function fetchAll(url: string): Promise<any[]> {
  const rows: any[] = [];

  let next: string | null = url;
  let pageNumber = 0;

  while (next) {
    pageNumber++;

    const page = await fetchPage(next);

    rows.push(...page.value);

    console.log(
      `  Page ${pageNumber}: ${page.value.length.toLocaleString()} rows ` +
        `(total ${rows.length.toLocaleString()})`,
    );

    next = page.next;
  }

  return rows;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Backfill Vote → Bill IDs");
  console.log("");

  const db = new Database(DB_PATH);

  db.pragma("journal_mode = WAL");

  // Ensure required columns exist
  const voteCols = (
    db.prepare("PRAGMA table_info(plenary_vote)").all() as { name: string }[]
  ).map((r) => r.name);

  if (!voteCols.includes("bill_id")) {
    db.exec("ALTER TABLE plenary_vote ADD COLUMN bill_id INTEGER");
    console.log("Added plenary_vote.bill_id");
  }

  if (!voteCols.includes("bill_id_source")) {
    db.exec("ALTER TABLE plenary_vote ADD COLUMN bill_id_source TEXT");
    console.log("Added plenary_vote.bill_id_source");
  }

  // Load all local bill IDs.
  // This is important because ItemID is not necessarily a bill in every vote.
  const billRows = db.prepare("SELECT DISTINCT id FROM bill").all() as {
    id: number;
  }[];

  const billIds = new Set<number>(billRows.map((r) => Number(r.id)));

  console.log(`Local unique bills: ${billIds.size.toLocaleString()}`);

  const before = db
    .prepare(
      `
      SELECT COUNT(DISTINCT id) AS count
      FROM plenary_vote
      WHERE bill_id IS NOT NULL
        AND bill_id_source = 'api'
    `,
    )
    .get() as { count: number };

  console.log(`Votes already linked by API: ${before.count.toLocaleString()}`);

  console.log("");
  console.log("Fetching Knesset 25 plenary votes...");

  // לא משתמשים ב-$select כאן,
  // כי ראינו שה-OData עלול להחזיר 500 כשמבקשים ItemID מפורשות.
  const filter = encodeURIComponent(`VoteDateTime ge ${K25_START}`);

  const votes = await fetchAll(`${API}/KNS_PlenumVote?$filter=${filter}`);

  console.log("");
  console.log(`Votes returned by API: ${votes.length.toLocaleString()}`);

  const updateVote = db.prepare(`
    UPDATE plenary_vote
    SET
      bill_id = ?,
      bill_id_source = 'api'
    WHERE id = ?
  `);

  let withItemId = 0;
  let itemIdIsBill = 0;
  let matchedLocalVote = 0;
  let notBill = 0;

  const updateBatch = db.transaction(() => {
    for (const vote of votes) {
      const voteId = Number(vote.Id);
      const itemId = vote.ItemID == null ? null : Number(vote.ItemID);

      if (!Number.isFinite(voteId)) {
        continue;
      }

      if (itemId == null || !Number.isFinite(itemId)) {
        continue;
      }

      withItemId++;

      // ItemID יכול להתייחס גם לפריט שאינו הצעת חוק.
      // מעדכנים רק אם הוא קיים בפועל בטבלת bill.
      if (!billIds.has(itemId)) {
        notBill++;
        continue;
      }

      itemIdIsBill++;

      const result = updateVote.run(itemId, voteId);

      if (result.changes > 0) {
        matchedLocalVote += result.changes;
      }
    }
  });

  updateBatch();

  const after = db
    .prepare(
      `
      SELECT COUNT(DISTINCT id) AS count
      FROM plenary_vote
      WHERE bill_id IS NOT NULL
        AND bill_id_source = 'api'
    `,
    )
    .get() as { count: number };

  const validJoin = db
    .prepare(
      `
      SELECT COUNT(DISTINCT v.id) AS count
      FROM plenary_vote v
      INNER JOIN bill b
        ON b.id = v.bill_id
      WHERE v.bill_id_source = 'api'
    `,
    )
    .get() as { count: number };

  console.log("");
  console.log("Results:");
  console.log(
    `  API votes                         : ${votes.length.toLocaleString()}`,
  );
  console.log(
    `  Votes with ItemID                 : ${withItemId.toLocaleString()}`,
  );
  console.log(
    `  ItemID matching a local bill      : ${itemIdIsBill.toLocaleString()}`,
  );
  console.log(
    `  ItemID not found in local bill    : ${notBill.toLocaleString()}`,
  );
  console.log(
    `  Local vote rows updated           : ${matchedLocalVote.toLocaleString()}`,
  );
  console.log(
    `  Unique votes linked by API before : ${before.count.toLocaleString()}`,
  );
  console.log(
    `  Unique votes linked by API after  : ${after.count.toLocaleString()}`,
  );
  console.log(
    `  Valid vote → bill joins           : ${validJoin.count.toLocaleString()}`,
  );

  // Show a small validation sample
  const sample = db
    .prepare(
      `
      SELECT
        v.id AS vote_id,
        v.title AS vote_title,
        v.bill_id,
        b.title AS bill_title
      FROM plenary_vote v
      INNER JOIN bill b
        ON b.id = v.bill_id
      WHERE v.bill_id_source = 'api'
      LIMIT 10
    `,
    )
    .all();

  console.log("");
  console.log("Sample linked votes:");
  console.table(sample);

  db.close();

  console.log("");
  console.log("Done.");
}

main().catch((err) => {
  console.error("");
  console.error("Backfill failed:", err.message);
  process.exit(1);
});
