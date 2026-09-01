import Database from "better-sqlite3";
import path from "path";

const API = "https://knesset.gov.il/OdataV4/ParliamentInfo";
const DB_PATH = path.join(process.cwd(), "knesset.db");

const PASSED_STATUS_IDS = new Set([118, 119, 6020, 6030, 6040]);

async function fetchPage(
  url: string,
): Promise<{ value: any[]; next: string | null }> {
  for (let attempt = 1; attempt <= 10; attempt++) {
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
        json = JSON.parse(text);
      } catch {
        // handled below
      }

      // The Knesset API sometimes returns usable JSON even with a bad status.
      if (json && Array.isArray(json.value)) {
        return {
          value: json.value,
          next: json["@odata.nextLink"] ?? null,
        };
      }

      if (
        res.status >= 400 &&
        res.status < 500 &&
        res.status !== 429
      ) {
        throw new Error(`HTTP ${res.status}`);
      }

      throw new Error(`HTTP ${res.status}`);
    } catch (err: any) {
      if (attempt === 10) {
        throw err;
      }

      const delay = Math.min(attempt * 3000, 30000);

      console.warn(
        `Request failed (${err.message}). Retrying in ${delay / 1000}s...`,
      );

      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error("unreachable");
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const db = new Database(DB_PATH);

  try {
    const existingRows = db
      .prepare("SELECT DISTINCT id FROM bill")
      .all() as { id: number }[];

    const existingIds = new Set(existingRows.map((r) => Number(r.id)));

    console.log(
      `Existing unique bills: ${existingIds.size.toLocaleString()}`,
    );

    let url: string | null =
      `${API}/KNS_Bill` +
      `?$filter=${encodeURIComponent("KnessetNum eq 25")}` +
      `&$expand=KNS_BillInitiator($select=PersonID)` +
      `&$select=Id,Name,SubTypeDesc,StatusID`;

    const missingBills: any[] = [];
    let apiCount = 0;


    const officialIds = new Set<number>();
    const duplicateApiIds = new Set<number>();

    while (url) {
      const page = await fetchPage(url);

      apiCount += page.value.length;

      for (const bill of page.value) {
        const id = Number(bill.Id);

        if (officialIds.has(id)) {
            duplicateApiIds.add(id);
        }

        officialIds.add(id);


        if (!existingIds.has(id)) {
          missingBills.push(bill);
        }
      }

      process.stdout.write(
        `\rAPI bills checked: ${apiCount.toLocaleString()}`,
      );

      url = page.next;

      if (url) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    console.log("\n");

    console.log(`Official K25 bills: ${apiCount.toLocaleString()}`);
    console.log(
      `Missing from local DB: ${missingBills.length.toLocaleString()}`,
    );

    const uniqueMissingIds = new Set(
      missingBills.map((bill) => Number(bill.Id)),
    );

    const localOnlyIds = [...existingIds].filter(
      (id) => !officialIds.has(id),
    );

    console.log(`Official unique IDs: ${officialIds.size.toLocaleString()}`);
    console.log(`Unique missing IDs: ${uniqueMissingIds.size.toLocaleString()}`);
    console.log(`Duplicate IDs returned by API: ${duplicateApiIds.size}`);
    console.log(`Local IDs not in official K25 set: ${localOnlyIds.length}`);

    if (localOnlyIds.length > 0) {
      console.log("\nLocal-only IDs:");
      console.log(localOnlyIds.slice(0, 20).join(", "));
    }


    console.log("\nSample missing bills:");

    for (const bill of missingBills.slice(0, 10)) {
      console.log(`${bill.Id} | ${bill.Name}`);
    }

    if (dryRun) {
      console.log("\nDry run only — no DB changes made.");
      return;
    }

    const insertBill = db.prepare(`
      INSERT INTO bill (
        id,
        title,
        subtype,
        status_id,
        is_passed
      )
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertInitiator = db.prepare(`
      INSERT OR IGNORE INTO bill_initiator (
        bill_id,
        mk_id
      )
      VALUES (?, ?)
    `);

    let insertedBills = 0;
    let insertedInitiators = 0;

    const insertBatch = db.transaction((bills: any[]) => {
      for (const bill of bills) {
        // Recheck inside the transaction.
        const exists = db
          .prepare("SELECT 1 FROM bill WHERE id = ? LIMIT 1")
          .get(bill.Id);

        if (exists) {
          continue;
        }

        const statusId = bill.StatusID ?? 0;

        insertBill.run(
          bill.Id,
          bill.Name ?? "",
          bill.SubTypeDesc ?? "",
          statusId,
          PASSED_STATUS_IDS.has(statusId) ? 1 : 0,
        );

        insertedBills++;

        for (const init of bill.KNS_BillInitiator ?? []) {
          if (!init.PersonID) {
            continue;
          }

          const result = insertInitiator.run(
            bill.Id,
            init.PersonID,
          );

          insertedInitiators += result.changes;
        }
      }
    });

    insertBatch(missingBills);

    console.log("\nBackfill complete.");
    console.log(`Bills inserted: ${insertedBills}`);
    console.log(`Initiators inserted: ${insertedInitiators}`);

    const finalCount = db
      .prepare("SELECT COUNT(DISTINCT id) AS count FROM bill")
      .get() as { count: number };

    console.log(
      `Unique bills now: ${finalCount.count.toLocaleString()}`,
    );
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error("\nBackfill failed:", err);
  process.exit(1);
});