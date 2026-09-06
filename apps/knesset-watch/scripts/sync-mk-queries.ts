import Database from "better-sqlite3";
import path from "path";

const API_BASE =
  process.env.KNESSET_API_BASE?.trim() || "https://knesset.gov.il";
const API = API_BASE.replace(/\/$/, "") + "/OdataV4/ParliamentInfo";
const DB_PATH = path.join(process.cwd(), "knesset.db");

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
      } catch {}

      if (json && Array.isArray(json.value)) {
        return {
          value: json.value,
          next: json["@odata.nextLink"] ?? null,
        };
      }

      throw new Error(`API ${res.status}`);
    } catch (err: any) {
      if (attempt === 4) throw err;
      const delay = (attempt + 1) * 3000;
      console.warn(
        `Request failed (${err.message}). Retrying in ${delay / 1000}s...`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error("unreachable");
}

async function fetchAll(url: string): Promise<any[]> {
  const rows: any[] = [];
  let next: string | null = url;

  while (next) {
    const page = await fetchPage(next);
    rows.push(...page.value);
    next = page.next;
  }

  return rows;
}

async function main() {
  const db = new Database(DB_PATH);

  const ministryRows = await fetchAll(
    `${API}/KNS_GovMinistry?$select=Id,Name`,
  );

  const ministryMap = new Map<number, string>();
  for (const m of ministryRows) {
    if (m.Id != null && m.Name) ministryMap.set(m.Id, m.Name);
  }

  const before = db.prepare(`
    SELECT
      COUNT(*) AS count,
      MAX(submit_date) AS latest
    FROM mk_query
  `).get() as any;

  console.log("Before:", before);

  console.log("Fetching all Knesset 25 queries...");

  const queries = await fetchAll(
    `${API}/KNS_Query?$filter=${encodeURIComponent("KnessetNum eq 25")}`,
  );

  console.log(`Fetched: ${queries.length.toLocaleString()}`);

  const upsert = db.prepare(`
    INSERT INTO mk_query (
      id, mk_id, title, submit_date,
      gov_ministry_id, gov_ministry_name,
      query_number, type_desc, reply_date
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      mk_id             = excluded.mk_id,
      title             = excluded.title,
      submit_date       = excluded.submit_date,
      gov_ministry_id   = excluded.gov_ministry_id,
      gov_ministry_name = excluded.gov_ministry_name,
      query_number      = excluded.query_number,
      type_desc         = excluded.type_desc,
      reply_date        = excluded.reply_date
  `);

  let written = 0;

  db.transaction(() => {
    for (const r of queries) {
      if (!r.PersonID) continue;

      const ministryId = r.GovMinistryID ?? null;

      upsert.run(
        r.Id,
        r.PersonID,
        r.Name ?? "",
        r.SubmitDate ?? "",
        ministryId,
        ministryId != null ? ministryMap.get(ministryId) ?? null : null,
        r.Number ?? null,
        r.TypeDesc ?? null,
        r.ReplyMinisterDate ?? null,
      );

      written++;
    }
  })();

  const after = db.prepare(`
    SELECT
      COUNT(*) AS count,
      MAX(submit_date) AS latest_submit,
      MAX(reply_date) AS latest_reply
    FROM mk_query
  `).get() as any;

  console.log(`Written: ${written.toLocaleString()}`);
  console.log("After:", after);

  db.close();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
