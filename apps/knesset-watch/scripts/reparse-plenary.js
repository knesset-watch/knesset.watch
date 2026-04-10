/**
 * Re-parses plenary_speaker_turn from stored raw_text in Turso.
 * ONE SESSION PER INVOCATION — exit 0 = done, exit 42 = all done.
 * Run via: bash scripts/run-reparse-plenary.sh
 */
'use strict';
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
const { createClient } = require('@libsql/client');

if (!process.env.TURSO_URL) { console.error('TURSO_URL not set'); process.exit(1); }

const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN ?? '' });
const BATCH = 50;

// ---------------------------------------------------------------------------
// Tag parsing
// ---------------------------------------------------------------------------

const TAG_LINE_RE = /^<<\s*([^>]+?)\s*>>\s*(.*?)\s*<<[^>]*>>\s*$/;
const TURN_START_TAGS = new Set(['דובר', 'יור', 'קריאה']);
const CONTINUE_TAGS = new Set(['דובר_המשך']);
const TOPIC_TAGS = new Set(['נושא']);
const HECKLE_NAMES = new Set(['קריאה', 'קריאות', 'רעש', 'מחיאות כפיים', 'צחוק']);

const MINISTER_PREFIX_RE = /^ש(?:ר|רת)\s+ה?[\w\s"״'׳-]{1,20}?\s+(?=[א-ת])/;

function extractNameAndFaction(content) {
  let raw = content.replace(/:$/, '').trim();
  const factionMatch = raw.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  let faction = null;
  if (factionMatch) {
    raw = factionMatch[1].trim();
    faction = factionMatch[2].trim();
  }
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
  const ministerMatch = raw.match(MINISTER_PREFIX_RE);
  if (ministerMatch) raw = raw.slice(ministerMatch[0].length).trim();
  return { name: raw, faction };
}

function classifySpeaker(tag, name, rawContent, mkId) {
  if (!name && !rawContent) return 'unknown';
  if (HECKLE_NAMES.has(name) || (tag === 'קריאה' && !rawContent.endsWith(':'))) return 'heckle';
  if (mkId !== null) return 'mk';
  if (name) return 'official';
  return 'unknown';
}

function parseTurns(rawText, mkIndex) {
  const lines = rawText.split('\n');
  const turns = [];
  let currentRole = '', currentName = '', currentSpeakerType = 'unknown';
  let currentFaction = null, currentMkId = null, currentTopic = null;
  let currentLines = [], turnIndex = 0;
  let sessionChairMkId = null, sessionChairName = '', sessionChairFaction = null;

  const flush = () => {
    const text = currentLines.join('\n').trim();
    if (currentRole && (text || currentSpeakerType === 'heckle')) {
      turns.push({ role: currentRole, speakerName: currentName, speakerType: currentSpeakerType,
        faction: currentFaction, mkId: currentMkId, topic: currentTopic, text, turnIndex: turnIndex++ });
    }
    currentLines = [];
  };

  const applyIdentity = (name, faction, mkId, tag, rawContent) => {
    currentName = name; currentFaction = faction; currentMkId = mkId;
    currentSpeakerType = classifySpeaker(tag, name, rawContent, mkId);
    if (tag === 'יור' && mkId) { sessionChairMkId = mkId; sessionChairName = name; sessionChairFaction = faction; }
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
          const { name, faction } = extractNameAndFaction(content);
          const mkId = mkIndex.get(name) ?? null;
          applyIdentity(name, faction, mkId, tag, content);
        } else if (tag === 'יור' && sessionChairMkId) {
          applyIdentity(sessionChairName, sessionChairFaction, sessionChairMkId, tag, '');
          if (content) currentLines.push(content);
        } else if (tag === 'קריאה' && content && !content.endsWith(':')) {
          currentName = content.length < 30 ? content : '';
          currentFaction = null; currentMkId = null; currentSpeakerType = 'heckle';
          if (content) currentLines.push(content);
        } else {
          currentName = ''; currentFaction = null; currentMkId = null; currentSpeakerType = 'unknown';
          if (content) currentLines.push(content);
        }
      } else if (CONTINUE_TAGS.has(tag)) {
        if (content.endsWith(':') && content.length < 120) {
          const { name, faction } = extractNameAndFaction(content);
          const mkId = mkIndex.get(name) ?? null;
          if (mkId && !currentMkId) applyIdentity(name, faction, mkId, tag, content);
        }
      }
    } else {
      const cleaned = trimmed.replace(/<<[^>]*>>/g, '').trim();
      if (currentRole) currentLines.push(cleaned);
    }
  }
  flush();
  return turns;
}

