/**
 * Batch-embeds session_speaker_turn rows in Turso using Jina AI.
 * One batch per invocation. Exit 0 = batch done. Exit 42 = all done.
 * --asc (default): lowest IDs first. --desc: highest IDs first.
 */
'use strict';
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
const { createClient } = require('@libsql/client');

const JINA_API_KEY = process.env.JINA_API_KEY;
if (!JINA_API_KEY) { console.error('JINA_API_KEY not set'); process.exit(1); }
if (!process.env.TURSO_URL) { console.error('TURSO_URL not set'); process.exit(1); }

// Create a fresh client for each operation — release connection between Jina call and DB write
// so other processes (reparse) can use the connection slot during the 60s Jina call.
function newDb() {
  return createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN ?? '' });
}

const BATCH = 50;
const direction = process.argv.includes('--desc') ? 'DESC' : 'ASC';

async function embedBatch(texts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch('https://api.jina.ai/v1/embeddings', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${JINA_API_KEY}` },
      body: JSON.stringify({ model: 'jina-embeddings-v3', task: 'retrieval.passage', late_chunking: false, dimensions: 256, input: texts }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('Jina error:', res.status, err.slice(0, 200));
      if (res.status === 429) await new Promise(r => setTimeout(r, 10_000));
      return texts.map(() => null);
    }
    const data = await res.json();
    return data.data.map(d => d.embedding);
  } catch (e) {
    console.error('Jina fetch error:', e.name, e.message?.slice(0, 100));
    return texts.map(() => null);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  // Step 1: fetch batch (open connection, query, close)
  const dbRead = newDb();
  const batch = await dbRead.execute(
    `SELECT id, text FROM session_speaker_turn WHERE embedding IS NULL AND text IS NOT NULL ORDER BY id ${direction} LIMIT ${BATCH}`
  );
  dbRead.close();

  if (batch.rows.length === 0) {
    console.log(`[${direction}] Nothing left.`);
    process.exit(42);
  }

  const ids = batch.rows.map(r => Number(r.id));
  const texts = batch.rows.map(r => String(r.text ?? '').slice(0, 8192));

  // Step 2: call Jina (no Turso connection held during this ~60s wait)
  const embeddings = await embedBatch(texts);

  const updates = ids
    .map((id, i) => embeddings[i] ? { id, vec: `[${embeddings[i].join(',')}]` } : null)
    .filter(Boolean);
  const errors = ids.length - updates.length;

  // Step 3: write results (fresh connection)
  const dbWrite = newDb();
  const SUB = 25;
  for (let k = 0; k < updates.length; k += SUB) {
    const slice = updates.slice(k, k + SUB);
    await dbWrite.batch(
      slice.map(({ id, vec }) => ({
        sql: 'UPDATE session_speaker_turn SET embedding = vector32(?) WHERE id = ?',
        args: [vec, id],
      })),
      'write',
    );
  }
  dbWrite.close();

  console.log(`[${direction}] ${ids.length} embedded (errors: ${errors})`);
}

// Bail out if DB connection is saturated — wrapper will retry in 5s
const GLOBAL_TIMEOUT = setTimeout(() => {
  console.error('Timeout: retrying...');
  process.exit(1);
}, 180_000);
GLOBAL_TIMEOUT.unref();

main()
  .then(() => clearTimeout(GLOBAL_TIMEOUT))
  .catch(e => { console.error(e.message); process.exit(1); });
