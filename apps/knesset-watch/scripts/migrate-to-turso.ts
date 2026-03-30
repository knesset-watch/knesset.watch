// scripts/migrate-to-turso.ts
// Migrates local protocols.db → Turso (libSQL hosted SQLite).
// Run: npm run db:migrate-to-turso
//
// Requires TURSO_URL and TURSO_TOKEN in .env.local (or environment).
// Creates a content-table FTS5 schema in Turso to avoid text duplication.

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import Database from 'better-sqlite3';
import { createClient, type InStatement } from '@libsql/client';
import path from 'path';

const PROTOCOLS_DB = path.join(process.cwd(), 'protocols.db');
const BATCH_SIZE = 200;

async function migrate() {
  if (!process.env.TURSO_URL) throw new Error('TURSO_URL not set in .env.local');

  const localDb = new Database(PROTOCOLS_DB, { readonly: true });
  const client = createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_TOKEN,
  });

  console.log('Creating schema in Turso...');
  await client.batch([
    {
      sql: `CREATE TABLE IF NOT EXISTS session_protocol (
        session_id    INTEGER PRIMARY KEY,
        committee_id  INTEGER NOT NULL,
        committee_name TEXT,
        date          TEXT NOT NULL,
        title         TEXT,
        doc_url       TEXT,
        chunk_count   INTEGER DEFAULT 0
      )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS protocol_chunk (
        id            INTEGER PRIMARY KEY,
        session_id    INTEGER NOT NULL,
        chunk_index   INTEGER NOT NULL,
        text          TEXT NOT NULL,
        speaker       TEXT,
        committee_name TEXT,
        date          TEXT
      )`,
      args: [],
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_chunk_session
            ON protocol_chunk(session_id, chunk_index)`,
      args: [],
    },
    {
      sql: `CREATE VIRTUAL TABLE IF NOT EXISTS protocol_chunk_fts USING fts5(
        text,
        committee_name UNINDEXED,
        date UNINDEXED,
        speaker UNINDEXED,
        content='protocol_chunk',
        content_rowid='id',
        tokenize='unicode61'
      )`,
      args: [],
    },
  ], 'write');

  // Check if already migrated
  const existing = await client.execute('SELECT COUNT(*) as cnt FROM session_protocol');
  const existingCount = Number(existing.rows[0]['cnt']);
  if (existingCount > 0) {
    console.log(`Turso already has ${existingCount} sessions — clearing for fresh migration...`);
    await client.batch([
      { sql: `DELETE FROM protocol_chunk_fts`, args: [] },
      { sql: `DELETE FROM protocol_chunk`, args: [] },
      { sql: `DELETE FROM session_protocol`, args: [] },
    ], 'write');
  }

  // --- Migrate session_protocol ---
  const sessions = localDb.prepare('SELECT * FROM session_protocol ORDER BY session_id').all() as Array<{
    session_id: number; committee_id: number; committee_name: string | null;
    date: string; title: string | null; doc_url: string | null; chunk_count: number;
  }>;
  console.log(`Migrating ${sessions.length} sessions...`);

  for (let i = 0; i < sessions.length; i += BATCH_SIZE) {
    const batch = sessions.slice(i, i + BATCH_SIZE);
    await client.batch(
      batch.map(s => ({
        sql: `INSERT INTO session_protocol VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [s.session_id, s.committee_id, s.committee_name, s.date, s.title, s.doc_url, s.chunk_count],
      })),
      'write',
    );
  }
  console.log('Sessions done.');

  // --- Migrate protocol_chunk (with denormalized committee_name + date) ---
  const totalChunks = (localDb.prepare('SELECT COUNT(*) as cnt FROM protocol_chunk').get() as { cnt: number }).cnt;
  console.log(`Migrating ${totalChunks} chunks (this takes ~2 minutes)...`);

  const stmt = localDb.prepare(`
    SELECT pc.id, pc.session_id, pc.chunk_index, pc.text, pc.speaker,
           sp.committee_name, sp.date
    FROM protocol_chunk pc
    JOIN session_protocol sp ON sp.session_id = pc.session_id
    ORDER BY pc.id
  `);

  let batch: InStatement[] = [];
  let count = 0;

  for (const row of stmt.iterate() as Iterable<{
    id: number; session_id: number; chunk_index: number;
    text: string; speaker: string | null;
    committee_name: string | null; date: string;
  }>) {
    batch.push({
      sql: `INSERT INTO protocol_chunk (id, session_id, chunk_index, text, speaker, committee_name, date)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [row.id, row.session_id, row.chunk_index, row.text, row.speaker, row.committee_name, row.date],
    });

    if (batch.length === BATCH_SIZE) {
      await client.batch(batch, 'write');
      batch = [];
      count += BATCH_SIZE;
      if (count % 10000 === 0) process.stdout.write(`  ${count}/${totalChunks} chunks\r`);
    }
  }

  if (batch.length > 0) {
    await client.batch(batch, 'write');
    count += batch.length;
  }

  console.log(`\nChunks done (${count} total).`);

  // --- Rebuild FTS index on Turso server ---
  console.log('Rebuilding FTS index on Turso (may take 30-60s)...');
  await client.execute(`INSERT INTO protocol_chunk_fts(protocol_chunk_fts) VALUES('rebuild')`);
  console.log('FTS index built.');

  const verify = await client.execute('SELECT COUNT(*) as cnt FROM session_protocol');
  console.log(`\nDone! ${verify.rows[0]['cnt']} sessions in Turso.`);

  localDb.close();
}

migrate().catch(err => {
  console.error(err.message);
  process.exit(1);
});