// ---------------------------------------------------------------------------
// MK index — read from Turso
// ---------------------------------------------------------------------------

async function buildMkIndex() {
  const res = await db.execute('SELECT person_id, first_name, last_name FROM mk_person');
  const index = new Map();
  const lastNameCount = new Map();
  const mks = res.rows.map(r => ({ person_id: Number(r.person_id), first_name: String(r.first_name ?? ''), last_name: String(r.last_name ?? '') }));
  for (const mk of mks) {
    index.set(`${mk.first_name} ${mk.last_name}`, mk.person_id);
    lastNameCount.set(mk.last_name, (lastNameCount.get(mk.last_name) ?? 0) + 1);
  }
  for (const mk of mks) {
    if ((lastNameCount.get(mk.last_name) ?? 0) === 1) index.set(mk.last_name, mk.person_id);
  }
  return index;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const mkIndex = await buildMkIndex();

  const nextRes = await db.execute(
    'SELECT id FROM plenary_session WHERE raw_text IS NOT NULL AND reparsed_at IS NULL ORDER BY id ASC LIMIT 1'
  );
  if (nextRes.rows.length === 0) {
    console.log('All plenary sessions reparsed.');
    process.exit(42);
  }

  const sessionId = Number(nextRes.rows[0].id);

  const textRes = await db.execute({ sql: 'SELECT raw_text FROM plenary_session WHERE id = ?', args: [sessionId] });
  const rawText = String(textRes.rows[0]?.raw_text ?? '');
  if (!rawText) {
    await db.execute({ sql: 'UPDATE plenary_session SET reparsed_at = ? WHERE id = ?', args: [new Date().toISOString(), sessionId] });
    process.exit(0);
  }

  const turns = parseTurns(rawText, mkIndex);

  await db.execute({ sql: 'DELETE FROM plenary_speaker_turn WHERE session_id = ?', args: [sessionId] });

  for (let j = 0; j < turns.length; j += BATCH) {
    const slice = turns.slice(j, j + BATCH);
    await db.batch(slice.map(t => ({
      sql: `INSERT INTO plenary_speaker_turn (session_id, speaker_name, speaker_type, role, faction, mk_id, topic, text, turn_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [sessionId, t.speakerName, t.speakerType, t.role, t.faction, t.mkId, t.topic, t.text, t.turnIndex],
    })), 'write');
  }

  await db.execute({ sql: 'UPDATE plenary_session SET turn_count = ?, reparsed_at = ? WHERE id = ?', args: [turns.length, new Date().toISOString(), sessionId] });

  const byType = turns.reduce((acc, t) => { acc[t.speakerType] = (acc[t.speakerType] ?? 0) + 1; return acc; }, {});
  console.log(`Session ${sessionId}: ${turns.length} turns (mk:${byType.mk ?? 0} official:${byType.official ?? 0} heckle:${byType.heckle ?? 0} unknown:${byType.unknown ?? 0})`);
}

// Kill the process if any DB operation hangs (e.g. Turso connection limit hit)
const GLOBAL_TIMEOUT = setTimeout(() => {
  console.error('Timeout: DB connection may be saturated, retrying...');
  process.exit(1);
}, 30_000);
GLOBAL_TIMEOUT.unref(); // don't prevent natural exit

main()
  .then(() => { clearTimeout(GLOBAL_TIMEOUT); })
  .catch(e => { console.error(e.message ?? String(e)); process.exit(1); });
