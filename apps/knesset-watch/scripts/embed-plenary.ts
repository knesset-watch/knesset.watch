/**
 * Batch-embeds plenary_speaker_turn rows in Turso using Jina AI.
 * Processes turns without embeddings, in batches of 50.
 * Checkpointed: safe to kill and resume (skips rows where embedding IS NOT NULL).
 *
 * NOTE: ~266 plenary turns as of April 2026. Should complete in under an hour.
 * If the table grows to cover all ~385 plenary sessions it could take several hours.
 *
 * Run: cd apps/knesset-watch && npx tsx scripts/embed-plenary.ts
 *
 * After the first batch completes, the vector index will be created automatically.
 * If it fails (Turso diskann needs at least one row), run manually:
 *   CREATE INDEX idx_plenary_turn_embedding ON plenary_speaker_turn(libsql_vector_idx(embedding))
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@libsql/client';

const JINA_API_KEY = process.env.JINA_API_KEY;
if (!JINA_API_KEY) throw new Error('JINA_API_KEY not set');
if (!process.env.TURSO_URL) throw new Error('TURSO_URL not set');

const db = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN ?? '',
});

const BATCH = 50;
const DELAY_MS = 500;

async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  const res = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
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
    // On rate limit, wait longer
    if (res.status === 429) await new Promise(r => setTimeout(r, 5000));
    return texts.map(() => null);
  }
  const data = await res.json() as { data: Array<{ embedding: number[] }> };
  return data.data.map(d => d.embedding);
}

async function ensureVectorIndex() {
  try {
    await db.execute(
      'CREATE INDEX IF NOT EXISTS idx_plenary_turn_embedding ON plenary_speaker_turn(libsql_vector_idx(embedding))'
    );
    console.log('Vector index created: idx_plenary_turn_embedding');
  } catch (e) {
    console.warn('Vector index not created (will retry after more rows are embedded):', (e as Error).message);
  }
}

async function main() {
  // Ensure embedding column exists (idempotent)
  try {
    await db.execute(`ALTER TABLE plenary_speaker_turn ADD COLUMN embedding F32_BLOB(768)`);
    console.log('Added embedding column (F32_BLOB(768)).');
  } catch {
    // Column already exists — fine
  }

  const countRes = await db.execute(
    'SELECT COUNT(*) as n FROM plenary_speaker_turn WHERE embedding IS NULL AND text IS NOT NULL'
  );
  const total = Number(countRes.rows[0]?.n ?? 0);
  console.log(`Total unembedded plenary turns: ${total.toLocaleString()}`);
  if (total === 0) { console.log('Nothing to do.'); return; }

  let processed = 0;
  let errors = 0;
  let indexCreated = false;

  while (true) {
    const batch = await db.execute(
      `SELECT id, text FROM plenary_speaker_turn
       WHERE embedding IS NULL AND text IS NOT NULL
       ORDER BY id ASC LIMIT ${BATCH}`
    );
    if (batch.rows.length === 0) break;

    const ids = batch.rows.map(r => Number(r.id));
    const texts = batch.rows.map(r => String(r.text ?? '').slice(0, 8192));
    const embeddings = await embedBatch(texts);

    for (let i = 0; i < ids.length; i++) {
      const emb = embeddings[i];
      if (!emb) { errors++; continue; }
      const vec = `[${emb.join(',')}]`;
      await db.execute({
        sql: 'UPDATE plenary_speaker_turn SET embedding = vector32(?) WHERE id = ?',
        args: [vec, ids[i]],
      });
    }

    processed += ids.length;

    // Try to create vector index after first successful batch
    if (!indexCreated && processed >= BATCH) {
      await ensureVectorIndex();
      indexCreated = true;
    }

    if (processed % 500 === 0 || processed <= BATCH) {
      const pct = ((processed / total) * 100).toFixed(1);
      console.log(`[${pct}%] ${processed.toLocaleString()} / ${total.toLocaleString()} done (errors: ${errors})`);
    }

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  // Final attempt at vector index if not yet created
  if (!indexCreated) {
    await ensureVectorIndex();
  }

  console.log(`Complete. Processed: ${processed.toLocaleString()}, Errors: ${errors}`);
}

main().catch(e => { console.error(e); process.exit(1); });
