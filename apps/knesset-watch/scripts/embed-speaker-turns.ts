/**
 * Batch-embeds session_speaker_turn rows in Turso using Jina AI.
 * Processes turns without embeddings, in batches of 50.
 * Checkpointed: safe to kill and resume (skips rows where embedding IS NOT NULL).
 *
 * Run: cd apps/knesset-watch && npx tsx scripts/embed-speaker-turns.ts
 * Monitor: tail -f embed-turns.log
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

const BATCH = 50;
const DELAY_MS = 600;

async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000); // 30s timeout
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
  const countRes = await db.execute(
    'SELECT COUNT(*) as n FROM session_speaker_turn WHERE embedding IS NULL AND text IS NOT NULL'
  );
  const total = Number(countRes.rows[0]?.n ?? 0);
  console.log(`Total unembedded turns: ${total.toLocaleString()}`);
  if (total === 0) { console.log('Nothing to do.'); return; }

  let processed = 0;
  let errors = 0;

  while (true) {
    const batch = await db.execute(
      `SELECT id, text FROM session_speaker_turn
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
        sql: 'UPDATE session_speaker_turn SET embedding = vector32(?) WHERE id = ?',
        args: [vec, ids[i]],
      });
    }

    processed += ids.length;
    if (processed % 500 === 0 || processed <= BATCH) {
      const pct = ((processed / total) * 100).toFixed(1);
      console.log(`[${pct}%] ${processed.toLocaleString()} / ${total.toLocaleString()} done (errors: ${errors})`);
    }

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`Complete. Processed: ${processed.toLocaleString()}, Errors: ${errors}`);
}

main().catch(e => { console.error(e); process.exit(1); });
