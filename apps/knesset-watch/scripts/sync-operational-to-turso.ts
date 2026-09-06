import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import Database from "better-sqlite3";
import { createClient, type InStatement } from "@libsql/client";
import path from "path";

const DB_PATH = path.join(process.cwd(), "knesset.db");
const BATCH_SIZE = 200;
const DRY_RUN = process.argv.includes("--dry-run");
const tableArg = process.argv.find((arg) => arg.startsWith("--table="));
const ONLY_TABLE = tableArg?.split("=", 2)[1] || null;

if (!process.env.TURSO_URL) {
  throw new Error("TURSO_URL not set in .env.local");
}

if (!process.env.TURSO_TOKEN) {
  throw new Error("TURSO_TOKEN not set in .env.local");
}

const local = new Database(DB_PATH, { readonly: true });

const turso = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN,
});

type TableConfig = {
  name: string;
  key: string[];
  exclude?: string[];
};

const tables: TableConfig[] = [
  { name: "bill", key: ["id"], exclude: ["text_content", "local_path"] },
  { name: "bill_political_classification", key: ["bill_id", "issue_id"] },
  { name: "bill_initiator", key: ["bill_id", "mk_id"] },
  { name: "committee", key: ["id"] },
  { name: "committee_attendance", key: ["session_id", "mk_id"] },
  { name: "committee_session", key: ["id"], exclude: ["protocol_text"] },
  { name: "faction_coalition_history", key: ["id"] },
  { name: "gov_ministry", key: ["id"] },
  { name: "mk_id_map", key: ["person_id", "kns_id"] },
  { name: "mk_person", key: ["person_id"] },
  { name: "mk_position", key: ["id"] },
  { name: "mk_query", key: ["id"] },
  { name: "mk_vote_result", key: ["vote_id", "mk_id"] },
  { name: "plenary_vote", key: ["id"] },
  { name: "session_agenda_item", key: ["id"] },
  { name: "session_guest", key: ["id"] },
  { name: "session_staff", key: ["id"] },
  { name: "session_speaker_turn", key: ["id"] },
  { name: "session_bill", key: ["session_id", "bill_id"] },
  { name: "session_committee", key: ["session_id", "committee_id"] },
  {
    name: "session_document",
    key: ["id"],
    exclude: ["local_path"],
  },
  { name: "session_vote", key: ["id"] },
  { name: "vote_faction_stats", key: ["vote_id", "faction_id"] },
];

type LocalColumn = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function localColumns(config: TableConfig): LocalColumn[] {
  const excluded = new Set(config.exclude ?? []);

  return (
    local.prepare(`PRAGMA table_info(${q(config.name)})`).all() as LocalColumn[]
  ).filter((c) => !excluded.has(c.name));
}

function createTableSql(config: TableConfig, cols: LocalColumn[]): string {
  const singleKey = config.key.length === 1 ? config.key[0] : null;

  const definitions = cols.map((col) => {
    if (singleKey === col.name) {
      return `${q(col.name)} INTEGER PRIMARY KEY`;
    }

    const parts = [
      q(col.name),
      col.type || "TEXT",
    ];

    if (config.key.includes(col.name) || col.notnull) {
      parts.push("NOT NULL");
    }

    if (col.dflt_value !== null) {
      parts.push(`DEFAULT ${col.dflt_value}`);
    }

    return parts.join(" ");
  });

  if (config.key.length > 1) {
    definitions.push(
      `PRIMARY KEY (${config.key.map(q).join(", ")})`,
    );
  }

  return `
    CREATE TABLE IF NOT EXISTS ${q(config.name)} (
      ${definitions.join(",\n      ")}
    )
  `;
}

async function remoteTableExists(table: string): Promise<boolean> {
  const r = await turso.execute({
    sql: `
      SELECT 1
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
      LIMIT 1
    `,
    args: [table],
  });

  return r.rows.length > 0;
}

async function remoteColumns(table: string): Promise<Map<string, any>> {
  const r = await turso.execute(`PRAGMA table_info(${q(table)})`);
  return new Map(r.rows.map((row: any) => [String(row.name), row]));
}

async function remoteUniqueKeys(table: string): Promise<string[][]> {
  const result: string[][] = [];

  const info = await turso.execute(`PRAGMA table_info(${q(table)})`);
  const pk = info.rows
    .filter((r: any) => Number(r.pk) > 0)
    .sort((a: any, b: any) => Number(a.pk) - Number(b.pk))
    .map((r: any) => String(r.name));

  if (pk.length) {
    result.push(pk);
  }

  const indexes = await turso.execute(`PRAGMA index_list(${q(table)})`);

  for (const idx of indexes.rows as any[]) {
    if (Number(idx.unique) !== 1) continue;

    const indexName = String(idx.name);
    const indexInfo = await turso.execute(
      `PRAGMA index_info(${q(indexName)})`,
    );

    const columns = indexInfo.rows
      .sort((a: any, b: any) => Number(a.seqno) - Number(b.seqno))
      .map((r: any) => String(r.name));

    if (columns.length) {
      result.push(columns);
    }
  }

  return result;
}

