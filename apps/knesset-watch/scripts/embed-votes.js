#!/usr/bin/env node
/**
 * Embeds plenary_vote titles into Turso for semantic vote search.
 * Creates vote_embedding table + vector index on first run.
 * Resume-safe: skips votes that already have an embedding.
 *
 * Run: node scripts/embed-votes.js
 */

require('dotenv').config({ path: '.env.local' });
const Database = require('better-sqlite3');
const { createClient } = require('@libsql/client/http');
const path = require('path');

const JINA_API_KEY = process.env.JINA_API_KEY;
const TURSO_URL = process.env.TURSO_URL;
const TURSO_TOKEN = process.env.TURSO_TOKEN;
const DB_PATH = path.join(process.cwd(), 'knesset.db');
const BATCH = 200;
const DIMS = 256;

if (!JINA_API_KEY) { console.error('JINA_API_KEY not set'); process.exit(1); }
if (!TURSO_URL)    { console.error('TURSO_URL not set');    process.exit(1); }

const sqlite = new Database(DB_PATH);
const turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN ?? '' });

async function setup() {
  // Create table if not exists
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS vote_embedding (
      vote_id   INTEGER PRIMARY KEY,
      title     TEXT    NOT NULL,
      date      TEXT,
      embedding F32_BLOB(${DIMS})
    )
  `);
  // Vector index — only needed once; silently fails if already exists
  try {
    await turso.execute(
      `CREATE INDEX IF NOT EXISTS idx_vote_embedding ON vote_embedding (libsql_vector_idx(embedding))`
    );
  } catch { /* index may already exist */ }
  console.log('Table and index ready.');
}

async function embedBatch(texts) {
  const res = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${JINA_API_KEY}` },
    body: JSON.stringify({
      model: 'jina-embeddings-v3',
      task: 'retrieval.passage',
      dimensions: DIMS,
      input: texts,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    if (res.status === 429) { await new Promise(r => setTimeout(r, 10000)); return null; }
    console.error('Jina error:', res.status, err.slice(0, 200));
    return null;
  }
  const data = await res.json();
  return data.data.map(d => d.embedding);
}

async function main() {
  await setup();

  // Get all votes from SQLite that don't yet have embeddings in Turso
  const allVotes = sqlite.prepare(
    `SELECT id, title, date FROM plenary_vote ORDER BY id ASC`
  ).all();

  // Check which vote_ids already embedded
  const existingRes = await turso.execute('SELECT vote_id FROM vote_embedding');
  const existing = new Set(existingRes.rows.map(r => Number(r.vote_id)));

  const pending = allVotes.filter(v => !existing.has(v.id));
  console.log(`Total votes: ${allVotes.length} | Already embedded: ${existing.size} | Pending: ${pending.length}`);
  if (pending.length === 0) { console.log('All done!'); return; }

  let done = 0;
  let errors = 0;

  for (let i = 0; i < pending.length; i += BATCH) {
    const chunk = pending.slice(i, i + BATCH);
    const texts = chunk.map(v => v.title || '');

    let embeddings = await embedBatch(texts);
    if (!embeddings) {
      // Retry once after rate limit delay
      embeddings = await embedBatch(texts);
      if (!embeddings) { errors += chunk.length; continue; }
    }

    // Batch insert into Turso
    const stmts = chunk
      .map((v, j) => {
        const emb = embeddings[j];
        if (!emb) return null;
        const vec = `[${emb.join(',')}]`;
        return {
          sql: `INSERT OR REPLACE INTO vote_embedding (vote_id, title, date, embedding) VALUES (?, ?, ?, vector32(?))`,
          args: [v.id, v.title || '', v.date || '', vec],
        };
      })
      .filter(Boolean);

    try {
      await turso.batch(stmts);
      done += chunk.length;
    } catch (e) {
      console.error('Batch insert error:', e.message);
      errors += chunk.length;
    }

    if ((i / BATCH + 1) % 5 === 0 || i + BATCH >= pending.length) {
      const pct = Math.round((done + errors) / pending.length * 100);
      process.stdout.write(`\r  ${done + errors}/${pending.length} (${pct}%) — ${errors} errors`);
    }

    await new Promise(r => setTimeout(r, 150)); // be gentle with APIs
  }

  console.log(`\nDone. ${done} embedded, ${errors} errors.`);
}

main().catch(e => { console.error(e); process.exit(1); });
