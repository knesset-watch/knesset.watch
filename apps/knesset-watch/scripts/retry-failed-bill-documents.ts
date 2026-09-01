// scripts/retry-failed-bill-documents.ts
//
// Run:
//   npx tsx scripts/retry-failed-bill-documents.ts
//
// Retries only bill documents that previously failed.
// Looks for:
//   local_path LIKE '%.failed'
//
// If retry succeeds:
//   - saves the file
//   - extracts text
//   - updates local_path
//   - updates text_content
//
// If retry fails again:
//   - leaves the row as failed

import Database from "better-sqlite3";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "knesset.db");
const DOCS_DIR = path.join(process.cwd(), "bill-documents");

const DELAY_MS = 1500;

// ── HTTP ─────────────────────────────────────────────────────────────────────

async function downloadBuffer(url: string): Promise<Buffer> {
  for (let attempt = 1; attempt <= 5; attempt++) {
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
      if (attempt === 5) {
        throw err;
      }

      const delay = attempt * 3000;

      console.log(`    Retry ${attempt}/5 failed. Waiting ${delay / 1000}s...`);

      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error("unreachable");
}

// ── Extension ────────────────────────────────────────────────────────────────

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

// ── Text extraction ─────────────────────────────────────────────────────────

async function extractText(buf: Buffer, ext: string): Promise<string | null> {
  const format = ext.toLowerCase();

  if (format === "doc" || format === "docx") {
    try {
      const result = await mammoth.extractRawText({
        buffer: buf,
      });

      return result.value.trim() || null;
    } catch {
      return null;
    }
  }

  if (format === "pdf") {
    try {
      const parser = new PDFParse({
        data: buf,
      });

      const result = await parser.getText();

      return result.text.trim() || null;
    } catch {
      return null;
    }
  }

  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const db = new Database(DB_PATH);

  db.pragma("journal_mode = WAL");

  fs.mkdirSync(DOCS_DIR, {
    recursive: true,
  });

  const failedBills = db
    .prepare(
      `
      SELECT
        id,
        title,
        doc_url,
        local_path
      FROM bill
      WHERE local_path LIKE '%.failed'
        AND doc_url IS NOT NULL
        AND doc_url != ''
      ORDER BY id
    `,
    )
    .all() as {
    id: number;
    title: string;
    doc_url: string;
    local_path: string;
  }[];

  console.log("Retry Failed Bill Documents");
  console.log(`Failed bills to retry: ${failedBills.length}`);

  if (failedBills.length === 0) {
    console.log("Nothing to retry.");
    db.close();
    return;
  }

  const updateSuccess = db.prepare(`
    UPDATE bill
    SET
      local_path = ?,
      text_content = ?
    WHERE id = ?
  `);

  let success = 0;
  let stillFailed = 0;
  let withText = 0;

  for (const bill of failedBills) {
    console.log("");
    console.log(`Bill ${bill.id}: ${bill.title}`);

    try {
      const ext = getExtension(bill.doc_url);

      const localPath = path.join(DOCS_DIR, `${bill.id}.${ext}`);

      const relPath = path.relative(process.cwd(), localPath);

      const buf = await downloadBuffer(bill.doc_url);

      fs.writeFileSync(localPath, buf);

      const text = await extractText(buf, ext);

      updateSuccess.run(relPath, text, bill.id);

      success++;

      if (text) {
        withText++;
      }

      console.log(`  Success${text ? " + text extracted" : ""}`);
    } catch (err: any) {
      stillFailed++;

      console.log(`  Still failed: ${err.message}`);
    }

    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  console.log("");
  console.log("Results:");
  console.log(`  Retried     : ${failedBills.length}`);
  console.log(`  Success     : ${success}`);
  console.log(`  With text   : ${withText}`);
  console.log(`  Still failed: ${stillFailed}`);

  db.close();

  console.log("");
  console.log("Done.");
}

main().catch((err) => {
  console.error("Failed:", err.message);

  process.exit(1);
});
