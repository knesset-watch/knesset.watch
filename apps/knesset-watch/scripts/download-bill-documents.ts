// scripts/download-bill-documents.ts
// Run:
//   npx tsx scripts/download-bill-documents.ts
//
// Downloads bill documents from bill.doc_url,
// extracts text from PDF / DOC / DOCX,
// and stores local_path + text_content back in bill.
//
// Resume-safe:
// skips bills where local_path IS NOT NULL.

import Database from "better-sqlite3";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "knesset.db");
const DOCS_DIR = path.join(process.cwd(), "bill-documents");

const CONCURRENCY = 5;
const BATCH_DELAY_MS = 400;

const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));

const LIMIT = limitArg
  ? Number(limitArg.split("=")[1])
  : null;

// ── HTTP ─────────────────────────────────────────────────────────────────────

async function downloadBuffer(url: string): Promise<Buffer> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "*/*",
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt === 3) {
        throw err;
      }

      const delay = attempt * 2000;

      console.warn(`Download failed. Retrying in ${delay / 1000}s...`);

      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error("unreachable");
}

// ── File format detection ─────────────────────────────────────────────────────

function getExtension(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).replace(".", "").toLowerCase();

    if (ext) {
      return ext;
    }
  } catch {
    // fallback below
  }

  return "bin";
}

// ── Text extraction ───────────────────────────────────────────────────────────

async function extractText(buf: Buffer, ext: string): Promise<string | null> {
  const format = ext.toLowerCase();

  if (format === "doc" || format === "docx") {
    try {
      const result = await mammoth.extractRawText({
        buffer: buf,
      });

      return result.value.trim() || null;
    } catch (err) {
      console.warn("DOC/DOCX text extraction failed.");
      return null;
    }
  }

  if (format === "pdf") {
    try {
      const parser = new PDFParse({ data: buf });
      const result = await parser.getText();

      return result.text.trim() || null;
    } catch (err) {
      console.warn("PDF text extraction failed.");
      return null;
    }
  }

  return null;
}

// ── DB migration ──────────────────────────────────────────────────────────────

function migrate(db: Database.Database) {
  const cols = (db.prepare("PRAGMA table_info(bill)").all() as any[]).map(
    (c: any) => c.name,
  );

  if (!cols.includes("local_path")) {
    db.exec("ALTER TABLE bill ADD COLUMN local_path TEXT");

    console.log("  Added local_path to bill.");
  }

  if (!cols.includes("text_content")) {
    db.exec("ALTER TABLE bill ADD COLUMN text_content TEXT");

    console.log("  Added text_content to bill.");
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const db = new Database(DB_PATH);

  db.pragma("journal_mode = WAL");

  console.log("Download Bill Documents");
  console.log("  Migrations...");

  migrate(db);

  fs.mkdirSync(DOCS_DIR, {
    recursive: true,
  });

  let bills = db
  .prepare(
    `
    SELECT
      id,
      MAX(title) AS title,
      MAX(doc_url) AS doc_url
    FROM bill
    WHERE doc_url IS NOT NULL
      AND TRIM(doc_url) != ''
      AND (
        text_content IS NULL
        OR TRIM(text_content) = ''
      )
    GROUP BY id
    ORDER BY id ASC
  `,
  )
  .all() as {
  id: number;
  title: string;
  doc_url: string;
}[];

if (LIMIT !== null) {
  bills = bills.slice(0, LIMIT);
}

  if (bills.length === 0) {
    console.log("  No bill documents left to download.");

    db.close();

    return;
  }

  console.log(`  Bill documents to download: ${bills.length.toLocaleString()}`);

  const update = db.prepare(`
    UPDATE bill
    SET
      local_path = ?,
      text_content = ?
    WHERE id = ?
  `);

  let done = 0;
  let errors = 0;
  let withText = 0;

  for (let i = 0; i < bills.length; i += CONCURRENCY) {
    const batch = bills.slice(i, i + CONCURRENCY);

    await Promise.allSettled(
      batch.map(async (bill) => {
        const ext = getExtension(bill.doc_url);

        const localPath = path.join(DOCS_DIR, `${bill.id}.${ext}`);

        const relPath = path.relative(process.cwd(), localPath);

        try {
          let buf: Buffer;

          if (fs.existsSync(localPath)) {
            buf = fs.readFileSync(localPath);
          } else {
            buf = await downloadBuffer(bill.doc_url);
            fs.writeFileSync(localPath, buf);
          }

          const text = await extractText(buf, ext);

          update.run(relPath, text, bill.id);

          if (text) {
            withText++;
          }

          done++;
        } catch (err: any) {
          console.warn(`Failed bill ${bill.id}: ${err.message}`);

          update.run(relPath + ".failed", null, bill.id);

          errors++;
        }
      }),
    );

    const total = done + errors;

    if (total % 100 === 0 || total === bills.length) {
      const pct = Math.round((total / bills.length) * 100);

      process.stdout.write(
        `\r  ${total}/${bills.length} (${pct}%) — ` +
          `${withText} with text, ${errors} errors`,
      );
    }

    if (i + CONCURRENCY < bills.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  console.log("\n");

  const stat = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total,
        SUM(
          CASE
            WHEN doc_url IS NOT NULL
             AND doc_url != ''
            THEN 1
            ELSE 0
          END
        ) AS with_url,
        SUM(
          CASE
            WHEN local_path IS NOT NULL
            THEN 1
            ELSE 0
          END
        ) AS downloaded,
        SUM(
          CASE
            WHEN text_content IS NOT NULL
             AND text_content != ''
            THEN 1
            ELSE 0
          END
        ) AS with_text
      FROM bill
    `,
    )
    .get() as {
    total: number;
    with_url: number;
    downloaded: number;
    with_text: number;
  };

  console.log("Results:");

  console.log(`  Bills total : ${stat.total.toLocaleString()}`);

  console.log(`  With URL    : ${stat.with_url.toLocaleString()}`);

  console.log(`  Downloaded  : ${stat.downloaded.toLocaleString()}`);

  console.log(`  With text   : ${stat.with_text.toLocaleString()}`);

  console.log(`  Errors      : ${errors.toLocaleString()}`);

  db.close();

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Failed:", err.message);

  process.exit(1);
});
