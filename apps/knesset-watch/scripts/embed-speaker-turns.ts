/**
 * Batch-embeds session_speaker_turn rows in Turso using Jina AI.
 * Processes ONE batch per invocation, then exits 0.
 * Exit code 42 = nothing left in this shard (wrapper stops).
 *
 * Supports sharding for parallel workers:
 *   --shard 0 --shards 3   (process rows where id % 3 = 0)
 *   --shard 1 --shards 3
 *   --shard 2 --shards 3
 *
 * Run via wrapper: bash scripts/run-embed-speaker-turns.sh [shard] [total-shards]
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@libsql/client';

const JINA_API_KEY = process.env.JINA_API_KEY;
if (!JINA_API_KEY) throw new Error('JINA_API_KEY not set');
if (!process.env.TURSO_URL) throw new Error('TURSO_URL not set');

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN ?? '',
});

const BATCH = 200;

// Parse shard args: --asc (default) or --desc (process from highest id)
const args = process.argv.slice(2);
const direction = args.includes('--desc') ? 'DESC' : 'ASC';

async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch('https://api.jina.ai/v1/embeddings', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${JINA_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'jina-embeddings-v3',
        task: 'retrieval.passage',
        late_chunking: false,
        dimensions: 768,
        input: texts,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('Jina error:', res.status, err.slice(0, 200));
      if (res.status === 429) await new Promise(r => setTimeout(r, 10_000));
      return texts.map(() => null);
    }
    const data = await res.json() as { data: Array<{ embedding: number[] }> };
    return data.data.map(d => d.embedding);
  } catch (e: any) {
    console.error('Jina fetch error:', e.name, e.message?.slice(0, 100));
    return texts.map(() => null);
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const batch = await db.execute(
    `SELECT id, text FROM session_speaker_turn
     WHERE embedding IS NULL AND text IS NOT NULL
     ORDER BY id ${direction} LIMIT ${BATCH}`
  );

  if (batch.rows.length === 0) {
    console.log(`[${direction}] Nothing left.`);
    process.exit(42);
  }

  const ids = batch.rows.map(r => Number(r.id));
  const texts = batch.rows.map(r => String(r.text ?? '').slice(0, 8192));
  const embeddings = await embedBatch(texts);

  let errors = 0;
  const updates = ids
    .map((id, i) => embeddings[i] ? { id, vec: `[${embeddings[i]!.join(',')}]` } : null)
    .filter((x): x is { id: number; vec: string } => x !== null);
  errors = ids.length - updates.length;

  if (updates.length > 0) {
    await db.batch(
      updates.map(({ id, vec }) => ({
        sql: 'UPDATE session_speaker_turn SET embedding = vector32(?) WHERE id = ?',
        args: [vec, id] as (string | number)[],
      })),
      'write',
    );
  }

  console.log(`[${direction}] ${ids.length} embedded (errors: ${errors})`);
}

main().catch(e => { console.error(e); process.exit(1); });
