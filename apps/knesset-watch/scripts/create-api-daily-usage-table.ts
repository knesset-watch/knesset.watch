import "dotenv/config";
import { createClient } from "@libsql/client";

async function main() {
  const url = process.env.TURSO_URL;
  const authToken = process.env.TURSO_TOKEN;

  if (!url || !authToken) {
    throw new Error("Missing TURSO_URL or TURSO_TOKEN");
  }

  const client = createClient({
    url,
    authToken,
  });

  await client.execute(`
    CREATE TABLE IF NOT EXISTS api_daily_usage (
      usage_date TEXT NOT NULL,
      client_ip TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (usage_date, client_ip)
    )
  `);

  console.log("api_daily_usage table is ready");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
