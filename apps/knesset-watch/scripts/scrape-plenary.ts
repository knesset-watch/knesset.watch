/**
 * Scrapes plenary session DOCX protocols, extracts speaker turns,
 * and upserts them into Turso.
 *
 * Run (test, 3 sessions): npx tsx scripts/scrape-plenary.ts
 * Run (full):             npx tsx scripts/scrape-plenary.ts --all
 *
 * Resume-safe: skips sessions where last_scraped IS NOT NULL in Turso.
 * Reads session list from local knesset.db.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@libsql/client';
import Database from 'better-sqlite3';
import mammoth from 'mammoth';
import path from 'path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CONCURRENCY = 3;
const BATCH_DELAY_MS = 500;
const DB_PATH = path.join(process.cwd(), 'knesset.db');

// ---------------------------------------------------------------------------
// Speaker turn parsing
// ---------------------------------------------------------------------------
// Only << יור >> and << דובר >> start a new speaker turn
const NEW_TURN_RE = /<<\s*(יור|דובר)\s*>>/;
// Strip ALL << ... >> markers — note: \w doesn't match Hebrew, so use [^>] instead
const STRIP_MARKERS_RE = /<<[^>]*>>/g;

interface SpeakerTurn {
  role: string;
  speakerName: string;
  text: string;
  turnIndex: number;
}

function parseSpeakerTurns(text: string): SpeakerTurn[] {
  const lines = text.split('\n');
  const turns: SpeakerTurn[] = [];
  let currentRole = '';
  let currentName = '';
  let currentLines: string[] = [];
  let turnIndex = 0;
  let expectingName = false;

  const flush = () => {
    if (currentRole && currentLines.length > 0) {
      turns.push({
        role: currentRole,
        speakerName: currentName,
        text: currentLines.join('\n').trim(),
        turnIndex: turnIndex++,
      });
    }
  };

  for (const line of lines) {
    const newTurn = line.match(NEW_TURN_RE);
    if (newTurn) {
      // << יור >> or << דובר >> — start a fresh speaker turn
      flush();
      currentRole = newTurn[1];
      currentName = '';
      currentLines = [];
      expectingName = true;
    } else {
      // Strip all << ... >> markers from the line, then process the remainder
      const cleaned = line.replace(STRIP_MARKERS_RE, '').trim();
      if (expectingName && cleaned) {
        currentName = cleaned;
        expectingName = false;
      } else if (!expectingName && currentRole) {
        currentLines.push(line.replace(STRIP_MARKERS_RE, ''));
      }
    }
  }
  flush();
  return turns;
}

// ---------------------------------------------------------------------------
// Local session type
// ---------------------------------------------------------------------------
interface LocalSession {
  id: number;
  session_number: number | null;
  knesset_num: number | null;
  name: string | null;
  start_date: string | null;
  protocol_url: string;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!process.env.TURSO_URL) throw new Error('TURSO_URL not set');

  const runAll = process.argv.includes('--all');
  const limit = runAll ? '' : 'LIMIT 3';

  // Open local DB
  const localDb = new Database(DB_PATH, { readonly: true });
  const sessions = localDb
    .prepare(
      `SELECT id, session_number, knesset_num, name, start_date, protocol_url
       FROM plenary_session
       WHERE has_protocol = 1 AND protocol_url IS NOT NULL
       ORDER BY id
       ${limit}`
    )
    .all() as LocalSession[];

  localDb.close();

  console.log(`Found ${sessions.length} sessions to process${runAll ? '' : ' (test mode — pass --all for full run)'}.`);

  // Connect to Turso
  const turso = createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_TOKEN,
  });

  // Load already-scraped session IDs from Turso
  const scrapedResult = await turso.execute(
    'SELECT id FROM plenary_session WHERE last_scraped IS NOT NULL'
  );
  const scrapedIds = new Set(scrapedResult.rows.map(r => Number(r.id)));
  console.log(`Already scraped in Turso: ${scrapedIds.size}`);

  const pending = sessions.filter(s => !scrapedIds.has(s.id));
  console.log(`Pending: ${pending.length}`);

  if (pending.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  let done = 0;
  let errors = 0;

  // Process in batches of CONCURRENCY
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const batch = pending.slice(i, i + CONCURRENCY);

    await Promise.all(batch.map(session => scrapeSession(turso, session)));

    done += batch.length;
    process.stdout.write(`\r  Processed ${done}/${pending.length} sessions (${errors} errors)`);

    if (i + CONCURRENCY < pending.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  console.log(`\n\nDone. Scraped ${done} sessions, ${errors} errors.`);

  async function scrapeSession(
    turso: ReturnType<typeof createClient>,
    session: LocalSession
  ) {
    try {
      // 1. Download DOCX
      const res = await fetch(session.protocol_url);
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${session.protocol_url}`);
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // 2. Extract text via mammoth
      const { value: text } = await mammoth.extractRawText({ buffer });

      // 3. Parse speaker turns
      const turns = parseSpeakerTurns(text);

      if (turns.length === 0) {
        console.log(`\n  Session ${session.id}: no speaker turns found`);
      }

      // 4. Count words across all turns
      const wordCount = turns.reduce((acc, t) => {
        return acc + t.text.split(/\s+/).filter(Boolean).length;
      }, 0);

      // 5. Delete existing turns (safe re-run)
      await turso.execute({
        sql: 'DELETE FROM plenary_speaker_turn WHERE session_id = ?',
        args: [session.id],
      });

      // 6. Insert turns in batches (Turso has statement limits)
      const INSERT_BATCH = 50;
      for (let j = 0; j < turns.length; j += INSERT_BATCH) {
        const slice = turns.slice(j, j + INSERT_BATCH);
        const stmts = slice.map(t => ({
          sql: `INSERT INTO plenary_speaker_turn (session_id, speaker_name, role, mk_id, text, turn_index)
                VALUES (?, ?, ?, NULL, ?, ?)`,
          args: [session.id, t.speakerName, t.role, t.text, t.turnIndex] as (string | number | null)[],
        }));
        await turso.batch(stmts, 'write');
      }

      // 7. Upsert session metadata into Turso — done AFTER turns are written so
      //    last_scraped is only stamped when the session is fully committed.
      await turso.execute({
        sql: `INSERT INTO plenary_session (id, session_number, knesset_num, name, start_date, protocol_url, turn_count, word_count, last_scraped)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                turn_count = excluded.turn_count,
                word_count = excluded.word_count,
                last_scraped = excluded.last_scraped`,
        args: [
          session.id,
          session.session_number ?? null,
          session.knesset_num ?? null,
          session.name ?? null,
          session.start_date ?? null,
          session.protocol_url,
          turns.length,
          wordCount,
          new Date().toISOString(),
        ],
      });
    } catch (err) {
      errors++;
      console.error(`\n  Error processing session ${session.id}: ${(err as Error).message}`);
    }
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
