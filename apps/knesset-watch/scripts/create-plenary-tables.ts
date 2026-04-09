/**
 * Creates plenary_session and plenary_speaker_turn tables in Turso.
 * Run once: npx tsx scripts/create-plenary-tables.ts
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@libsql/client';

async function main() {
  if (!process.env.TURSO_URL) throw new Error('TURSO_URL not set');

  const client = createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_TOKEN,
  });

  console.log('Creating plenary_session table...');
  await client.execute(`
    CREATE TABLE IF NOT EXISTS plenary_session (
      id INTEGER PRIMARY KEY,
      session_number INTEGER,
      knesset_num INTEGER,
      name TEXT,
      start_date TEXT,
      protocol_url TEXT,
      speaker_count INTEGER DEFAULT 0,
      word_count INTEGER DEFAULT 0,
      last_scraped TEXT
    )
  `);

  console.log('Creating plenary_speaker_turn table...');
  await client.execute(`
    CREATE TABLE IF NOT EXISTS plenary_speaker_turn (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      speaker_name TEXT,
      role TEXT,
      mk_id INTEGER,
      text TEXT,
      turn_index INTEGER
    )
  `);

  console.log('Creating index on plenary_speaker_turn(session_id)...');
  await client.execute(`
    CREATE INDEX IF NOT EXISTS idx_plenary_turn_session ON plenary_speaker_turn(session_id)
  `);

  console.log('Done. All plenary tables created.');
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
