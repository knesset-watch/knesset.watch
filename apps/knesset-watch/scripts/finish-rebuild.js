'use strict';
/**
 * Finishes the table rebuild:
 * 1. Rebuilds plenary_speaker_turn (F32_BLOB(768) -> F32_BLOB(256))
 * 2. Creates vector indexes on both tables
 */
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

const TURSO_URL = process.env.TURSO_URL?.replace('libsql://', 'https://');
const TURSO_TOKEN = process.env.TURSO_TOKEN;

async function sql(...stmts) {
  const res = await fetch(TURSO_URL + '/v2/pipeline', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + TURSO_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [...stmts.map(s =>
        typeof s === 'string'
          ? { type: 'execute', stmt: { sql: s } }
          : { type: 'execute', stmt: s }
      ), { type: 'close' }]
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const j = await res.json();
  for (const r of j.results) {
    if (r?.type === 'error') throw new Error(r.error?.message);
  }
  return j.results;
}

async function sqlVal(stmt) {
  const r = await sql(stmt);
  return r[0]?.response?.result?.rows?.[0]?.[0]?.value;
}

async function main() {
  // === Step 1: Rebuild plenary_speaker_turn ===
  console.log('=== Rebuilding plenary_speaker_turn ===');

  await sql('DROP TABLE IF EXISTS plenary_speaker_turn_new');
  await sql(`CREATE TABLE plenary_speaker_turn_new (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   INTEGER NOT NULL,
    speaker_name TEXT,
    role         TEXT,
    mk_id        INTEGER,
    text         TEXT,
    turn_index   INTEGER,
    embedding    F32_BLOB(256),
    topic        TEXT,
    faction      TEXT,
    speaker_type TEXT
  )`);
  console.log('New plenary table created.');

  const minId = Number(await sqlVal('SELECT MIN(id) FROM plenary_speaker_turn'));
  const maxId = Number(await sqlVal('SELECT MAX(id) FROM plenary_speaker_turn'));
  console.log(`ID range: ${minId} - ${maxId}`);

  const BATCH = 10000;
  let copied = 0;
  const totalBatches = Math.ceil((maxId - minId + 1) / BATCH);
  for (let start = minId; start <= maxId; start += BATCH) {
    const end = start + BATCH - 1;
    const r = await sql(`INSERT INTO plenary_speaker_turn_new SELECT * FROM plenary_speaker_turn WHERE id >= ${start} AND id <= ${end}`);
    copied += r[0]?.response?.result?.affected_row_count ?? 0;
    const batchNum = Math.floor((start - minId) / BATCH) + 1;
    if (batchNum % 5 === 0 || batchNum === 1 || start + BATCH > maxId) {
      console.log(`  Batch ${batchNum}/${totalBatches} — ${copied.toLocaleString()} rows`);
    }
  }
  console.log(`Copy complete: ${copied.toLocaleString()} rows.`);

  await sql('DROP TABLE plenary_speaker_turn');
  await sql('ALTER TABLE plenary_speaker_turn_new RENAME TO plenary_speaker_turn');
  console.log('Tables swapped.');

  await sql('CREATE INDEX IF NOT EXISTS idx_plenary_turn_session ON plenary_speaker_turn(session_id)');
  console.log('plenary_speaker_turn indexes created.');

  // Verify DDL
  const pddl = await sqlVal("SELECT sql FROM sqlite_master WHERE type='table' AND name='plenary_speaker_turn'");
  console.log('plenary embedding col:', pddl?.match(/embedding[^,)]+/)?.[0]);

  // === Step 2: Create vector indexes ===
  console.log('\n=== Creating vector indexes ===');
  for (const [idx, tbl] of [
    ['idx_turn_embedding', 'session_speaker_turn'],
    ['idx_plenary_turn_embedding', 'plenary_speaker_turn'],
  ]) {
    console.log(`Creating ${idx} on ${tbl}...`);
    try {
      await sql(`CREATE INDEX ${idx} ON ${tbl} (libsql_vector_idx(embedding))`);
      console.log(`  ${idx} OK`);
    } catch (e) {
      console.log(`  ${idx} timed out / errored: ${e.message?.slice(0, 100)}`);
      console.log('  (Server may still be building it — check sqlite_master in a few minutes)');
    }
  }

  console.log('\nFinish rebuild complete.');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
