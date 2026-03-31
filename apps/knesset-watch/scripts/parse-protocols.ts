// scripts/parse-protocols.ts
// Run: npm run db:parse-protocols
//
// Parses protocol_text for all K25 committee sessions.
// Extracts: header fields, attendance, staff, agenda items, speaker turns, votes.
// Resume-safe: skips sessions where parsed_at IS NOT NULL.
// No HTTP — pure local DB reads. Completes in minutes.

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

const TERM_MAP: Record<string, number> = {
  'ראשון': 1, 'שני': 2, 'שלישי': 3, 'רביעי': 4, 'חמישי': 5,
};

// ── Migrations ────────────────────────────────────────────────────────────────

function migrate(db: Database.Database) {
  const sessionCols = (db.prepare('PRAGMA table_info(committee_session)').all() as any[]).map((c: any) => c.name);
  if (!sessionCols.includes('parsed_at')) {
    db.exec('ALTER TABLE committee_session ADD COLUMN parsed_at TEXT');
    console.log('  Added parsed_at to committee_session.');
  }

  const guestCols = (db.prepare('PRAGMA table_info(session_guest)').all() as any[]).map((c: any) => c.name);
  if (!guestCols.includes('attendance_method')) {
    db.exec("ALTER TABLE session_guest ADD COLUMN attendance_method TEXT DEFAULT 'in_person'");
    console.log('  Added attendance_method to session_guest.');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_agenda_item (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  INTEGER NOT NULL,
      item_number INTEGER,
      title       TEXT NOT NULL,
      item_type   TEXT DEFAULT 'topic'
    );
    CREATE INDEX IF NOT EXISTS idx_agenda_session ON session_agenda_item (session_id);

    CREATE TABLE IF NOT EXISTS session_vote (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    INTEGER NOT NULL,
      vote_number   INTEGER,
      subject       TEXT,
      result        TEXT,
      for_count     INTEGER,
      against_count INTEGER,
      abstain_count INTEGER,
      passed        INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_vote_session ON session_vote (session_id);

    CREATE TABLE IF NOT EXISTS session_speaker_turn (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id   INTEGER NOT NULL,
      turn_number  INTEGER,
      speaker_role TEXT,
      mk_id        INTEGER,
      raw_name     TEXT,
      faction_name TEXT,
      text         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_turn_session ON session_speaker_turn (session_id);
    CREATE INDEX IF NOT EXISTS idx_turn_mk ON session_speaker_turn (mk_id);

    CREATE TABLE IF NOT EXISTS session_staff (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      role       TEXT NOT NULL,
      name_text  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_staff_session ON session_staff (session_id);
  `);
}

// ── MK Name Lookup ────────────────────────────────────────────────────────────

function buildMkMap(db: Database.Database): Map<string, number> {
  const mks = db.prepare('SELECT person_id, first_name, last_name FROM mk_person').all() as any[];
  const map = new Map<string, number>();
  const lastNameCount = new Map<string, number>();

  for (const mk of mks) {
    const full = `${mk.first_name} ${mk.last_name}`.trim();
    map.set(full, mk.person_id);
    lastNameCount.set(mk.last_name, (lastNameCount.get(mk.last_name) ?? 0) + 1);
  }
  // Add last-name-only shortcuts for unique last names
  for (const mk of mks) {
    if ((lastNameCount.get(mk.last_name) ?? 0) === 1 && !map.has(mk.last_name)) {
      map.set(mk.last_name, mk.person_id);
    }
  }
  return map;
}

function stripTitle(name: string): string {
  // Strip simple title prefixes
  let result = name
    .replace(/^(היו"ר|יו"ר|ח"כ|ד"ר|פרופ'?|עו"ד|השר|שר|השרה|שרת|ממלא|הממלא|מ"מ|סגן|הסגן)\s+/, '')
    .replace(/[)]+$/, '') // remove trailing ) artifacts
    .trim();
  // If "הוועדה" (committee) still leads the name, it means the full label was
  // "יו"ר הוועדה X שם" — extract the last 2 words as the person name.
  if (result.startsWith('הוועדה') && result.split(/\s+/).length > 2) {
    const words = result.split(/\s+/).filter(w => w.length > 0);
    result = words.slice(-2).join(' ');
  }
  return result;
}

function resolveMk(raw: string, mkMap: Map<string, number>): number | null {
  const name = stripTitle(raw).replace(/\s*\([^)]*\)/g, '').trim();
  if (mkMap.has(name)) return mkMap.get(name)!;
  // Try last word (last name) as fallback
  const parts = name.split(/\s+/);
  if (parts.length > 1) {
    const lastName = parts[parts.length - 1];
    if (mkMap.has(lastName)) return mkMap.get(lastName)!;
  }
  return null;
}

function extractTime(text: string): string | null {
  const m = text.match(/שעה\s+(\d{1,2}:\d{2})/);
  return m ? m[1] : null;
}

// ── Protocol Parser ────────────────────────────────────────────────────────────

interface ParsedProtocol {
  header: {
    protocol_number?: number;
    session_term?: number;
    start_time?: string;
    end_time?: string;
    attendance_disclaimer?: number;
    is_revision?: number;
  };
  members: Array<{ name: string; role: string; mk_id: number | null }>;
  guests: Array<{ name: string; role: string; org: string; method: string }>;
  staff: Array<{ role: string; name: string }>;
  agendaItems: Array<{ number: number | null; title: string; type: string }>;
  turns: Array<{ role: string; raw_name: string; faction: string; text: string }>;
  votes: Array<{
    subject: string; result: string;
    for_count: number | null; against_count: number | null; abstain_count: number | null;
    passed: number | null;
  }>;
}

function parseAttendance(block: string, result: ParsedProtocol, mkMap: Map<string, number>) {
  const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  let section: 'members' | 'visiting' | 'guests' | 'online' | 'unknown' = 'unknown';

  // For multi-line guest format: name, then –, then org on separate lines
  let pendingGuestName: string | null = null;
  let pendingGuestMethod: string = 'in_person';
  let awaitingOrg = false;

  function flushGuest(org: string = '') {
    if (!pendingGuestName) return;
    const name = pendingGuestName;
    const isMinister = /^(שר|שרת|השר|השרה)\s/.test(name);
    if (isMinister) {
      const cleanName = stripTitle(name).split(/[–,]/)[0].trim();
      const mk_id = resolveMk(cleanName, mkMap);
      result.members.push({ name: cleanName, role: 'minister', mk_id });
    } else {
      result.guests.push({ name: stripTitle(name), role: '', org, method: pendingGuestMethod });
    }
    pendingGuestName = null;
    awaitingOrg = false;
  }

  for (const line of lines) {
    if (line === 'נכחו:' || line === 'נכחו') continue;

    // Section headers
    if (/^חבר[יות]?\s+הוועדה/.test(line)) { flushGuest(); section = 'members'; continue; }
    if (/^חבר[יות]?\s+הכנסת/.test(line)) { flushGuest(); section = 'visiting'; continue; }
    if (/^מוזמנים/.test(line)) { flushGuest(); section = 'guests'; continue; }
    if (/באמצעים מקוונים|באמצעות האינטרנט|מרחוק/.test(line)) {
      flushGuest(); section = 'online'; continue;
    }
    // Skip disclaimer line and other long noise
    if (line.includes('רשימת הנוכחים על תואריהם')) continue;
    if (line.length > 150) continue;
    // Allow single-char lines (e.g. "–" separator) through to the guest handler;
    // apply the > 1 guard only for member/visiting name lines below.

    if (section === 'members') {
      if (line.length < 2) continue;
      // "Name – role" or "Name - role" (on one line) or just "Name"
      const dashEm = line.indexOf('–');
      const dashHyphen = line.indexOf(' - ');
      const dash = dashEm >= 0 ? dashEm : dashHyphen >= 0 ? dashHyphen : -1;
      const name = (dash >= 0 ? line.slice(0, dash) : line).trim();
      const roleText = dash >= 0 ? line.slice(dash + 1).trim() : '';
      const hasChair = result.members.some(m => m.role === 'chair');
      const role = (!hasChair && /יו"ר|יושב.ראש/.test(roleText)) ? 'chair'
        : /מ"מ|סגן|ממלא/.test(roleText) ? 'deputy_chair'
        : 'member';
      const mk_id = resolveMk(name, mkMap);
      if (name) result.members.push({ name, role, mk_id });

    } else if (section === 'visiting') {
      if (line.length < 2) continue;
      const name = line.replace(/\s*\([^)]*\)/g, '').trim();
      const mk_id = resolveMk(name, mkMap);
      if (name) result.members.push({ name, role: 'visitor', mk_id });

    } else if (section === 'guests' || section === 'online') {
      const method = section === 'online' ? 'online' : 'in_person';

      if (line === '–' || line === '-') {
        // Separator — next line is the org description for pendingGuestName
        awaitingOrg = true;
        continue;
      }

      if (awaitingOrg && pendingGuestName) {
        // This line is the org/role description for the pending name
        flushGuest(line);
        continue;
      }

      // Inline format: "Name – org" on one line
      const dashIdx = line.indexOf('–');
      if (dashIdx > 0) {
        flushGuest();
        const name = line.slice(0, dashIdx).trim();
        const org = line.slice(dashIdx + 1).trim();
        const isMinister = /^(שר|שרת|השר|השרה)\s/.test(name);
        if (isMinister) {
          const cleanName = stripTitle(name).split(/[–,]/)[0].trim();
          const mk_id = resolveMk(cleanName, mkMap);
          result.members.push({ name: cleanName, role: 'minister', mk_id });
        } else {
          result.guests.push({ name: stripTitle(name), role: '', org, method });
        }
      } else {
        // Name-only line — buffer it and wait for dash+org
        flushGuest();
        pendingGuestName = line;
        pendingGuestMethod = method;
        awaitingOrg = false;
      }
    }
  }
  flushGuest();
}

function parseProtocol(text: string, mkMap: Map<string, number>): ParsedProtocol {
  const result: ParsedProtocol = {
    header: {}, members: [], guests: [], staff: [], agendaItems: [], turns: [], votes: [],
  };

  // ── Header fields ──────────────────────────────────────────────────────────
  const protNumMatch = text.match(/פרוטוקול\s+מס'?\s*(\d+)/);
  if (protNumMatch) result.header.protocol_number = parseInt(protNumMatch[1]);

  const termMatch = text.match(/מושב\s+(ראשון|שני|שלישי|רביעי|חמישי)/);
  if (termMatch) result.header.session_term = TERM_MAP[termMatch[1]];

  // Find the attendance section header — several variant forms exist
  // "נכחו:" (most common), "נוכחים:" (99 sessions), "נכח:" (singular), "נכחו בישיבה"
  // "נוכחים:" can appear inside speech text, so require it to be on its own line.
  const nkhuPatterns = [
    /(?:^|\n)נכחו[^א-ת\n]*[:–]?\s*\n/,   // נכחו: / נכחו – / נכחו\n
    /(?:^|\n)נכח[^א-ת\n]*:\s*\n/,          // נכח: (singular)
    /(?:^|\n)נוכחים:\s*\n/,                // נוכחים: on its own line
  ];
  let nkhuIdx = -1;
  for (const pat of nkhuPatterns) {
    const m = text.match(pat);
    if (m && m.index !== undefined) {
      const pos = m.index + (m[0].startsWith('\n') ? 1 : 0);
      if (nkhuIdx < 0 || pos < nkhuIdx) nkhuIdx = pos;
    }
  }
  const headerEnd = nkhuIdx > 0 ? nkhuIdx : Math.min(600, text.length);
  const startTime = extractTime(text.slice(0, headerEnd));
  if (startTime) result.header.start_time = startTime;

  // End time — from << סיום >> block
  const closingMatch = text.match(/<< סיום >>([\s\S]*?)<< סיום >>/);
  if (closingMatch) {
    const endTime = extractTime(closingMatch[1]);
    if (endTime) result.header.end_time = endTime;
  }

  if (text.includes('רשימת הנוכחים על תואריהם מבוססת על המידע שהוזן')) {
    result.header.attendance_disclaimer = 1;
  }
  if (text.includes('רוויזיה')) {
    result.header.is_revision = 1;
  }

  // ── Attendance block ───────────────────────────────────────────────────────
  if (nkhuIdx >= 0) {
    // Attendance ends at first << marker AFTER nkhuIdx, or known staff header.
    // Must search from nkhuIdx to avoid matching agenda markers in the header
    // section that appear BEFORE נכחו: in many protocols.
    const afterNkhu = text.slice(nkhuIdx);
    let attendanceEndRelative = afterNkhu.search(/<< (?:יור|דובר|נושא)/);
    let attendanceEnd = attendanceEndRelative >= 0
      ? nkhuIdx + attendanceEndRelative
      : text.length;

    for (const h of ['ייעוץ משפטי:', 'מנהלת הוועדה:', 'מנהל הוועדה:', 'רישום פרלמנטרי:']) {
      const idx = text.indexOf(h, nkhuIdx);
      if (idx > nkhuIdx && idx < attendanceEnd) attendanceEnd = idx;
    }

    parseAttendance(text.slice(nkhuIdx, attendanceEnd), result, mkMap);
  }

  // ── Staff ─────────────────────────────────────────────────────────────────
  const staffDefs = [
    { header: 'ייעוץ משפטי:', role: 'legal_counsel' },
    { header: 'מנהלת הוועדה:', role: 'manager' },
    { header: 'מנהל הוועדה:', role: 'manager' },
    { header: 'מנהלי הוועדה:', role: 'manager' },          // plural (joint committees)
    { header: 'סגן מנהל הוועדה:', role: 'manager' },
    { header: 'מ"מ מנהל הוועדה:', role: 'manager' },
    { header: 'מ"מ מנהלת הוועדה:', role: 'manager' },
    { header: 'מ"מ מנהל/ת הוועדה:', role: 'manager' },
    { header: 'רישום פרלמנטרי:', role: 'writer' },
    { header: 'רכזי תחום פרלמנטרי:', role: 'writer' },
    { header: 'מתרגמת:', role: 'translator' },
    { header: 'מתרגם:', role: 'translator' },
  ];

  // Labels that appear in staff blocks but are role descriptions, not person names
  const staffNonNames = new Set(['חבר תרגומים', 'חבר תרגום', 'צוות תרגום']);

  for (const { header, role } of staffDefs) {
    // Use regex to find the header at the start of a line (not as substring of another header,
    // e.g. "מנהל הוועדה:" must not match inside "סגן מנהל הוועדה:")
    const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const headerMatch = text.match(new RegExp('(?:^|\\n)' + escaped));
    if (!headerMatch || headerMatch.index === undefined) continue;
    const idx = headerMatch.index + (headerMatch[0].startsWith('\n') ? 1 : 0);
    const contentStart = idx + header.length;
    // Find end of this staff block: next staff section header, or triple newline, or << marker
    const otherHeaders = staffDefs.map(s => s.header).filter(h => h !== header);
    let blockEnd = text.length;
    for (const h of [...otherHeaders, 'רשימת הנוכחים']) {
      const hIdx = text.indexOf(h, contentStart);
      if (hIdx > contentStart && hIdx < blockEnd) blockEnd = hIdx;
    }
    const markerIdx = text.indexOf('<<', contentStart);
    if (markerIdx > contentStart && markerIdx < blockEnd) blockEnd = markerIdx;
    // Triple newline also ends the block
    const tripleNl = text.indexOf('\n\n\n', contentStart);
    if (tripleNl > contentStart && tripleNl < blockEnd) blockEnd = tripleNl;

    const block = text.slice(contentStart, blockEnd).trim();
    for (const line of block.split('\n')) {
      // Some lines contain multiple names separated by semicolons
      const segments = line.split(';');
      for (const seg of segments) {
        const trimmed = seg.trim();
        // Extract just the name part (before first comma or em-dash which often has the title)
        const name = trimmed.split(',')[0].split(' – ')[0].split(' - ')[0].trim();
        if (name && name.length > 1 && name.length < 80 && !staffNonNames.has(name)) {
          result.staff.push({ role, name });
        }
      }
    }
  }

  // ── Agenda items from << נושא >> markers ──────────────────────────────────
  const topicRe = /<< נושא >>([\s\S]*?)<< נושא >>/g;
  const seenTitles = new Set<string>();
  for (const m of text.matchAll(topicRe)) {
    const raw = m[1].trim();
    const title = raw.replace(/^\s*\d+\.\s*/, '').trim();
    if (!title || title.length < 3 || seenTitles.has(title)) continue;
    seenTitles.add(title);
    const numMatch = raw.match(/^\s*(\d+)\./);
    result.agendaItems.push({
      number: numMatch ? parseInt(numMatch[1]) : null,
      title,
      type: 'topic',
    });
  }

  // ── Speaker turns — two-pass extraction ──────────────────────────────────
  const markerTypes = 'יור|דובר|אורח|דובר_המשך|מנהל|קריאה';

  // Pre-process step 1a: fix malformed single-< markers: "< TYPE >>" → "<< TYPE >>"
  // These occur when mammoth extracts certain DOC formatting as a single < instead of <<.
  let normalizedText = text.replace(
    new RegExp(`(?<![<])< (${markerTypes}) >>`, 'g'),
    '<< $1 >>'
  );
  // Also fix at line start (lookbehind can't match start-of-line in all JS versions)
  normalizedText = normalizedText.replace(
    new RegExp(`^< (${markerTypes}) >>`, 'gm'),
    '<< $1 >>'
  );

  // Pre-process step 1b: fix lines where opening << was stripped to just >>
  // Pattern: ">> NAME: << TYPE >>" → "<< TYPE >> NAME: << TYPE >>"
  // The closing marker tells us which TYPE the header should be.
  normalizedText = normalizedText.replace(
    new RegExp(`^>>\\s+(.+?)(<<\\s*(${markerTypes})\\s*>>)\\s*$`, 'gm'),
    `<< $3 >> $1$2`
  );

  // Pre-process step 2: normalize double markers like << דובר >> << יור >> → << יור >>
  // These artifacts appear when mammoth extracts a revision-marked line from DOC.
  normalizedText = normalizedText.replace(
    new RegExp(`<< (?:${markerTypes}) >>\\s*(<< (?:${markerTypes}) >>)`, 'g'),
    '$1'
  );

  // Pass 1: find all turn header positions.
  // Each header is: << TYPE >> Name (faction): << TYPE >>
  // The speech text lives AFTER the closing marker, not between the markers.
  const headerRe = new RegExp(`<< (${markerTypes}) >>([\\s\\S]*?)<< \\1 >>`, 'g');
  const turnHeaders: Array<{ type: string; headerContent: string; headerEnd: number }> = [];
  for (const m of normalizedText.matchAll(headerRe)) {
    turnHeaders.push({ type: m[1], headerContent: m[2], headerEnd: m.index! + m[0].length });
  }

  // Pass 2: speech text = content from end of this header to start of next header
  for (let i = 0; i < turnHeaders.length; i++) {
    const { type, headerContent, headerEnd } = turnHeaders[i];

    // Find where the next header's opening marker starts
    const nextHeaderStart = i + 1 < turnHeaders.length
      ? normalizedText.indexOf(`<< ${turnHeaders[i + 1].type} >>`, headerEnd)
      : normalizedText.length;
    const speechText = normalizedText.slice(headerEnd, nextHeaderStart).trim();

    if (type === 'קריאה') {
      const cleaned = speechText.replace(/^קריאה:\s*/i, '').trim();
      if (cleaned) result.turns.push({ role: 'interjection', raw_name: 'קריאה', faction: '', text: cleaned });
      continue;
    }

    // Header content is "Name (faction):" or "היו"ר Name:"
    const colonIdx = headerContent.indexOf(':');
    if (colonIdx < 0) continue;
    const speakerRaw = headerContent.slice(0, colonIdx).trim();

    const factionMatch = speakerRaw.match(/\(([^)]+)\)/);
    const faction = factionMatch ? factionMatch[1] : '';
    const rawName = stripTitle(speakerRaw.replace(/\s*\([^)]*\)/g, '').trim());

    // Skip turns where the header is garbled:
    // - too long (> 80 chars)
    // - contains protocol markers
    // - contains newlines (speech text spanning lines is never a valid name)
    // - looks like a sentence (". " or "? " or "! " or ends with those)
    if (rawName.length > 80 || rawName.includes('<<') || rawName.includes('>>') ||
        rawName.includes('\n') || /[.!?]\s/.test(rawName) || /[.!?]$/.test(rawName) ||
        rawName.includes(', ') || /\d/.test(rawName) ||
        rawName.split(/\s+/).length > 5) continue;

    const role = type === 'יור' ? 'chair'
      : type === 'אורח' ? 'guest'
      : type === 'מנהל' ? 'manager'
      : 'member';

    result.turns.push({ role, raw_name: rawName, faction, text: speechText });
  }

  // ── Votes ─────────────────────────────────────────────────────────────────
  // Collect agenda item titles as candidates for vote subjects
  const agendaTitles = result.agendaItems.map(a => a.title);

  // Extract counts from a text window (handles both "6 בעד" and "? 6. מי נגד" patterns)
  function extractCounts(window: string): { for_count: number | null; against_count: number | null; abstain_count: number | null } {
    const forMatch = window.match(/(\d+)\s+בעד/) ?? window.match(/בעד[^?]*\?\s*(\d+)/);
    const againstMatch = window.match(/(\d+)\s+נגד/) ?? window.match(/נגד\s*\?\s*(\d+)/);
    const abstainMatch = window.match(/(\d+)\s+נמנע/) ?? window.match(/נמנע\s*\?\s*(\d+)/);
    return {
      for_count: forMatch ? parseInt(forMatch[1]) : null,
      against_count: againstMatch ? parseInt(againstMatch[1]) : null,
      abstain_count: abstainMatch ? parseInt(abstainMatch[1]) : null,
    };
  }

  // Use ^הצבעה with multiline flag so only standalone "הצבעה" lines match,
  // not occurrences inside sentences like "ללא הצבעה במליאת הכנסת"
  const voteRe = /^הצבעה[.!]?[ \t]*\n+([\s\S]{0,300}?)(?=\n\n\n|<<|^הצבעה|$)/gm;
  for (const m of text.matchAll(voteRe)) {
    const voteText = m[1].trim();
    if (!voteText) continue;

    const passed = /אושר/.test(voteText) ? 1 : /נדח/.test(voteText) ? 0 : null;

    // Look for counts in the vote block itself, and also in the 600 chars before it
    // (counts are often in the preceding speech: "מי בעד? 6. מי נגד? 2.")
    const precedingContext = text.slice(Math.max(0, m.index! - 600), m.index!);
    const combinedWindow = precedingContext + '\n' + voteText;
    const { for_count, against_count, abstain_count } = extractCounts(combinedWindow);

    // Try to find a subject:
    // 1. Explicit non-result line in the vote block
    const subjectLine = voteText.split('\n').find(l =>
      l.trim().length > 5 && !/אושר|נדח|בעד|נגד|נמנע|\d/.test(l)
    )?.trim() ?? null;
    // 2. Last << נושא >> topic marker before this vote position
    let lastTopicBeforeVote: string | null = null;
    const topicSearchText = text.slice(0, m.index!);
    const topicRe2 = /<< נושא >>([\s\S]*?)<< נושא >>/g;
    for (const tm of topicSearchText.matchAll(topicRe2)) {
      lastTopicBeforeVote = tm[1].replace(/^\s*\d+\.\s*/, '').trim();
    }
    // 3. Single agenda item fallback
    const subject = subjectLine ?? lastTopicBeforeVote ?? (agendaTitles.length === 1 ? agendaTitles[0] : null);

    result.votes.push({
      subject: subject ?? '',
      result: voteText.slice(0, 150),
      for_count,
      against_count,
      abstain_count,
      passed,
    });
  }

  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  console.log('Parse Protocols');
  console.log('  Migrations...');
  migrate(db);

  const mkMap = buildMkMap(db);
  const mkCount = (db.prepare('SELECT COUNT(*) as c FROM mk_person').get() as any).c;
  console.log(`  MK lookup: ${mkMap.size} name variants for ${mkCount} MKs`);

  const sessions = db.prepare(`
    SELECT id FROM committee_session
    WHERE protocol_text IS NOT NULL AND length(protocol_text) > 10
      AND parsed_at IS NULL
    ORDER BY id ASC
  `).all() as { id: number }[];

  console.log(`  Sessions to parse: ${sessions.length.toLocaleString()}`);
  if (sessions.length === 0) {
    console.log('  All sessions already parsed.');
    db.close();
    return;
  }

  // ── Prepared statements ───────────────────────────────────────────────────
  const getText = db.prepare('SELECT protocol_text FROM committee_session WHERE id = ?');

  const updateHeader = db.prepare(`
    UPDATE committee_session
    SET protocol_number = ?, session_term = ?, start_time = ?, end_time = ?,
        attendance_disclaimer = ?, is_revision = ?, parsed_at = datetime('now')
    WHERE id = ?
  `);
  const markParsed = db.prepare("UPDATE committee_session SET parsed_at = datetime('now') WHERE id = ?");

  const insertAttendance = db.prepare(
    'INSERT OR IGNORE INTO committee_attendance (session_id, mk_id, role) VALUES (?, ?, ?)'
  );
  const insertGuest = db.prepare(`
    INSERT INTO session_guest (session_id, name, role, organization, attendance_method)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertStaff = db.prepare(
    'INSERT INTO session_staff (session_id, role, name_text) VALUES (?, ?, ?)'
  );
  const insertAgenda = db.prepare(
    'INSERT INTO session_agenda_item (session_id, item_number, title, item_type) VALUES (?, ?, ?, ?)'
  );
  const insertTurn = db.prepare(`
    INSERT INTO session_speaker_turn (session_id, turn_number, speaker_role, mk_id, raw_name, faction_name, text)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertVote = db.prepare(`
    INSERT INTO session_vote (session_id, vote_number, subject, result, for_count, against_count, abstain_count, passed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Cleanup (idempotent re-runs)
  const clearAttendance = db.prepare('DELETE FROM committee_attendance WHERE session_id = ?');
  const clearGuest = db.prepare('DELETE FROM session_guest WHERE session_id = ?');
  const clearStaff = db.prepare('DELETE FROM session_staff WHERE session_id = ?');
  const clearAgenda = db.prepare('DELETE FROM session_agenda_item WHERE session_id = ?');
  const clearTurns = db.prepare('DELETE FROM session_speaker_turn WHERE session_id = ?');
  const clearVotes = db.prepare('DELETE FROM session_vote WHERE session_id = ?');

  // ── Process in batches ────────────────────────────────────────────────────
  const BATCH = 200;
  let done = 0;
  let errors = 0;

  for (let i = 0; i < sessions.length; i += BATCH) {
    const batch = sessions.slice(i, i + BATCH);

    db.transaction(() => {
      for (const { id } of batch) {
        try {
          const row = getText.get(id) as { protocol_text: string } | undefined;
          if (!row?.protocol_text) { markParsed.run(id); done++; return; }

          const parsed = parseProtocol(row.protocol_text, mkMap);

          // Clear existing data for this session
          clearAttendance.run(id);
          clearGuest.run(id);
          clearStaff.run(id);
          clearAgenda.run(id);
          clearTurns.run(id);
          clearVotes.run(id);

          // Write header fields
          updateHeader.run(
            parsed.header.protocol_number ?? null,
            parsed.header.session_term ?? null,
            parsed.header.start_time ?? null,
            parsed.header.end_time ?? null,
            parsed.header.attendance_disclaimer ?? 0,
            parsed.header.is_revision ?? 0,
            id
          );

          // Committee members + visiting MKs
          for (const m of parsed.members) {
            if (m.mk_id) {
              insertAttendance.run(id, m.mk_id, m.role);
            } else if (m.role === 'visitor') {
              // Unresolved visiting MK — store in guests for traceability
              insertGuest.run(id, m.name, 'unresolved_mk', '', 'in_person');
            }
            // Unresolved committee members are silently dropped — they may be ex-MKs
          }

          // External guests
          for (const g of parsed.guests) {
            insertGuest.run(id, g.name, g.role || null, g.org || '', g.method);
          }

          // Staff
          for (const s of parsed.staff) {
            if (s.name.length > 1) insertStaff.run(id, s.role, s.name);
          }

          // Agenda items (deduplicated by title in parseProtocol)
          for (const a of parsed.agendaItems) {
            insertAgenda.run(id, a.number, a.title, a.type);
          }

          // Speaker turns — no cap, full text
          let turnNum = 0;
          for (const t of parsed.turns) {
            const mk_id = t.raw_name && t.raw_name !== 'קריאה' ? resolveMk(t.raw_name, mkMap) : null;
            insertTurn.run(
              id, ++turnNum, t.role,
              mk_id, t.raw_name || null, t.faction || null,
              t.text || null
            );
          }

          // Votes
          let voteNum = 0;
          for (const v of parsed.votes) {
            insertVote.run(
              id, ++voteNum, v.subject || null, v.result || null,
              v.for_count, v.against_count, v.abstain_count, v.passed
            );
          }

          done++;
        } catch (_err) {
          errors++;
          markParsed.run(id); // mark so we don't retry broken sessions
        }
      }
    })();

    if ((i + BATCH) % 1000 === 0 || i + BATCH >= sessions.length) {
      const pct = Math.round(((i + BATCH) / sessions.length) * 100);
      process.stdout.write(`\r    ${done + errors}/${sessions.length} (${pct}%) — ${errors} errors`);
    }
  }

  console.log('\n');

  // ── Final stats ───────────────────────────────────────────────────────────
  const stat = (table: string) =>
    (db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as any).c.toLocaleString();

  console.log('Results:');
  console.log(`  committee_attendance rows : ${stat('committee_attendance')}`);
  console.log(`  session_guest rows        : ${stat('session_guest')}`);
  console.log(`  session_staff rows        : ${stat('session_staff')}`);
  console.log(`  session_agenda_item rows  : ${stat('session_agenda_item')}`);
  console.log(`  session_speaker_turn rows : ${stat('session_speaker_turn')}`);
  console.log(`  session_vote rows         : ${stat('session_vote')}`);

  const headerStats = db.prepare(`
    SELECT
      COUNT(CASE WHEN protocol_number IS NOT NULL THEN 1 END) as with_num,
      COUNT(CASE WHEN start_time IS NOT NULL THEN 1 END) as with_start,
      COUNT(CASE WHEN end_time IS NOT NULL THEN 1 END) as with_end,
      COUNT(CASE WHEN attendance_disclaimer = 1 THEN 1 END) as with_disclaimer
    FROM committee_session WHERE parsed_at IS NOT NULL
  `).get() as any;

  console.log('\n  Header field coverage (parsed sessions):');
  console.log(`    protocol_number : ${headerStats.with_num.toLocaleString()}`);
  console.log(`    start_time      : ${headerStats.with_start.toLocaleString()}`);
  console.log(`    end_time        : ${headerStats.with_end.toLocaleString()}`);
  console.log(`    disclaimer      : ${headerStats.with_disclaimer.toLocaleString()}`);

  db.close();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
