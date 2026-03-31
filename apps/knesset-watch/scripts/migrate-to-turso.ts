// scripts/migrate-to-turso.ts
// Run: npm run db:migrate-to-turso
//
// Migrates knesset.db → Turso (libSQL hosted SQLite).
// Skips protocol_text (560MB, local-only for parse scripts).
// Filters speaker turns to >200 chars only (~447K rows, ~276MB).
//
// Requires TURSO_URL and TURSO_TOKEN in .env.local.
// Pass --force to drop and recreate all tables.

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import Database from 'better-sqlite3';
import { createClient, type InStatement } from '@libsql/client';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const BATCH = 200;

async function migrate() {
  if (!process.env.TURSO_URL) throw new Error('TURSO_URL not set in .env.local');
  const force = process.argv.includes('--force');

  const local = new Database(DB_PATH, { readonly: true });
  const client = createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_TOKEN,
  });

  // ── Schema ──────────────────────────────────────────────────────────────────
  console.log('Creating schema in Turso...');

  if (force) {
    console.log('  --force: dropping existing tables...');
    await client.batch([
      'session_speaker_turn', 'session_staff', 'session_vote',
      'session_agenda_item', 'session_guest', 'committee_attendance',
      'session_bill', 'session_document', 'session_committee',
      'committee_session', 'committee', 'mk_person', 'bill', 'faction',
    ].map(t => ({ sql: `DROP TABLE IF EXISTS ${t}`, args: [] })), 'write');
  }

  await client.batch([
    {
      sql: `CREATE TABLE IF NOT EXISTS committee (
        id          INTEGER PRIMARY KEY,
        name        TEXT NOT NULL,
        type_id     INTEGER,
        type_desc   TEXT,
        knesset_num INTEGER
      )`, args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS mk_person (
        person_id    INTEGER PRIMARY KEY,
        first_name   TEXT NOT NULL,
        last_name    TEXT NOT NULL,
        faction_id   INTEGER,
        faction_name TEXT,
        is_current   INTEGER DEFAULT 1,
        slug         TEXT
      )`, args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS faction (
        id          INTEGER PRIMARY KEY,
        name        TEXT NOT NULL,
        knesset_num INTEGER
      )`, args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS bill (
        id               INTEGER PRIMARY KEY,
        title            TEXT NOT NULL,
        subtype          TEXT,
        status_id        INTEGER,
        is_passed        INTEGER DEFAULT 0,
        committee_id     INTEGER,
        committee_name   TEXT,
        summary          TEXT,
        doc_url          TEXT,
        micro_agenda     TEXT,
        macro_agenda     TEXT,
        publication_date TEXT,
        status_desc      TEXT,
        init_date        TEXT
      )`, args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS committee_session (
        id                   INTEGER PRIMARY KEY,
        committee_id         INTEGER NOT NULL,
        committee_name       TEXT,
        date                 TEXT,
        title                TEXT,
        session_number       INTEGER,
        protocol_number      INTEGER,
        session_term         INTEGER,
        start_time           TEXT,
        end_time             TEXT,
        status_desc          TEXT,
        type_desc            TEXT,
        knesset_num          INTEGER,
        attendance_disclaimer INTEGER DEFAULT 0,
        no_protocol_reason   TEXT,
        is_revision          INTEGER DEFAULT 0,
        is_joint             INTEGER DEFAULT 0,
        protocol_url         TEXT,
        session_url          TEXT,
        rag_card             TEXT,
        embedding            F32_BLOB(768)
      )`, args: [],
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_session_committee
            ON committee_session(committee_id)`, args: [],
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_session_date
            ON committee_session(date)`, args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS committee_attendance (
        session_id INTEGER NOT NULL,
        mk_id      INTEGER NOT NULL,
        role       TEXT,
        PRIMARY KEY (session_id, mk_id)
      )`, args: [],
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_attendance_mk
            ON committee_attendance(mk_id)`, args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS session_guest (
        id                INTEGER PRIMARY KEY,
        session_id        INTEGER NOT NULL,
        name              TEXT NOT NULL,
        organization      TEXT,
        attendance_method TEXT DEFAULT 'in_person'
      )`, args: [],
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_guest_session
            ON session_guest(session_id)`, args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS session_staff (
        id         INTEGER PRIMARY KEY,
        session_id INTEGER NOT NULL,
        role       TEXT NOT NULL,
        name_text  TEXT NOT NULL
      )`, args: [],
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_staff_session
            ON session_staff(session_id)`, args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS session_agenda_item (
        id          INTEGER PRIMARY KEY,
        session_id  INTEGER NOT NULL,
        item_number INTEGER,
        title       TEXT NOT NULL,
        item_type   TEXT DEFAULT 'topic'
      )`, args: [],
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_agenda_session
            ON session_agenda_item(session_id)`, args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS session_vote (
        id            INTEGER PRIMARY KEY,
        session_id    INTEGER NOT NULL,
        vote_number   INTEGER,
        subject       TEXT,
        for_count     INTEGER,
        against_count INTEGER,
        abstain_count INTEGER,
        passed        INTEGER
      )`, args: [],
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_vote_session
            ON session_vote(session_id)`, args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS session_speaker_turn (
        id           INTEGER PRIMARY KEY,
        session_id   INTEGER NOT NULL,
        turn_number  INTEGER,
        speaker_role TEXT,
        mk_id        INTEGER,
        raw_name     TEXT,
        faction_name TEXT,
        text         TEXT
      )`, args: [],
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS idx_turn_session
            ON session_speaker_turn(session_id)`, args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS session_bill (
        session_id INTEGER NOT NULL,
        bill_id    INTEGER NOT NULL,
        PRIMARY KEY (session_id, bill_id)
      )`, args: [],
    },
  ], 'write');

  console.log('  Schema ready.\n');

  // ── Helper ───────────────────────────────────────────────────────────────────
  async function pushBatch(stmts: InStatement[], label: string, count: number, total: number) {
    await client.batch(stmts, 'write');
    if (count % 5000 === 0 || count >= total) {
      process.stdout.write(`\r  ${label}: ${count.toLocaleString()} / ${total.toLocaleString()}`);
    }
  }

  // ── committee ────────────────────────────────────────────────────────────────
  {
    const rows = local.prepare('SELECT id, name, type_id, type_desc, knesset_num FROM committee').all() as any[];
    if (rows.length > 0) {
      await client.batch(
        rows.map(r => ({ sql: `INSERT OR REPLACE INTO committee VALUES (?,?,?,?,?)`, args: [r.id, r.name, r.type_id, r.type_desc, r.knesset_num] })),
        'write',
      );
    }
    console.log(`committee: ${rows.length} rows`);
  }

  // ── faction ──────────────────────────────────────────────────────────────────
  {
    const rows = local.prepare('SELECT id, name, knesset_num FROM faction').all() as any[];
    if (rows.length > 0) {
      await client.batch(
        rows.map(r => ({ sql: `INSERT OR REPLACE INTO faction VALUES (?,?,?)`, args: [r.id, r.name, r.knesset_num] })),
        'write',
      );
    }
    console.log(`faction: ${rows.length} rows`);
  }

  // ── mk_person ────────────────────────────────────────────────────────────────
  {
    const rows = local.prepare(
      'SELECT person_id, first_name, last_name, faction_id, faction_name, is_current, slug FROM mk_person'
    ).all() as any[];
    if (rows.length > 0) {
      await client.batch(
        rows.map(r => ({
          sql: `INSERT OR REPLACE INTO mk_person VALUES (?,?,?,?,?,?,?)`,
          args: [r.person_id, r.first_name, r.last_name, r.faction_id, r.faction_name, r.is_current, r.slug],
        })),
        'write',
      );
    }
    console.log(`mk_person: ${rows.length} rows`);
  }

  // ── bill ─────────────────────────────────────────────────────────────────────
  {
    const rows = local.prepare(`
      SELECT id, title, subtype, status_id, is_passed, committee_id, committee_name,
             summary, doc_url, micro_agenda, macro_agenda, publication_date, status_desc, init_date
      FROM bill
    `).all() as any[];
    let batch: InStatement[] = [];
    let count = 0;
    for (const r of rows) {
      batch.push({
        sql: `INSERT OR REPLACE INTO bill VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [r.id, r.title, r.subtype, r.status_id, r.is_passed, r.committee_id, r.committee_name,
               r.summary, r.doc_url, r.micro_agenda, r.macro_agenda, r.publication_date, r.status_desc, r.init_date],
      });
      if (batch.length === BATCH) { await client.batch(batch, 'write'); batch = []; }
      count++;
    }
    if (batch.length > 0) await client.batch(batch, 'write');
    console.log(`bill: ${count} rows`);
  }

  // ── committee_session (no protocol_text) ─────────────────────────────────────
  {
    const rows = local.prepare(`
      SELECT id, committee_id, committee_name, date, title,
             session_number, protocol_number, session_term, start_time, end_time,
             status_desc, type_desc, knesset_num, attendance_disclaimer,
             no_protocol_reason, is_revision, is_joint, protocol_url, session_url, rag_card
      FROM committee_session ORDER BY id
    `).all() as any[];
    let batch: InStatement[] = [];
    let count = 0;
    for (const r of rows) {
      batch.push({
        sql: `INSERT OR REPLACE INTO committee_session
              (id, committee_id, committee_name, date, title,
               session_number, protocol_number, session_term, start_time, end_time,
               status_desc, type_desc, knesset_num, attendance_disclaimer,
               no_protocol_reason, is_revision, is_joint, protocol_url, session_url, rag_card)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [
          r.id, r.committee_id, r.committee_name, r.date, r.title,
          r.session_number, r.protocol_number, r.session_term, r.start_time, r.end_time,
          r.status_desc, r.type_desc, r.knesset_num, r.attendance_disclaimer,
          r.no_protocol_reason, r.is_revision, r.is_joint, r.protocol_url, r.session_url, r.rag_card,
        ],
      });
      if (batch.length === BATCH) { await client.batch(batch, 'write'); batch = []; }
      count++;
      if (count % 1000 === 0) process.stdout.write(`\r  committee_session: ${count} / ${rows.length}`);
    }
    if (batch.length > 0) await client.batch(batch, 'write');
    console.log(`\r  committee_session: ${count} rows`);
  }

  // ── committee_attendance ─────────────────────────────────────────────────────
  {
    const rows = local.prepare('SELECT session_id, mk_id, role FROM committee_attendance').all() as any[];
    let batch: InStatement[] = [];
    let count = 0;
    for (const r of rows) {
      batch.push({ sql: `INSERT OR REPLACE INTO committee_attendance VALUES (?,?,?)`, args: [r.session_id, r.mk_id, r.role] });
      if (batch.length === BATCH) { await client.batch(batch, 'write'); batch = []; }
      count++;
    }
    if (batch.length > 0) await client.batch(batch, 'write');
    console.log(`committee_attendance: ${count} rows`);
  }

  // ── session_guest ────────────────────────────────────────────────────────────
  {
    const rows = local.prepare('SELECT id, session_id, name, organization, attendance_method FROM session_guest').all() as any[];
    let batch: InStatement[] = [];
    let count = 0;
    for (const r of rows) {
      batch.push({ sql: `INSERT OR REPLACE INTO session_guest VALUES (?,?,?,?,?)`, args: [r.id, r.session_id, r.name, r.organization, r.attendance_method] });
      if (batch.length === BATCH) { await client.batch(batch, 'write'); batch = []; }
      count++;
      if (count % 10000 === 0) process.stdout.write(`\r  session_guest: ${count} / ${rows.length}`);
    }
    if (batch.length > 0) await client.batch(batch, 'write');
    console.log(`\r  session_guest: ${count} rows`);
  }

  // ── session_staff ────────────────────────────────────────────────────────────
  {
    const rows = local.prepare('SELECT id, session_id, role, name_text FROM session_staff').all() as any[];
    let batch: InStatement[] = [];
    let count = 0;
    for (const r of rows) {
      batch.push({ sql: `INSERT OR REPLACE INTO session_staff VALUES (?,?,?,?)`, args: [r.id, r.session_id, r.role, r.name_text] });
      if (batch.length === BATCH) { await client.batch(batch, 'write'); batch = []; }
      count++;
    }
    if (batch.length > 0) await client.batch(batch, 'write');
    console.log(`session_staff: ${count} rows`);
  }

  // ── session_agenda_item ──────────────────────────────────────────────────────
  {
    const rows = local.prepare('SELECT id, session_id, item_number, title, item_type FROM session_agenda_item').all() as any[];
    let batch: InStatement[] = [];
    let count = 0;
    for (const r of rows) {
      batch.push({ sql: `INSERT OR REPLACE INTO session_agenda_item VALUES (?,?,?,?,?)`, args: [r.id, r.session_id, r.item_number, r.title, r.item_type] });
      if (batch.length === BATCH) { await client.batch(batch, 'write'); batch = []; }
      count++;
    }
    if (batch.length > 0) await client.batch(batch, 'write');
    console.log(`session_agenda_item: ${count} rows`);
  }

  // ── session_vote ─────────────────────────────────────────────────────────────
  {
    const rows = local.prepare('SELECT id, session_id, vote_number, subject, for_count, against_count, abstain_count, passed FROM session_vote').all() as any[];
    let batch: InStatement[] = [];
    let count = 0;
    for (const r of rows) {
      batch.push({ sql: `INSERT OR REPLACE INTO session_vote VALUES (?,?,?,?,?,?,?,?)`, args: [r.id, r.session_id, r.vote_number, r.subject, r.for_count, r.against_count, r.abstain_count, r.passed] });
      if (batch.length === BATCH) { await client.batch(batch, 'write'); batch = []; }
      count++;
    }
    if (batch.length > 0) await client.batch(batch, 'write');
    console.log(`session_vote: ${count} rows`);
  }

  // ── session_speaker_turn (>200 chars only) ───────────────────────────────────
  {
    const total = (local.prepare('SELECT COUNT(*) as c FROM session_speaker_turn WHERE LENGTH(text) > 200').get() as any).c;
    const stmt = local.prepare(`
      SELECT id, session_id, turn_number, speaker_role, mk_id, raw_name, faction_name, text
      FROM session_speaker_turn WHERE LENGTH(text) > 200 ORDER BY id
    `);
    let batch: InStatement[] = [];
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
        if (count % 5000 === 0) process.stdout.write(`\r  session_speaker_turn: ${count.toLocaleString()} / ${total.toLocaleString()}`);
      }
    }
    if (batch.length > 0) { await client.batch(batch, 'write'); count += batch.length; }
    console.log(`\r  session_speaker_turn: ${count.toLocaleString()} rows (>200 chars only)`);
  }

  // ── session_bill ─────────────────────────────────────────────────────────────
  {
    const rows = local.prepare('SELECT session_id, bill_id FROM session_bill').all() as any[];
    let batch: InStatement[] = [];
    let count = 0;
    for (const r of rows) {
      batch.push({ sql: `INSERT OR REPLACE INTO session_bill VALUES (?,?)`, args: [r.session_id, r.bill_id] });
      if (batch.length === BATCH) { await client.batch(batch, 'write'); batch = []; }
      count++;
    }
    if (batch.length > 0) await client.batch(batch, 'write');
    console.log(`session_bill: ${count} rows`);
  }

  // ── Verify ───────────────────────────────────────────────────────────────────
  const verify = await client.execute('SELECT COUNT(*) as cnt FROM committee_session');
  console.log(`\nDone. ${verify.rows[0]['cnt']} sessions in Turso.`);

  local.close();
}

migrate().catch(err => {
  console.error(err.message);
  process.exit(1);
});
