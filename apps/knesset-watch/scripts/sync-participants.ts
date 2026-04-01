// scripts/sync-participants.ts
// Run: npm run db:sync-participants
//
// Syncs committee_attendance, session_guest, and session_staff from local
// knesset.db to Turso. These tables were re-populated by fix-attendance.ts
// and fix-staff.ts and need to be pushed to the production database.
//
// Also adds the `role` column to session_guest in Turso if missing.

import Database from 'better-sqlite3';
import { createClient } from '@libsql/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const DB_PATH = path.join(__dirname, '../knesset.db');
const BATCH = 500;

async function main() {
  if (!process.env.TURSO_URL) {
    console.error('TURSO_URL not set in .env.local');
    process.exit(1);
  }

  const local = new Database(DB_PATH, { readonly: true });
  const client = createClient({
    url: process.env.TURSO_URL!,
    authToken: process.env.TURSO_TOKEN,
  });

  console.log('Sync Participants to Turso');

  // ── 1. Schema migrations ───────────────────────────────────────────────────
  console.log('\n  1. Checking schema...');

  // Add role column to session_guest if missing
  try {
    await client.execute('ALTER TABLE session_guest ADD COLUMN role TEXT');
    console.log('    Added role column to session_guest.');
  } catch {
    // Column already exists — ignore
  }

  // ── 2. committee_attendance ────────────────────────────────────────────────
  const attRows = local.prepare(
    'SELECT session_id, mk_id, role FROM committee_attendance ORDER BY session_id, mk_id'
  ).all() as Array<{ session_id: number; mk_id: number; role: string | null }>;

  console.log(`\n  2. Syncing committee_attendance (${attRows.length.toLocaleString()} rows)...`);

  await client.execute('DELETE FROM committee_attendance');

  let done = 0;
  for (let i = 0; i < attRows.length; i += BATCH) {
    const batch = attRows.slice(i, i + BATCH).map(r => ({
      sql: 'INSERT INTO committee_attendance (session_id, mk_id, role) VALUES (?, ?, ?)',
      args: [r.session_id, r.mk_id, r.role ?? 'member'],
    }));
    await client.batch(batch, 'write');
    done += batch.length;
    if (done % 5000 === 0 || done >= attRows.length) {
      process.stdout.write(`\r    ${done.toLocaleString()} / ${attRows.length.toLocaleString()} (${Math.round(done / attRows.length * 100)}%)`);
    }
  }
  console.log(`\r    Done: ${done.toLocaleString()} attendance rows.         `);

  // ── 3. session_guest ────────────────────────────────────────────────────────
  const guestRows = local.prepare(
    'SELECT session_id, name, role, organization, attendance_method FROM session_guest ORDER BY session_id, id'
  ).all() as Array<{ session_id: number; name: string; role: string | null; organization: string | null; attendance_method: string | null }>;

  console.log(`\n  3. Syncing session_guest (${guestRows.length.toLocaleString()} rows)...`);

  await client.execute('DELETE FROM session_guest');

  done = 0;
  for (let i = 0; i < guestRows.length; i += BATCH) {
    const batch = guestRows.slice(i, i + BATCH).map(r => ({
      sql: 'INSERT INTO session_guest (session_id, name, role, organization, attendance_method) VALUES (?, ?, ?, ?, ?)',
      args: [r.session_id, r.name, r.role ?? null, r.organization ?? null, r.attendance_method ?? 'in_person'],
    }));
    await client.batch(batch, 'write');
    done += batch.length;
    if (done % 10000 === 0 || done >= guestRows.length) {
      process.stdout.write(`\r    ${done.toLocaleString()} / ${guestRows.length.toLocaleString()} (${Math.round(done / guestRows.length * 100)}%)`);
    }
  }
  console.log(`\r    Done: ${done.toLocaleString()} guest rows.         `);

  // ── 4. session_staff ───────────────────────────────────────────────────────
  const staffRows = local.prepare(
    'SELECT session_id, role, name_text FROM session_staff ORDER BY session_id, id'
  ).all() as Array<{ session_id: number; role: string; name_text: string }>;

  console.log(`\n  4. Syncing session_staff (${staffRows.length.toLocaleString()} rows)...`);

  await client.execute('DELETE FROM session_staff');

  done = 0;
  for (let i = 0; i < staffRows.length; i += BATCH) {
    const batch = staffRows.slice(i, i + BATCH).map(r => ({
      sql: 'INSERT INTO session_staff (session_id, role, name_text) VALUES (?, ?, ?)',
      args: [r.session_id, r.role, r.name_text],
    }));
    await client.batch(batch, 'write');
    done += batch.length;
    if (done % 5000 === 0 || done >= staffRows.length) {
      process.stdout.write(`\r    ${done.toLocaleString()} / ${staffRows.length.toLocaleString()} (${Math.round(done / staffRows.length * 100)}%)`);
    }
  }
  console.log(`\r    Done: ${done.toLocaleString()} staff rows.         `);

  // ── 5. Summary ─────────────────────────────────────────────────────────────
  console.log('\nResults:');
  console.log(`  committee_attendance : ${attRows.length.toLocaleString()} rows`);
  console.log(`  session_guest        : ${guestRows.length.toLocaleString()} rows`);
  console.log(`  session_staff        : ${staffRows.length.toLocaleString()} rows`);

  local.close();
  client.close();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
