// scripts/init-protocols-db.ts
// Run: npm run db:init-protocols
// Creates protocols.db with the full schema. Safe to re-run (CREATE IF NOT EXISTS).

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'protocols.db');

function init() {
  const db = new Database(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_protocol (
      session_id    INTEGER PRIMARY KEY,
      committee_id  INTEGER NOT NULL,
      committee_name TEXT,
      date          TEXT NOT NULL,
      title         TEXT,
      doc_url       TEXT,
      chunk_count   INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS protocol_chunk (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    INTEGER NOT NULL REFERENCES session_protocol(session_id),
      chunk_index   INTEGER NOT NULL,
      text          TEXT NOT NULL,
      speaker       TEXT,
      embedding     BLOB
    );

    CREATE INDEX IF NOT EXISTS idx_chunk_session
      ON protocol_chunk(session_id, chunk_index);

    CREATE VIRTUAL TABLE IF NOT EXISTS protocol_chunk_fts USING fts5(
      text,
      chunk_id UNINDEXED,
      session_id UNINDEXED,
      committee_name UNINDEXED,
      date UNINDEXED,
      speaker UNINDEXED,
      tokenize='unicode61'
    );
  `);

  db.close();
  console.log(`protocols.db initialized at ${DB_PATH}`);
}

init();