function sameKey(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function validateLocal(config: TableConfig) {
  const keySql = config.key.map(q).join(", ");

  const duplicates = local
    .prepare(`
      SELECT COUNT(*) AS n
      FROM (
        SELECT ${keySql}
        FROM ${q(config.name)}
        GROUP BY ${keySql}
        HAVING COUNT(*) > 1
      )
    `)
    .get() as { n: number };

  const nullCondition = config.key
    .map((k) => `${q(k)} IS NULL`)
    .join(" OR ");

  const nulls = local
    .prepare(`
      SELECT COUNT(*) AS n
      FROM ${q(config.name)}
      WHERE ${nullCondition}
    `)
    .get() as { n: number };

  if (duplicates.n !== 0 || nulls.n !== 0) {
    throw new Error(
      `${config.name}: local integrity failed: ` +
        `duplicates=${duplicates.n}, null_keys=${nulls.n}`,
    );
  }
}

async function ensureSchema(config: TableConfig) {
  const cols = localColumns(config);
  const exists = await remoteTableExists(config.name);

  if (!exists) {
    const sql = createTableSql(config, cols);

    if (DRY_RUN) {
      console.log(`  would CREATE table`);
    } else {
      await turso.execute(sql);
      console.log(`  created table`);
    }

    return;
  }

  const remote = await remoteColumns(config.name);

  for (const col of cols) {
    if (remote.has(col.name)) continue;

    const sql =
      `ALTER TABLE ${q(config.name)} ` +
      `ADD COLUMN ${q(col.name)} ${col.type || "TEXT"}`;

    if (DRY_RUN) {
      console.log(`  would ADD column ${col.name}`);
    } else {
      await turso.execute(sql);
      console.log(`  added column ${col.name}`);
    }
  }

  const uniqueKeys = await remoteUniqueKeys(config.name);

  if (!uniqueKeys.some((k) => sameKey(k, config.key))) {
    throw new Error(
      `${config.name}: Turso does not have UNIQUE/PRIMARY KEY ` +
        `(${config.key.join(", ")})`,
    );
  }
}

function makeUpsert(
  config: TableConfig,
  cols: LocalColumn[],
  row: any,
): InStatement {
  const names = cols.map((c) => c.name);
  const nonKey = names.filter((name) => !config.key.includes(name));

  const insertCols = names.map(q).join(", ");
  const placeholders = names.map(() => "?").join(", ");
  const conflict = config.key.map(q).join(", ");

  const update =
    nonKey.length > 0
      ? `DO UPDATE SET ${nonKey
          .map((name) => `${q(name)} = excluded.${q(name)}`)
          .join(", ")}`
      : "DO NOTHING";

  return {
    sql: `
      INSERT INTO ${q(config.name)} (${insertCols})
      VALUES (${placeholders})
      ON CONFLICT (${conflict}) ${update}
    `,
    args: names.map((name) => row[name]),
  };
}

async function syncTable(config: TableConfig) {
  validateLocal(config);

  const cols = localColumns(config);
  const names = cols.map((c) => q(c.name)).join(", ");

  const rows = local
    .prepare(`SELECT ${names} FROM ${q(config.name)}`)
    .all() as any[];

  console.log(
    `\n${config.name}: ${rows.length.toLocaleString()} local rows`,
  );

  if (DRY_RUN) {
    return;
  }

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows
      .slice(i, i + BATCH_SIZE)
      .map((row) => makeUpsert(config, cols, row));

    await turso.batch(batch, "write");

    const done = Math.min(i + BATCH_SIZE, rows.length);

    if (done % 5000 === 0 || done === rows.length) {
      console.log(
        `  ${done.toLocaleString()} / ${rows.length.toLocaleString()}`,
      );
    }
  }

  const remoteCount = await turso.execute(
    `SELECT COUNT(*) AS n FROM ${q(config.name)}`,
  );

  console.log(
    `  Turso rows after sync: ${Number(remoteCount.rows[0].n).toLocaleString()}`,
  );
}

async function main() {
  console.log(DRY_RUN ? "=== DRY RUN ===" : "=== TURSO SYNC ===");

  const selectedTables = ONLY_TABLE
    ? tables.filter((config) => config.name === ONLY_TABLE)
    : tables;

  if (ONLY_TABLE && selectedTables.length === 0) {
    throw new Error(`Unknown table: ${ONLY_TABLE}`);
  }

  console.log("\nChecking schema...");
  for (const config of selectedTables) {
    console.log(`\n${config.name}`);
    validateLocal(config);
    await ensureSchema(config);
  }

  console.log("\nSyncing data...");
  for (const config of selectedTables) {
    await syncTable(config);
  }

  console.log(
    DRY_RUN
      ? "\nDry run completed — nothing was written to Turso."
      : "\nOperational Turso sync completed successfully.",
  );
}

main()
  .catch((err) => {
    console.error("\nSYNC FAILED:");
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    local.close();
  });
