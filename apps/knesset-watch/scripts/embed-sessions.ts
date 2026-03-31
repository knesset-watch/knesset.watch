// scripts/embed-sessions.ts
// Run: npm run db:embed-sessions
//
// Embeds all committee_session rag_cards using Jina AI jina-embeddings-v3
// (768 dims, free tier covers all 9,611 sessions easily).
// Stores the vector in Turso's embedding column.
//
// Requires in .env.local:
//   TURSO_URL, TURSO_TOKEN, JINA_API_KEY
//
// Resume-safe: skips sessions where embedding IS NOT NULL in Turso.
// Pass --force to re-embed everything.

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@libsql/client';

const DIMS = 768;
const BATCH_EMBED = 100; // Jina supports batching

async function jinaEmbed(texts: string[]): Promise<number[][]> {
  const res = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.JINA_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'jina-embeddings-v3',
      input: texts,
      dimensions: DIMS,
      truncate: true,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Jina API error ${res.status}: ${err}`);
  }

  const data = await res.json() as { data: Array<{ embedding: number[] }> };
  return data.data.map(d => d.embedding);
}

async function main() {
  if (!process.env.TURSO_URL) throw new Error('TURSO_URL not set');
  if (!process.env.JINA_API_KEY) throw new Error('JINA_API_KEY not set');

  const force = process.argv.includes('--force');

  const client = createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_TOKEN,
  });

  // Ensure vector column exists
  try {
    await client.execute(`ALTER TABLE committee_session ADD COLUMN embedding F32_BLOB(${DIMS})`);
    console.log(`  Added embedding column (F32_BLOB(${DIMS})).`);
  } catch {
    // Column already exists — fine
  }

  if (force) {
    await client.execute('UPDATE committee_session SET embedding = NULL');
    console.log('  --force: cleared all embeddings.');
  }

  const result = await client.execute(
    'SELECT id, rag_card FROM committee_session WHERE rag_card IS NOT NULL AND embedding IS NULL ORDER BY id'
  );
  const sessions = result.rows as Array<{ id: number | bigint; rag_card: string }>;

  if (sessions.length === 0) {
    console.log('All sessions already embedded.');
    return;
  }

  console.log(`Embedding ${sessions.length.toLocaleString()} sessions with Jina AI...`);
  let done = 0;

  for (let i = 0; i < sessions.length; i += BATCH_EMBED) {
    const batch = sessions.slice(i, i + BATCH_EMBED);
    const texts = batch.map(s => s.rag_card);

    const vectors = await jinaEmbed(texts);

    const updates = batch.map((s, idx) => {
      const vec = vectors[idx];
      const buf = Buffer.allocUnsafe(vec.length * 4);
      for (let j = 0; j < vec.length; j++) buf.writeFloatLE(vec[j], j * 4);

      return client.execute({
        sql: 'UPDATE committee_session SET embedding = ? WHERE id = ?',
        args: [buf, s.id],
      });
    });

    await Promise.all(updates);
    done += batch.length;

    const pct = Math.round((done / sessions.length) * 100);
    process.stdout.write(`\r  ${done.toLocaleString()} / ${sessions.length.toLocaleString()} (${pct}%)`);

    // Jina free tier: 100K tokens/minute. ~280 tokens/session avg × 100 sessions = 28K/batch.
    // 20-second delay keeps us at ~3 batches/min = ~84K tokens/min (under limit).
    if (i + BATCH_EMBED < sessions.length) await new Promise(r => setTimeout(r, 20_000));
  }

  console.log(`\n\nDone. ${done.toLocaleString()} embeddings stored in Turso.`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
