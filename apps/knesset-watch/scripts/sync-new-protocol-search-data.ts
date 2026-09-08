import "dotenv/config";
import { createClient } from "@libsql/client";

const tursoUrl = process.env.TURSO_URL;
const tursoToken = process.env.TURSO_TOKEN;
const localDbPath = process.env.LOCAL_DB_PATH ?? "knesset.db";

const isDryRun = process.argv.includes("--dry-run");

async function main() {
  if (!tursoUrl || !tursoToken) {
    throw new Error("Missing TURSO_URL or TURSO_TOKEN");
  }

  const turso = createClient({
    url: tursoUrl,
    authToken: tursoToken,
  });

  const local = createClient({
    url: `file:${localDbPath}`,
  });

  console.log("Checking Turso for sessions missing rag_card...");

  const missingResult = await turso.execute(`
    SELECT id
    FROM committee_session
    WHERE rag_card IS NULL
  `);

  const missingIds = missingResult.rows
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id));

  console.log(`Missing rag_card in Turso: ${missingIds.length}`);

  if (missingIds.length === 0) {
    console.log("Nothing to sync.");
    return;
  }

  const localResult = await local.execute(`
    SELECT id, rag_card
    FROM committee_session
    WHERE rag_card IS NOT NULL
      AND TRIM(rag_card) <> ''
  `);

  const localCards = new Map<number, string>();

  for (const row of localResult.rows) {
    const id = Number(row.id);
    const ragCard = row.rag_card;

    if (
      Number.isFinite(id) &&
      typeof ragCard === "string" &&
      ragCard.trim().length > 0
    ) {
      localCards.set(id, ragCard);
    }
  }

  const rowsToSync = missingIds
    .map((id) => {
      const ragCard = localCards.get(id);

      if (!ragCard) {
        return null;
      }

      return {
        id,
        ragCard,
      };
    })
    .filter(
      (
        row,
      ): row is {
        id: number;
        ragCard: string;
      } => row !== null,
    );

  const missingLocally = missingIds.length - rowsToSync.length;

  console.log(`Found locally: ${rowsToSync.length}`);
  console.log(`Missing locally: ${missingLocally}`);

  if (isDryRun) {
    console.log("Dry run only. No Turso updates were made.");
    return;
  }

  let updated = 0;

  for (const row of rowsToSync) {
    const result = await turso.execute({
      sql: `
        UPDATE committee_session
        SET rag_card = ?
        WHERE id = ?
          AND rag_card IS NULL
      `,
      args: [row.ragCard, row.id],
    });

    updated += result.rowsAffected;
  }

  console.log(`Updated rag_card in Turso: ${updated}`);

  const remainingResult = await turso.execute(`
    SELECT COUNT(*) AS count
    FROM committee_session
    WHERE rag_card IS NULL
  `);

  const remaining = Number(remainingResult.rows[0]?.count ?? 0);

  console.log(`Still missing rag_card in Turso: ${remaining}`);
  console.log("Done.");
  console.log("Next step: npm run db:embed-sessions");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
