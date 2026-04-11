'use strict';
/**
 * Migrates session_speaker_turn.embedding from 768-dim to 256-dim:
 * 1. Show existing vector indexes
 * 2. Drop old vector index
 * 3. Clear all embeddings (SET embedding = NULL)
 * 4. Recreate vector index for 256-dim
 */
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
const { createClient } = require('@libsql/client');

function newDb() {
  return createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN ?? '' });
}

async function main() {
  const db = newDb();

  // Show all indexes on session_speaker_turn
  console.log('Fetching indexes...');
  const indexes = await db.execute(
    "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='session_speaker_turn'"
  );
  console.log('Indexes on session_speaker_turn:');
  for (const row of indexes.rows) {
    console.log(' ', row.name, '|', row.sql);
  }

  // Find the vector index name
  const vectorIdx = indexes.rows.find(r => String(r.sql ?? '').includes('libsql_vector_idx'));
  if (!vectorIdx) {
    console.log('No vector index found. Checking for index named with "embedding"...');
    const embIdx = indexes.rows.find(r => String(r.name ?? '').includes('embedding'));
    console.log('Embedding index:', embIdx);
  }

  if (vectorIdx) {
    console.log(`\nDropping vector index: ${vectorIdx.name}`);
    await db.execute(`DROP INDEX IF EXISTS "${vectorIdx.name}"`);
    console.log('Dropped.');
  } else {
    // Try common names
    for (const name of ['session_speaker_turn_embedding_idx', 'idx_session_speaker_turn_embedding', 'embedding_idx']) {
      try {
        await db.execute(`DROP INDEX IF EXISTS "${name}"`);
        console.log(`Dropped (tried ${name})`);
      } catch (e) {
        // ignore
      }
    }
  }

  // Clear all embeddings
  console.log('\nClearing all embeddings...');
  await db.execute('UPDATE session_speaker_turn SET embedding = NULL');
  console.log('Cleared.');

  // Recreate vector index for 256-dim
  console.log('\nRecreating vector index (256-dim cosine)...');
  await db.execute(
    "CREATE INDEX IF NOT EXISTS session_speaker_turn_embedding_idx ON session_speaker_turn (libsql_vector_idx(embedding, 'type=float32', 'metric=cosine', 'dims=256'))"
  );
  console.log('Index created.');

  // Verify
  const count = await db.execute("SELECT COUNT(*) as n FROM session_speaker_turn WHERE embedding IS NOT NULL");
  console.log('Rows with embedding after clear:', Number(count.rows[0]?.n));

  db.close();
  console.log('Migration complete.');
}

main().catch(e => { console.error(e.message); process.exit(1); });
