// scripts/build-fts.ts
// Run: npm run db:build-fts
//
// Builds SQLite FTS5 indexes on knesset.db for full-text search.
// Indexes: session rag_cards, agenda items, speaker turns.
// Safe to re-run: drops and rebuilds each index.

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

async function main() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  console.log('Build FTS5 Indexes');

  // ── 1. Session cards (rag_card + title) ─────────────────────────────────
  console.log('\n  1. Session cards FTS...');
  db.exec(`DROP TABLE IF EXISTS fts_sessions`);
  db.exec(`
    CREATE VIRTUAL TABLE fts_sessions USING fts5(
      session_id UNINDEXED,
      committee_name,
      date UNINDEXED,
      title,
      rag_card,
      tokenize='unicode61'
    )
  `);

  const sessionRows = db.prepare(`
    SELECT cs.id, c.name as committee_name, cs.date, cs.title, cs.rag_card
    FROM committee_session cs
    LEFT JOIN committee c ON c.id = cs.committee_id
    WHERE cs.rag_card IS NOT NULL
  `).all() as any[];

  const insertSession = db.prepare(
    'INSERT INTO fts_sessions (session_id, committee_name, date, title, rag_card) VALUES (?, ?, ?, ?, ?)'
  );
  db.transaction(() => {
    for (const r of sessionRows) {
      insertSession.run(r.id, r.committee_name ?? '', r.date ?? '', r.title ?? '', r.rag_card ?? '');
    }
  })();
  console.log(`    ${sessionRows.length.toLocaleString()} sessions indexed.`);

  // ── 2. Agenda items ───────────────────────────────────────────────────────
  console.log('  2. Agenda items FTS...');
  db.exec(`DROP TABLE IF EXISTS fts_agenda`);
  db.exec(`
    CREATE VIRTUAL TABLE fts_agenda USING fts5(
      session_id UNINDEXED,
      title,
      tokenize='unicode61'
    )
  `);

  const agendaRows = db.prepare('SELECT session_id, title FROM session_agenda_item').all() as any[];
  const insertAgenda = db.prepare('INSERT INTO fts_agenda (session_id, title) VALUES (?, ?)');
  db.transaction(() => {
    for (const r of agendaRows) {
      insertAgenda.run(r.session_id, r.title ?? '');
    }
  })();
  console.log(`    ${agendaRows.length.toLocaleString()} agenda items indexed.`);

  // ── 3. Speaker turns ──────────────────────────────────────────────────────
  console.log('  3. Speaker turns FTS (2.1M rows — may take 10-20 min)...');
  db.exec(`DROP TABLE IF EXISTS fts_turns`);
  db.exec(`
    CREATE VIRTUAL TABLE fts_turns USING fts5(
      session_id UNINDEXED,
      mk_id UNINDEXED,
      raw_name,
      faction_name,
      speaker_role UNINDEXED,
      text,
      tokenize='unicode61'
    )
  `);

  // Insert in batches to show progress
  const total = (db.prepare('SELECT COUNT(*) as c FROM session_speaker_turn').get() as any).c;
  const insertTurn = db.prepare(
    'INSERT INTO fts_turns (session_id, mk_id, raw_name, faction_name, speaker_role, text) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const BATCH = 50000;
  let offset = 0;
  while (offset < total) {
    const rows = db.prepare(`
      SELECT session_id, mk_id, raw_name, faction_name, speaker_role, text
      FROM session_speaker_turn
      LIMIT ${BATCH} OFFSET ${offset}
    `).all() as any[];

    db.transaction(() => {
      for (const r of rows) {
        insertTurn.run(r.session_id, r.mk_id, r.raw_name ?? '', r.faction_name ?? '', r.speaker_role ?? '', r.text ?? '');
      }
    })();

    offset += rows.length;
    const pct = Math.round((offset / total) * 100);
    process.stdout.write(`\r    ${offset.toLocaleString()}/${total.toLocaleString()} (${pct}%)`);
    if (rows.length < BATCH) break;
  }
  console.log(`\n    ${total.toLocaleString()} speaker turns indexed.`);

  // ── 4. Documents (text_content — indexed as available) ───────────────────
  console.log('  4. Document text FTS...');
  db.exec(`DROP TABLE IF EXISTS fts_documents`);
  db.exec(`
    CREATE VIRTUAL TABLE fts_documents USING fts5(
      doc_id UNINDEXED,
      session_id UNINDEXED,
      group_type_desc,
      text_content,
      tokenize='unicode61'
    )
  `);

  const docRows = db.prepare(`
    SELECT id, session_id, group_type_desc, text_content
    FROM session_document
    WHERE text_content IS NOT NULL AND text_content != ''
  `).all() as any[];

  const insertDoc = db.prepare(
    'INSERT INTO fts_documents (doc_id, session_id, group_type_desc, text_content) VALUES (?, ?, ?, ?)'
  );
  db.transaction(() => {
    for (const r of docRows) {
      insertDoc.run(r.id, r.session_id, r.group_type_desc ?? '', r.text_content ?? '');
    }
  })();
  console.log(`    ${docRows.length.toLocaleString()} documents indexed (more will be available after download completes).`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\nFTS indexes built:');
  console.log(`  fts_sessions  : ${sessionRows.length.toLocaleString()} rows`);
  console.log(`  fts_agenda    : ${agendaRows.length.toLocaleString()} rows`);
  console.log(`  fts_turns     : ${total.toLocaleString()} rows`);
  console.log(`  fts_documents : ${docRows.length.toLocaleString()} rows`);

  // Test query
  console.log('\n  Test — searching "רפורמה משפטית" in sessions...');
  const testResults = db.prepare(
    "SELECT session_id, committee_name, date FROM fts_sessions WHERE fts_sessions MATCH 'רפורמה משפטית' LIMIT 5"
  ).all() as any[];
  testResults.forEach(r => console.log(`    ${r.date} | ${r.committee_name} | session ${r.session_id}`));

  db.close();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
