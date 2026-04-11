'use strict';
/**
 * Rebuilds session_speaker_turn and plenary_speaker_turn tables
 * to change embedding column from F32_BLOB(768) to F32_BLOB(256).
 *
 * Uses batched INSERT SELECT by ID range so no single request times out.
 * Run with workers stopped.
 */
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

const TURSO_URL = process.env.TURSO_URL?.replace('libsql://', 'https://');
const TURSO_TOKEN = process.env.TURSO_TOKEN;

if (!TURSO_URL) { console.error('TURSO_URL not set'); process.exit(1); }

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

async function rebuildTable({ table, newTable, ddl, indexes, batchSize }) {
  console.log(`\n=== Rebuilding ${table} ===`);

  // Step 1: Create new table
  console.log('Creating new table...');
  await sql(`DROP TABLE IF EXISTS ${newTable}`);
  await sql(ddl);
  console.log('New table created.');

  // Step 2: Get ID range
  const minId = Number(await sqlVal(`SELECT MIN(id) FROM ${table}`));
  const maxId = Number(await sqlVal(`SELECT MAX(id) FROM ${table}`));
  console.log(`ID range: ${minId} - ${maxId}`);

  // Step 3: Batch copy
  const totalBatches = Math.ceil((maxId - minId + 1) / batchSize);
  let copied = 0;
  const cols = Object.keys(indexes).length > 0 ? '*' : '*'; // always use *

  for (let start = minId; start <= maxId; start += batchSize) {
    const end = start + batchSize - 1;
    const r = await sql(`INSERT INTO ${newTable} SELECT * FROM ${table} WHERE id >= ${start} AND id <= ${end}`);
    const affected = r[0]?.response?.result?.affected_row_count ?? 0;
    copied += affected;
    const batchNum = Math.floor((start - minId) / batchSize) + 1;
    if (batchNum % 20 === 0 || batchNum === 1 || start + batchSize > maxId) {
      const pct = ((start - minId + batchSize) / (maxId - minId + 1) * 100).toFixed(1);
      console.log(`  Batch ${batchNum}/${totalBatches} (${pct}%) — copied ${copied.toLocaleString()} rows so far`);
    }
  }
  console.log(`Copy complete: ${copied.toLocaleString()} rows copied.`);

  // Step 4: Drop old table, rename new
  console.log('Swapping tables...');
  await sql(`DROP TABLE ${table}`);
  await sql(`ALTER TABLE ${newTable} RENAME TO ${table}`);
  console.log('Tables swapped.');

  // Step 5: Recreate regular indexes
  for (const [name, ddl] of Object.entries(indexes)) {
    console.log(`Creating index: ${name}`);
    await sql(ddl);
  }

  console.log(`${table} rebuild complete.`);
}

async function main() {
  // Rebuild session_speaker_turn
  await rebuildTable({
    table: 'session_speaker_turn',
    newTable: 'session_speaker_turn_new',
    ddl: `CREATE TABLE session_speaker_turn_new (
      id           INTEGER PRIMARY KEY,
      session_id   INTEGER NOT NULL,
      turn_number  INTEGER,
      speaker_role TEXT,
      mk_id        INTEGER,
      raw_name     TEXT,
      faction_name TEXT,
      text         TEXT,
      embedding    F32_BLOB(256)
    )`,
    indexes: {
      idx_turn_session: 'CREATE INDEX idx_turn_session ON session_speaker_turn(session_id)',
      idx_sst_needs_embed: 'CREATE INDEX idx_sst_needs_embed ON session_speaker_turn(id) WHERE embedding IS NULL',
    },
    batchSize: 5000,
  });

  // Rebuild plenary_speaker_turn
  await rebuildTable({
    table: 'plenary_speaker_turn',
    newTable: 'plenary_speaker_turn_new',
    ddl: `CREATE TABLE plenary_speaker_turn_new (
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
    )`,
    indexes: {
      idx_plenary_turn_session: 'CREATE INDEX idx_plenary_turn_session ON plenary_speaker_turn(session_id)',
    },
    batchSize: 10000,
  });

  // Create vector indexes (both tables now have F32_BLOB(256) — index will default to 256-dim)
  console.log('\nCreating vector indexes (will time out on client — server continues)...');
  for (const [idx, tbl] of [
    ['idx_turn_embedding', 'session_speaker_turn'],
    ['idx_plenary_turn_embedding', 'plenary_speaker_turn'],
  ]) {
    console.log(`  CREATE INDEX ${idx} on ${tbl}...`);
    try {
      await sql(`CREATE INDEX ${idx} ON ${tbl} (libsql_vector_idx(embedding))`);
      console.log(`  ${idx} created OK`);
    } catch (e) {
      if (e.message?.includes('timeout') || e.message?.includes('TIMEOUT')) {
        console.log(`  ${idx} timed out (server may still be building it — check in a few minutes)`);
      } else {
        console.log(`  ${idx} error: ${e.message}`);
      }
    }
  }

  console.log('\nRebuild complete. Restart embed workers.');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
