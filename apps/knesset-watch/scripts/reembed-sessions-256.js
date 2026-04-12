'use strict';
/**
 * Clears and re-embeds all committee_session rows with 256-dim Jina vectors.
 * Replaces the old 768-dim embeddings. Safe to re-run.
 */
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
const { createClient } = require('@libsql/client');

const JINA_API_KEY = process.env.JINA_API_KEY;
if (!JINA_API_KEY) { console.error('JINA_API_KEY not set'); process.exit(1); }
if (!process.env.TURSO_URL) { console.error('TURSO_URL not set'); process.exit(1); }

const DIMS = 256;
const BATCH = 100;

function newDb() {
  return createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN ?? '' });
}

async function jinaEmbed(texts) {
  const res = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${JINA_API_KEY}` },
    body: JSON.stringify({ model: 'jina-embeddings-v3', task: 'retrieval.passage', dimensions: DIMS, input: texts }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Jina error ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.data.map(d => d.embedding);
}

async function main() {
  const db = newDb();

  // Step 1: Clear all existing embeddings
  console.log('Clearing old 768-dim embeddings from committee_session...');
  await db.execute('UPDATE committee_session SET embedding = NULL');
  console.log('Cleared.');

  // Step 2: Fetch all sessions with a rag_card
  const rows = await db.execute(
    'SELECT id, rag_card FROM committee_session WHERE rag_card IS NOT NULL ORDER BY id ASC'
  );
  console.log(`Found ${rows.rows.length} sessions to embed.`);

  let done = 0;
  for (let i = 0; i < rows.rows.length; i += BATCH) {
    const slice = rows.rows.slice(i, i + BATCH);
    const ids = slice.map(r => Number(r.id));
    const texts = slice.map(r => String(r.rag_card ?? '').slice(0, 8192));

    const embeddings = await jinaEmbed(texts);

    await db.batch(
      embeddings.map((emb, j) => ({
        sql: 'UPDATE committee_session SET embedding = vector32(?) WHERE id = ?',
        args: [`[${emb.join(',')}]`, ids[j]],
      })),
      'write',
    );

    done += slice.length;
    console.log(`  ${done} / ${rows.rows.length} embedded`);
  }

  db.close();
  console.log('Done. All committee_session rows re-embedded with 256-dim vectors.');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
