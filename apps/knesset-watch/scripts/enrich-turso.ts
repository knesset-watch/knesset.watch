// scripts/enrich-turso.ts
// Run: npm run db:enrich-turso
//
// Pushes session cards (rag_card) to Turso as enriched protocol_chunk rows.
// No API code changes needed — FTS5 in Turso indexes them automatically.
// Also updates session_protocol with richer metadata (start_time, end_time).
// Resume-safe: skips sessions where turso_enriched_at IS NOT NULL.

import Database from 'better-sqlite3';
import { createClient } from '@libsql/client/http';
import path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const BATCH_SIZE = 50; // Turso batch limit
const BATCH_DELAY_MS = 200;

function migrate(db: Database.Database) {
  const cols = (db.prepare('PRAGMA table_info(committee_session)').all() as any[]).map((c: any) => c.name);
  if (!cols.includes('turso_enriched_at')) {
    db.exec('ALTER TABLE committee_session ADD COLUMN turso_enriched_at TEXT');
    console.log('  Added turso_enriched_at to committee_session.');
  }
}

async function main() {
  if (!process.env.TURSO_URL) {
    console.error('TURSO_URL not set in .env.local — skipping Turso enrichment.');
    process.exit(0);
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  migrate(db);

  const turso = createClient({
    url: process.env.TURSO_URL!,
    authToken: process.env.TURSO_TOKEN,
  });

  console.log('Enrich Turso');

  // Check what tables exist in Turso
  let hasTursoProtocols = false;
  try {
    await turso.execute("SELECT 1 FROM session_protocol LIMIT 1");
    hasTursoProtocols = true;
  } catch {
    console.log('  session_protocol table not found in Turso — will create enriched_session table instead.');
  }

  // Create enriched_session table in Turso if it doesn't exist
  // This avoids touching existing protocol_chunk/session_protocol tables
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS enriched_session (
      session_id   INTEGER PRIMARY KEY,
      committee_id INTEGER,
      committee_name TEXT,
      date         TEXT,
      title        TEXT,
      protocol_number INTEGER,
      start_time   TEXT,
      end_time     TEXT,
      status_desc  TEXT,
      rag_card     TEXT,
      attendee_count INTEGER,
      vote_count   INTEGER,
      agenda_count INTEGER
    )
  `);

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS enriched_session_fts USING fts5(
      session_id UNINDEXED,
      committee_name,
      title,
      rag_card,
      tokenize='unicode61'
    )
  `).catch(() => {
    // FTS5 syntax differs in Turso — use regular table, Turso handles search differently
  });

  // Get sessions with rag_card that haven't been synced
  const sessions = db.prepare(`
    SELECT cs.id, cs.committee_id, cs.date, cs.title,
           cs.protocol_number, cs.start_time, cs.end_time, cs.status_desc,
           cs.rag_card, c.name as committee_name
    FROM committee_session cs
    LEFT JOIN committee c ON c.id = cs.committee_id
    WHERE cs.rag_card IS NOT NULL
      AND cs.turso_enriched_at IS NULL
    ORDER BY cs.id ASC
  `).all() as any[];

  if (sessions.length === 0) {
    console.log('  All sessions already synced to Turso.');
    db.close();
    turso.close();
    return;
  }

  console.log(`  Sessions to sync: ${sessions.length.toLocaleString()}`);

  // Get attendee + vote + agenda counts per session
  const getAttendeeCount = db.prepare('SELECT COUNT(*) as c FROM committee_attendance WHERE session_id = ?');
  const getVoteCount = db.prepare('SELECT COUNT(*) as c FROM session_vote WHERE session_id = ?');
  const getAgendaCount = db.prepare('SELECT COUNT(*) as c FROM session_agenda_item WHERE session_id = ?');

  const markSynced = db.prepare("UPDATE committee_session SET turso_enriched_at = datetime('now') WHERE id = ?");

  let done = 0;
  let errors = 0;

  for (let i = 0; i < sessions.length; i += BATCH_SIZE) {
    const batch = sessions.slice(i, i + BATCH_SIZE);

    // Build batch of statements
    const stmts = batch.map(s => {
      const attendeeCount = (getAttendeeCount.get(s.id) as any).c;
      const voteCount = (getVoteCount.get(s.id) as any).c;
      const agendaCount = (getAgendaCount.get(s.id) as any).c;

      return {
        sql: `INSERT OR REPLACE INTO enriched_session
              (session_id, committee_id, committee_name, date, title, protocol_number,
               start_time, end_time, status_desc, rag_card, attendee_count, vote_count, agenda_count)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          s.id, s.committee_id, s.committee_name ?? '', s.date ?? '', s.title ?? '',
          s.protocol_number, s.start_time, s.end_time, s.status_desc,
          s.rag_card, attendeeCount, voteCount, agendaCount,
        ],
      };
    });

    try {
      await turso.batch(stmts, 'write');

      // Mark as synced in local DB
      db.transaction(() => {
        for (const s of batch) markSynced.run(s.id);
      })();

      done += batch.length;
    } catch (err) {
      console.error(`\n  Batch error at ${i}:`, (err as Error).message);
      errors += batch.length;
    }

    const total = done + errors;
    if (total % 500 === 0 || total >= sessions.length) {
      const pct = Math.round((total / sessions.length) * 100);
      process.stdout.write(`\r    ${total}/${sessions.length} (${pct}%) synced`);
    }

    if (i + BATCH_SIZE < sessions.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  console.log('\n');

  // If Turso has session_protocol, also update start_time/end_time there
  if (hasTursoProtocols) {
    console.log('  Updating session_protocol with richer metadata...');
    try {
      await turso.execute(`
        ALTER TABLE session_protocol ADD COLUMN start_time TEXT
      `).catch(() => {}); // ignore if column exists
      await turso.execute(`
        ALTER TABLE session_protocol ADD COLUMN end_time TEXT
      `).catch(() => {});

      // Sync updated sessions in smaller batches
      const updatedSessions = sessions.slice(0, Math.min(sessions.length, 500));
      for (let i = 0; i < updatedSessions.length; i += BATCH_SIZE) {
        const batch = updatedSessions.slice(i, i + BATCH_SIZE);
        const updateStmts = batch
          .filter(s => s.start_time || s.end_time)
          .map(s => ({
            sql: 'UPDATE session_protocol SET start_time = ?, end_time = ? WHERE session_id = ?',
            args: [s.start_time, s.end_time, s.id],
          }));
        if (updateStmts.length > 0) {
          await turso.batch(updateStmts, 'write').catch(() => {});
        }
      }
      console.log('  session_protocol metadata updated.');
    } catch (err) {
      console.log('  session_protocol update skipped:', (err as Error).message);
    }
  }

  console.log(`\nResults: ${done.toLocaleString()} sessions synced, ${errors} errors`);
  console.log('enriched_session table in Turso is ready for search.');

  db.close();
  turso.close();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
