/**
 * Re-parses plenary_speaker_turn from stored raw_text in Turso.
 * Every turn gets a speaker_type so all speakers are identified entities:
 *   'mk'       — matched to mk_person (mk_id set)
 *   'official' — named non-MK (Knesset secretary, president, minister-only, etc.)
 *   'heckle'   — collective interruption (קריאה/קריאות)
 *   'unknown'  — unnamed/unresolvable
 *
 * ONE SESSION PER INVOCATION — exit 0 = session done, exit 42 = all done.
 * Run via: bash scripts/run-reparse-plenary.sh
 * Tracks progress via reparsed_at column on plenary_session.
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
const BATCH = 50;

// ---------------------------------------------------------------------------
// Tag parsing
// ---------------------------------------------------------------------------

// Matches: << TAG >> CONTENT << TAG >>  (both opening and closing on same line)
const TAG_LINE_RE = /^<<\s*([^>]+?)\s*>>\s*(.*?)\s*<<[^>]*>>\s*$/;

const TURN_START_TAGS = new Set(['דובר', 'יור', 'קריאה']);
const CONTINUE_TAGS = new Set(['דובר_המשך']);
const TOPIC_TAGS = new Set(['נושא']);

// Collective interruptions — not a speaker entity
const HECKLE_NAMES = new Set(['קריאה', 'קריאות', 'רעש', 'מחיאות כפיים', 'צחוק']);

type SpeakerType = 'mk' | 'official' | 'heckle' | 'unknown';

interface SpeakerTurn {
  role: string;
  speakerName: string;
  speakerType: SpeakerType;
  faction: string | null;
  mkId: number | null;
  topic: string | null;
  text: string;
  turnIndex: number;
}

// ---------------------------------------------------------------------------
// Name extraction
// ---------------------------------------------------------------------------

// Strip "שר [MINISTRY] " prefix — handles patterns like "שר התקשורת שלמה קרעי"
const MINISTER_PREFIX_RE = /^ש(?:ר|רת)\s+ה?[\w\s"״'׳-]{1,20}?\s+(?=[א-ת])/;

function extractNameAndFaction(content: string): { name: string; faction: string | null } {
  let raw = content.replace(/:$/, '').trim();

  // Extract faction: "NAME (FACTION)" → name, faction
  const factionMatch = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  let faction: string | null = null;
  if (factionMatch) {
    raw = factionMatch[1].trim();
    faction = factionMatch[2].trim();
  }

  // Strip honorific prefixes (longer first to avoid partial matches)
  const prefixes = [
    'חברת הכנסת ', 'חבר הכנסת ',
    'נשיא המדינה ', 'נשיאת המדינה ',
    'מזכיר הכנסת ', 'מזכירת הכנסת ',
    'ראש הממשלה ', 'ראש האופוזיציה ',
    'ממלא מקום ראש הממשלה ',
    'היו"ר ', 'היו״ר ', 'יו"ר ', 'יו״ר ',
    'השרה ', 'השר ',
    'ח"כ ', 'ח״כ ',
    'סגן ', 'סגנית ',
    'הרב ', "פרופ' ", 'ד"ר ', 'ד״ר ',
  ];
  for (const prefix of prefixes) {
    if (raw.startsWith(prefix)) {
      raw = raw.slice(prefix.length).trim();
      break;
    }
  }

  // Handle "שר [MINISTRY] NAME" format (no ה prefix): "שר התקשורת שלמה קרעי"
  const ministerMatch = raw.match(MINISTER_PREFIX_RE);
  if (ministerMatch) {
    raw = raw.slice(ministerMatch[0].length).trim();
  }

  return { name: raw, faction };
}

function classifySpeaker(
  tag: string,
  name: string,
  rawContent: string,
  mkId: number | null,
): SpeakerType {
  if (!name && !rawContent) return 'unknown';
  // Collective interruptions
  if (HECKLE_NAMES.has(name) || tag === 'קריאה' && !rawContent.endsWith(':')) return 'heckle';
  // Matched MK
  if (mkId !== null) return 'mk';
  // Named but not in mk_person → official/guest
  if (name) return 'official';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function parseTurns(rawText: string, mkIndex: Map<string, number>): SpeakerTurn[] {
  const lines = rawText.split('\n');
  const turns: SpeakerTurn[] = [];

  let currentRole = '';
  let currentName = '';
  let currentSpeakerType: SpeakerType = 'unknown';
  let currentFaction: string | null = null;
  let currentMkId: number | null = null;
  let currentTopic: string | null = null;
  let currentLines: string[] = [];
  let turnIndex = 0;

  // Track known identities for the session
  let sessionChairMkId: number | null = null;
  let sessionChairName = '';
  let sessionChairFaction: string | null = null;

  const flush = () => {
    const text = currentLines.join('\n').trim();
    if (currentRole && (text || currentSpeakerType === 'heckle')) {
      turns.push({
        role: currentRole,
        speakerName: currentName,
        speakerType: currentSpeakerType,
        faction: currentFaction,
        mkId: currentMkId,
        topic: currentTopic,
        text,
        turnIndex: turnIndex++,
      });
    }
    currentLines = [];
  };

  const applyIdentity = (name: string, faction: string | null, mkId: number | null, tag: string, rawContent: string) => {
    currentName = name;
    currentFaction = faction;
    currentMkId = mkId;
    currentSpeakerType = classifySpeaker(tag, name, rawContent, mkId);
    if (tag === 'יור' && mkId) {
      sessionChairMkId = mkId;
      sessionChairName = name;
      sessionChairFaction = faction;
    }
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

        if (content.endsWith(':') && content.length < 120) {
          // Named speaker line: extract name and resolve
          const { name, faction } = extractNameAndFaction(content);
          const mkId = mkIndex.get(name) ?? null;
          applyIdentity(name, faction, mkId, tag, content);

        } else if (tag === 'יור' && sessionChairMkId) {
          // Unnamed יור turn — resolve to known session chairperson
          applyIdentity(sessionChairName, sessionChairFaction, sessionChairMkId, tag, '');
          if (content) currentLines.push(content);

        } else if (tag === 'קריאה' && content && !content.endsWith(':')) {
          // Inline heckle content — content IS the text
          currentName = content.length < 30 ? content : '';
          currentFaction = null;
          currentMkId = null;
          currentSpeakerType = 'heckle';
          if (content) currentLines.push(content);

        } else {
          // Unknown/unnamed speaker
          currentName = '';
          currentFaction = null;
          currentMkId = null;
          currentSpeakerType = 'unknown';
          if (content) currentLines.push(content);
        }

      } else if (CONTINUE_TAGS.has(tag)) {
        // Same speaker continues — all identity fields carry forward unchanged
        if (content.endsWith(':') && content.length < 120) {
          // Occasionally the continuation names the speaker explicitly — update if better
          const { name, faction } = extractNameAndFaction(content);
          const mkId = mkIndex.get(name) ?? null;
          if (mkId && !currentMkId) applyIdentity(name, faction, mkId, tag, content);
        }
      }
      // סיום and unknowns: do nothing

    } else {
      // Regular speech line
      const cleaned = trimmed.replace(/<<[^>]*>>/g, '').trim();
      if (currentRole) currentLines.push(cleaned);
    }
  }

  flush();
  return turns;
}

// ---------------------------------------------------------------------------
// MK index
// ---------------------------------------------------------------------------

function buildMkIndex(): Map<string, number> {
  const localDb = new Database(DB_PATH, { readonly: true });
  const mks = localDb
    .prepare('SELECT person_id, first_name, last_name FROM mk_person')
    .all() as Array<{ person_id: number; first_name: string; last_name: string }>;
  localDb.close();

  const index = new Map<string, number>();
  const lastNameCount = new Map<string, number>();

  for (const mk of mks) {
    const full = `${mk.first_name} ${mk.last_name}`;
    index.set(full, mk.person_id);
    lastNameCount.set(mk.last_name, (lastNameCount.get(mk.last_name) ?? 0) + 1);
  }

  // Add unique last-name entries for single-name references
  for (const mk of mks) {
    if ((lastNameCount.get(mk.last_name) ?? 0) === 1) {
      index.set(mk.last_name, mk.person_id);
    }
  }

  return index;
}

// ---------------------------------------------------------------------------
// Schema migration
// ---------------------------------------------------------------------------

async function ensureColumns() {
  const turnCols = ['topic TEXT', 'faction TEXT', 'speaker_type TEXT'];
  for (const col of turnCols) {
    const [name, type] = col.split(' ');
    try {
      await turso.execute(`ALTER TABLE plenary_speaker_turn ADD COLUMN ${name} ${type}`);
      console.log(`Added column to plenary_speaker_turn: ${name}`);
    } catch {
      // already exists
    }
  }
  try {
    await turso.execute('ALTER TABLE plenary_session ADD COLUMN reparsed_at TEXT');
    console.log('Added column to plenary_session: reparsed_at');
  } catch {
    // already exists
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await ensureColumns();

  const mkIndex = buildMkIndex();

  // Find the first un-reparsed session
  const nextRes = await turso.execute(
    `SELECT id FROM plenary_session WHERE raw_text IS NOT NULL AND reparsed_at IS NULL ORDER BY id ASC LIMIT 1`
  );

  if (nextRes.rows.length === 0) {
    console.log('All plenary sessions reparsed.');
    process.exit(42);
  }

  const sessionId = Number(nextRes.rows[0].id);

  const textRes = await turso.execute({
    sql: 'SELECT raw_text FROM plenary_session WHERE id = ?',
    args: [sessionId],
  });
  const rawText = String(textRes.rows[0]?.raw_text ?? '');
  if (!rawText) {
    console.warn(`Session ${sessionId}: no raw_text, skipping`);
    await turso.execute({
      sql: 'UPDATE plenary_session SET reparsed_at = ? WHERE id = ?',
      args: [new Date().toISOString(), sessionId],
    });
    process.exit(0);
  }

  const turns = parseTurns(rawText, mkIndex);

  await turso.execute({
    sql: 'DELETE FROM plenary_speaker_turn WHERE session_id = ?',
    args: [sessionId],
  });

  for (let j = 0; j < turns.length; j += BATCH) {
    const slice = turns.slice(j, j + BATCH);
    await turso.batch(slice.map(t => ({
      sql: `INSERT INTO plenary_speaker_turn
              (session_id, speaker_name, speaker_type, role, faction, mk_id, topic, text, turn_index)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        sessionId, t.speakerName, t.speakerType, t.role,
        t.faction, t.mkId, t.topic, t.text, t.turnIndex,
      ] as (string | number | null)[],
    })), 'write');
  }

  // Mark session as done and update turn count
  await turso.execute({
    sql: 'UPDATE plenary_session SET turn_count = ?, reparsed_at = ? WHERE id = ?',
    args: [turns.length, new Date().toISOString(), sessionId],
  });

  const byType = turns.reduce((acc, t) => {
    acc[t.speakerType] = (acc[t.speakerType] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log(`Session ${sessionId}: ${turns.length} turns (mk:${byType.mk ?? 0} official:${byType.official ?? 0} heckle:${byType.heckle ?? 0} unknown:${byType.unknown ?? 0})`);
}

main().catch(e => { console.error(e.message ?? e); process.exit(1); });
