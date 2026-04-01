/**
 * Backfills session_speaker_turn rows with LENGTH(text) <= 200 into Turso.
 * These were excluded from the original migration but contain important
 * short dialogue turns (questions, brief responses, etc.)
 */

import Database from 'better-sqlite3';
import { createClient } from '@libsql/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const BATCH = 500;

async function main() {
  const local = new Database(path.join(__dirname, '../knesset.db'), { readonly: true });
  const client = createClient({ url: process.env.TURSO_URL!, authToken: process.env.TURSO_TOKEN });

  const total = (local.prepare(
    `SELECT COUNT(*) as c FROM session_speaker_turn WHERE LENGTH(text) BETWEEN 1 AND 200`
  ).get() as any).c;
  console.log(`Short turns to backfill: ${total.toLocaleString()}`);

  const stmt = local.prepare(`
    SELECT id, session_id, turn_number, speaker_role, mk_id, raw_name, faction_name, text
    FROM session_speaker_turn
    WHERE LENGTH(text) BETWEEN 1 AND 200
    ORDER BY id
  `);

  let batch: any[] = [];
  let count = 0;

  for (const r of stmt.iterate() as Iterable<any>) {
    batch.push({
      sql: `INSERT OR REPLACE INTO session_speaker_turn VALUES (?,?,?,?,?,?,?,?)`,
      args: [r.id, r.session_id, r.turn_number, r.speaker_role, r.mk_id, r.raw_name, r.faction_name, r.text],
    });
    if (batch.length === BATCH) {
      await client.batch(batch, 'write');
      batch = [];
      count += BATCH;
      if (count % 10000 === 0) process.stdout.write(`\r  ${count.toLocaleString()} / ${total.toLocaleString()} (${Math.round(count/total*100)}%)`);
    }
  }
  if (batch.length > 0) {
    await client.batch(batch, 'write');
    count += batch.length;
  }

  console.log(`\r  Done: ${count.toLocaleString()} short turns inserted into Turso`);
  local.close();
}

main().catch(console.error);
