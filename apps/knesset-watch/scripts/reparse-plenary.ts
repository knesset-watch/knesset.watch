/**
 * Re-parses plenary_speaker_turn from stored raw_text in Turso.
 * Fixes: speaker name extraction, faction, topic tagging, mk_id linkage.
 * Does NOT re-download any files — reads raw_text from Turso.
 *
 * Run (test, 3 sessions): npx tsx scripts/reparse-plenary.ts
 * Run (full):             npx tsx scripts/reparse-plenary.ts --all
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@libsql/client';
import Database from 'better-sqlite3';
import path from 'path';

if (!process.env.TURSO_URL) throw new Error('TURSO_URL not set');

const turso = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN ?? '',
});

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const BATCH = 50; // turns per Turso batch insert

// ---------------------------------------------------------------------------
// Tag parsing
// ---------------------------------------------------------------------------

// Matches: << TAG >> CONTENT << TAG >>  (both opening and closing on same line)
const TAG_LINE_RE = /^<<\s*([^>]+?)\s*>>\s*(.*?)\s*<<[^>]*>>\s*$/;

const TURN_START_TAGS = new Set(['דובר', 'יור', 'קריאה']);
const CONTINUE_TAGS = new Set(['דובר_המשך']);
const TOPIC_TAGS = new Set(['נושא']);

interface SpeakerTurn {
  role: string;
  rawName: string;
  speakerName: string;
  faction: string | null;
  mkId: number | null;
  topic: string | null;
  text: string;
  turnIndex: number;
}

function extractNameAndFaction(content: string): { name: string; faction: string | null } {
  // Strip trailing colon
  let raw = content.replace(/:$/, '').trim();

  // Extract faction: "NAME (FACTION)" → name, faction
  const factionMatch = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  let faction: string | null = null;
  if (factionMatch) {
    raw = factionMatch[1].trim();
    faction = factionMatch[2].trim();
  }

  // Strip honorific prefixes (order matters — longer first)
  const prefixes = [
    'חברת הכנסת ', 'חבר הכנסת ',
    'נשיא המדינה ', 'מזכיר הכנסת ', 'ראש הממשלה ',
    'ראש האופוזיציה ', 'שר האוצר ', 'שר הביטחון ',
    'השרה ', 'השר ', 'היו"ר ', 'היו״ר ',
    'ח"כ ', 'ח״כ ', 'סגן ', 'הרב ', "פרופ' ", 'ד"ר ', 'ד״ר ',
  ];
  for (const prefix of prefixes) {
    if (raw.startsWith(prefix)) {
      raw = raw.slice(prefix.length).trim();
      break;
    }
  }

  return { name: raw, faction };
}

function parseTurns(rawText: string, mkIndex: Map<string, number>): SpeakerTurn[] {
  const lines = rawText.split('\n');
  const turns: SpeakerTurn[] = [];

  let currentRole = '';
  let currentRawName = '';
  let currentName = '';
  let currentFaction: string | null = null;
  let currentMkId: number | null = null;
  let currentTopic: string | null = null;
  let currentLines: string[] = [];
  let turnIndex = 0;

  // Track known identities across the session so unnamed turns can be resolved
  let sessionChairMkId: number | null = null;   // mk_id of the session's chairperson
  let sessionChairName = '';
  let sessionChairFaction: string | null = null;

  const flush = () => {
    const text = currentLines.join('\n').trim();
    if (currentRole && text) {
      turns.push({
        role: currentRole,
        rawName: currentRawName,
        speakerName: currentName,
        faction: currentFaction,
        mkId: currentMkId,
        topic: currentTopic,
        text,
        turnIndex: turnIndex++,
      });
    }
    currentLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const tagMatch = trimmed.match(TAG_LINE_RE);

    if (tagMatch) {
      const tag = tagMatch[1].trim();
      const content = tagMatch[2].trim();

      if (TOPIC_TAGS.has(tag)) {
        currentTopic = content.replace(/:$/, '').trim() || null;
      } else if (TURN_START_TAGS.has(tag)) {
        flush();
        currentRole = tag;
        // Speaker names end with ':' and are short — if not, content is speech
        if (content.endsWith(':') && content.length < 100) {
          const { name, faction } = extractNameAndFaction(content);
          currentRawName = content;
          currentName = name;
          currentFaction = faction;
          currentMkId = mkIndex.get(name) ?? null;
          // Remember chairperson identity for the rest of this session
          if (tag === 'יור' && currentMkId) {
            sessionChairMkId = currentMkId;
            sessionChairName = name;
            sessionChairFaction = faction;
          }
        } else {
          // No name in tag line — fall back to known session identity
          if (tag === 'יור' && sessionChairMkId) {
            currentRawName = '';
            currentName = sessionChairName;
            currentFaction = sessionChairFaction;
            currentMkId = sessionChairMkId;
          } else {
            // Truly unknown speaker; treat content as first speech line
            currentRawName = '';
            currentName = '';
            currentFaction = null;
            currentMkId = null;
            if (content) currentLines.push(content);
          }
        }
        // currentTopic carries forward
      } else if (CONTINUE_TAGS.has(tag)) {
        // Same speaker continues — name/faction/mkId all carry forward unchanged
      }
      // IGNORE_TAGS (סיום) and unknowns: do nothing
    } else {
      // Regular speech line — strip any stray << >> markers
      const cleaned = trimmed.replace(/<<[^>]*>>/g, '').trim();
      if (currentRole) {
        currentLines.push(cleaned);
      }
    }
  }

  flush();
  return turns;
}

// ---------------------------------------------------------------------------
// MK index: full name → person_id
// ---------------------------------------------------------------------------

function buildMkIndex(): Map<string, number> {
  const localDb = new Database(DB_PATH, { readonly: true });
  const mks = localDb
    .prepare('SELECT person_id, first_name, last_name FROM mk_person')
    .all() as Array<{ person_id: number; first_name: string; last_name: string }>;
  localDb.close();

  const index = new Map<string, number>();
  for (const mk of mks) {
    const full = `${mk.first_name} ${mk.last_name}`;
    index.set(full, mk.person_id);
    // Also index last name alone (for single-name references), but only if unique
    if (!index.has(mk.last_name)) {
      index.set(mk.last_name, mk.person_id);
    } else {
      // Ambiguous last name — remove it so we don't make wrong matches
      index.delete(mk.last_name);
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// Schema migration
// ---------------------------------------------------------------------------

async function ensureColumns() {
  for (const col of ['topic TEXT', 'faction TEXT']) {
    const [name, type] = col.split(' ');
    try {
      await turso.execute(`ALTER TABLE plenary_speaker_turn ADD COLUMN ${name} ${type}`);
      console.log(`Added column: ${name}`);
    } catch {
      // already exists
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const runAll = process.argv.includes('--all');
  const limit = runAll ? '' : 'LIMIT 3';

  await ensureColumns();

  const mkIndex = buildMkIndex();
  console.log(`MK index: ${mkIndex.size} entries`);

  const sessionsRes = await turso.execute(
    `SELECT id, name FROM plenary_session WHERE raw_text IS NOT NULL ORDER BY id ${limit}`
  );
  console.log(`Sessions to re-parse: ${sessionsRes.rows.length}`);

  let done = 0;
  let totalTurns = 0;
  let matched = 0;
  let errors = 0;

  for (const row of sessionsRes.rows) {
    const sessionId = Number(row.id);
    try {
      // Fetch raw_text for this session (avoid loading all at once)
      const textRes = await turso.execute({
        sql: 'SELECT raw_text FROM plenary_session WHERE id = ?',
        args: [sessionId],
      });
      const rawText = String(textRes.rows[0]?.raw_text ?? '');
      if (!rawText) {
        console.warn(`  Session ${sessionId}: no raw_text`);
        continue;
      }

      const turns = parseTurns(rawText, mkIndex);
      const sessionMatched = turns.filter(t => t.mkId !== null).length;
      matched += sessionMatched;

      // Delete existing turns
      await turso.execute({
        sql: 'DELETE FROM plenary_speaker_turn WHERE session_id = ?',
        args: [sessionId],
      });

      // Insert new turns in batches
      for (let j = 0; j < turns.length; j += BATCH) {
        const slice = turns.slice(j, j + BATCH);
        const stmts = slice.map(t => ({
          sql: `INSERT INTO plenary_speaker_turn
                  (session_id, speaker_name, role, faction, mk_id, topic, text, turn_index)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            sessionId, t.speakerName, t.role, t.faction, t.mkId,
            t.topic, t.text, t.turnIndex,
          ] as (string | number | null)[],
        }));
        await turso.batch(stmts, 'write');
      }

      // Update session turn_count
      await turso.execute({
        sql: 'UPDATE plenary_session SET turn_count = ? WHERE id = ?',
        args: [turns.length, sessionId],
      });

      totalTurns += turns.length;
      done++;
      if (done % 10 === 0 || !runAll) {
        const pct = ((done / sessionsRes.rows.length) * 100).toFixed(1);
        console.log(`[${pct}%] ${done}/${sessionsRes.rows.length} sessions | ${totalTurns.toLocaleString()} turns | ${matched} mk-matched`);
      }
    } catch (err) {
      errors++;
      console.error(`  Error session ${sessionId}: ${(err as Error).message}`);
    }
  }

  console.log(`\nDone. ${done} sessions, ${totalTurns.toLocaleString()} turns, ${matched} mk-matched turns, ${errors} errors`);
}

main().catch(e => { console.error(e); process.exit(1); });
