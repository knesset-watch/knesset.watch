// scripts/download-documents.ts
// Run: npm run db:download-documents
//
// Downloads all non-protocol documents from session_document table.
// Extracts text from DOC/DOCX (mammoth) and PDF (pdf-parse).
// PPT/XLS/PIC: saves file only, no text extraction.
// Resume-safe: skips rows where local_path IS NOT NULL.

import Database from 'better-sqlite3';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const DOCS_DIR = path.join(process.cwd(), 'documents');
const CONCURRENCY = 5;
const BATCH_DELAY_MS = 200;

// ── HTTP ──────────────────────────────────────────────────────────────────────

async function downloadBuffer(url: string): Promise<Buffer> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  throw new Error('unreachable');
}

// ── Text extraction ───────────────────────────────────────────────────────────

async function extractText(buf: Buffer, fmt: string): Promise<string | null> {
  const f = fmt.toUpperCase();
  if (f === 'DOC' || f === 'DOCX') {
    try {
      const result = await mammoth.extractRawText({ buffer: buf });
      return result.value.trim() || null;
    } catch { return null; }
  }
  if (f === 'PDF') {
    try {
      const result = await pdfParse(buf);
      return result.text.trim() || null;
    } catch { return null; }
  }
  return null; // PPT, XLS, PIC — save file only
}

// ── Migrations ────────────────────────────────────────────────────────────────

function migrate(db: Database.Database) {
  const cols = (db.prepare('PRAGMA table_info(session_document)').all() as any[]).map((c: any) => c.name);
  if (!cols.includes('local_path')) {
    db.exec('ALTER TABLE session_document ADD COLUMN local_path TEXT');
    console.log('  Added local_path to session_document.');
  }
  if (!cols.includes('text_content')) {
    db.exec('ALTER TABLE session_document ADD COLUMN text_content TEXT');
    console.log('  Added text_content to session_document.');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  console.log('Download Documents');
  console.log('  Migrations...');
  migrate(db);

  // Create directory structure per group type
  fs.mkdirSync(DOCS_DIR, { recursive: true });

  // All docs except protocols (type 23 — already downloaded as protocols/)
  const docs = db.prepare(`
    SELECT id, session_id, group_type_id, group_type_desc, file_path, application_desc
    FROM session_document
    WHERE local_path IS NULL
      AND file_path IS NOT NULL AND file_path != ''
      AND group_type_id != 23
    ORDER BY group_type_id ASC, id ASC
  `).all() as {
    id: number; session_id: number; group_type_id: number; group_type_desc: string;
    file_path: string; application_desc: string;
  }[];

  if (docs.length === 0) {
    console.log('  All documents already downloaded.');
    db.close();
    return;
  }

  console.log(`  Documents to download: ${docs.length.toLocaleString()}`);

  // Show breakdown
  const byType = new Map<string, number>();
  for (const d of docs) {
    const key = `${d.group_type_id}: ${d.group_type_desc}`;
    byType.set(key, (byType.get(key) ?? 0) + 1);
  }
  [...byType.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`    ${v.toLocaleString()}x ${k}`);
  });
  console.log('');

  const update = db.prepare(`
    UPDATE session_document SET local_path = ?, text_content = ? WHERE id = ?
  `);

  let done = 0;
  let errors = 0;
  let withText = 0;

  for (let i = 0; i < docs.length; i += CONCURRENCY) {
    const batch = docs.slice(i, i + CONCURRENCY);

    await Promise.allSettled(batch.map(async (doc) => {
      // Determine file extension
      const urlExt = doc.file_path.split('.').pop()?.toLowerCase() ?? '';
      const fmtExt = doc.application_desc?.toLowerCase() ?? 'bin';
      const ext = urlExt.length <= 4 && urlExt.length > 0 ? urlExt : fmtExt;

      const dir = path.join(DOCS_DIR, String(doc.group_type_id));
      fs.mkdirSync(dir, { recursive: true });
      const localPath = path.join(dir, `${doc.id}.${ext}`);
      const relPath = path.relative(process.cwd(), localPath);

      try {
        const buf = await downloadBuffer(doc.file_path);
        fs.writeFileSync(localPath, buf);
        const text = await extractText(buf, doc.application_desc ?? '');
        update.run(relPath, text, doc.id);
        if (text) withText++;
        done++;
      } catch {
        // Mark as attempted so we don't retry forever on broken URLs
        update.run(relPath + '.failed', null, doc.id);
        errors++;
      }
    }));

    const total = done + errors;
    if (total % 500 === 0 || total === docs.length) {
      const pct = Math.round((total / docs.length) * 100);
      process.stdout.write(`\r    ${total}/${docs.length} (${pct}%) — ${withText} with text, ${errors} errors`);
    }

    if (i + CONCURRENCY < docs.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  console.log('\n');

  // Final stats
  const stat = db.prepare(`
    SELECT
      COUNT(*) as total,
      COUNT(local_path) as downloaded,
      COUNT(text_content) as with_text
    FROM session_document WHERE group_type_id != 23
  `).get() as any;

  console.log('Results:');
  console.log(`  Downloaded : ${stat.downloaded.toLocaleString()} / ${stat.total.toLocaleString()}`);
  console.log(`  With text  : ${stat.with_text.toLocaleString()}`);
  console.log(`  Errors     : ${errors}`);

  db.close();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
