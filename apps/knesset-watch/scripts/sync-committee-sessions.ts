import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import Database from "better-sqlite3";
import path from "path";

const API_BASE =
  process.env.KNESSET_API_BASE?.trim() || "https://knesset.gov.il";

const API =
  API_BASE.replace(/\/$/, "") + "/OdataV4/ParliamentInfo";

const DB_PATH = path.join(process.cwd(), "knesset.db");

async function fetchPage(
  url: string,
): Promise<{ value: any[]; next: string | null }> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0",
    },
  });

  if (!res.ok) {
    throw new Error(`Knesset API ${res.status}: ${url}`);
  }

  const json = await res.json();

  return {
    value: json.value ?? [],
    next: json["@odata.nextLink"] ?? null,
  };
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

  try {
    const duplicateIds = (
      db.prepare(`
        SELECT COUNT(*) AS n
        FROM (
          SELECT id
          FROM committee_session
          GROUP BY id
          HAVING COUNT(*) > 1
        )
      `).get() as { n: number }
    ).n;

    if (duplicateIds !== 0) {
      throw new Error(
        `committee_session contains ${duplicateIds} duplicate IDs`,
      );
    }

    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_committee_session_id_unique
      ON committee_session(id)
    `);

    const current = db.prepare(`
      SELECT
        COALESCE(MAX(id), 0) AS lastSessionId,
        MAX(date) AS latestDate,
        COUNT(*) AS total
      FROM committee_session
    `).get() as {
      lastSessionId: number;
      latestDate: string | null;
      total: number;
    };

    console.log("Before:");
    console.log("  rows:", current.total);
    console.log("  max id:", current.lastSessionId);
    console.log("  latest date:", current.latestDate);

    console.log("\nFetching committee names...");

    const committees = await fetchAll(
      `${API}/KNS_Committee?$select=Id,Name`,
    );

    const committeeNames = new Map<number, string>(
      committees
        .filter((r: any) => r.Id != null && r.Name)
        .map((r: any) => [Number(r.Id), String(r.Name)]),
    );

    console.log("  committees:", committeeNames.size);

    console.log(
      `\nFetching K25 sessions with Id > ${current.lastSessionId}...`,
    );

    const newSessions = await fetchAll(
      `${API}/KNS_CommitteeSession` +
        `?$filter=${encodeURIComponent(
          `KnessetNum eq 25 and Id gt ${current.lastSessionId}`,
        )}` +
        `&$select=Id,KnessetNum,CommitteeID,TypeID,TypeDesc,StatusID,StatusDesc,SessionUrl,StartDate,FinishDate`,
    );

    console.log("  fetched:", newSessions.length);

    if (newSessions.length > 0) {
      const upsert = db.prepare(`
        INSERT INTO committee_session (
          id,
          committee_id,
          title,
          date,
          committee_name,
          knesset_num,
          status_id,
          status_desc,
          type_id,
          type_desc,
          session_url,
          start_time,
          end_time
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          committee_id = excluded.committee_id,
          date = COALESCE(excluded.date, committee_session.date),
          committee_name = COALESCE(
            excluded.committee_name,
            committee_session.committee_name
          ),
          knesset_num = COALESCE(excluded.knesset_num, committee_session.knesset_num),
          status_id = COALESCE(excluded.status_id, committee_session.status_id),
          status_desc = COALESCE(excluded.status_desc, committee_session.status_desc),
          type_id = COALESCE(excluded.type_id, committee_session.type_id),
          type_desc = COALESCE(excluded.type_desc, committee_session.type_desc),
          session_url = COALESCE(excluded.session_url, committee_session.session_url),
          start_time = COALESCE(excluded.start_time, committee_session.start_time),
          end_time = COALESCE(excluded.end_time, committee_session.end_time)
      `);

      const insertBatch = db.transaction((rows: any[]) => {
        for (const r of rows) {
          const committeeId =
            r.CommitteeID == null ? null : Number(r.CommitteeID);

          upsert.run(
            Number(r.Id),
            committeeId,
            null,
            r.StartDate ?? null,
            committeeId == null
              ? null
              : committeeNames.get(committeeId) ?? null,
            r.KnessetNum == null ? null : Number(r.KnessetNum),
            r.StatusID == null ? null : Number(r.StatusID),
            r.StatusDesc ?? null,
            r.TypeID == null ? null : Number(r.TypeID),
            r.TypeDesc ?? null,
            r.SessionUrl ?? null,
            r.StartDate ?? null,
            r.FinishDate ?? null,
          );
        }
      });

      insertBatch(newSessions);
    }

    const after = db.prepare(`
      SELECT
        COUNT(*) AS total,
        MAX(id) AS maxId,
        MAX(date) AS latestDate
      FROM committee_session
    `).get() as {
      total: number;
      maxId: number;
      latestDate: string | null;
    };

    console.log("\nAfter:");
    console.log("  rows:", after.total);
    console.log("  max id:", after.maxId);
    console.log("  latest date:", after.latestDate);
    console.log("  added:", after.total - current.total);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error("Committee session sync failed:");
  console.error(err);
  process.exitCode = 1;
});
