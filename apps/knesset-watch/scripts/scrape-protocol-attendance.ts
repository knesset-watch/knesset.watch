// scripts/scrape-protocol-attendance.ts
// Run: npm run db:scrape-protocol-attendance
//
// Builds a knowledge graph of committee session attendance by:
//   1. Bulk-fetching all protocol file paths from OData (KNS_DocumentCommitteeSession, GroupTypeID=23)
//      → much faster than per-session WebSiteApi calls
//   2. Downloading each DOCX protocol
//   3. Parsing the "נכחו:" attendance section
//   4. Writing MK attendance → committee_attendance  (role: member | visitor)
//      Writing guests (officials, lobbyists, etc.) → session_guest
//      Writing session→bill links → session_bill (from KNS_CmtSessionItem)
//
// Resumable: sessions with protocol_url already set are skipped in phase 1.
//            Sessions already in committee_attendance/session_guest are skipped in phase 2.

import Database from 'better-sqlite3';
import mammoth from 'mammoth';
import path from 'path';
import fs from 'fs';

const ODATA_API = 'https://knesset.gov.il/OdataV4/ParliamentInfo';
const DB_PATH = path.join(process.cwd(), 'knesset.db');
const PROTOCOLS_DIR = path.join(process.cwd(), 'protocols');

// Knesset website session page URL (for verification and traceability)
const sessionPageUrl = (id: number) =>
  `https://main.knesset.gov.il/Activity/committees/Pages/AllCommitteeAgenda.aspx?ItemID=${id}`;

const CONCURRENCY = 5;
const DELAY_MS = 250;

// ── HTTP helpers ────────────────────────────────────────────────────────────

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchAll(url: string): Promise<any[]> {
  const results: any[] = [];
  let next: string | null = url;
  while (next) {
    let json: any;
    // Retry up to 3 times on network errors
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        json = await fetchJson(next);
        break;
      } catch (err) {
        if (attempt === 3) throw err;
        process.stdout.write(`\n    Retry ${attempt}/3 after error...`);
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
    results.push(...(json.value ?? []));
    next = json['@odata.nextLink'] ?? null;
    if (results.length % 5000 === 0 && results.length > 0) {
      process.stdout.write(`\r    ${results.length.toLocaleString()} records fetched...`);
    }
    // Small delay between pages to avoid overwhelming the server
    if (next) await new Promise(r => setTimeout(r, 100));
  }
  return results;
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Download HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── Schema migrations (idempotent) ──────────────────────────────────────────

function migrate(db: Database.Database) {
  const cols = (db.prepare('PRAGMA table_info(committee_session)').all() as any[]).map((c: any) => c.name);
  if (!cols.includes('protocol_url')) {
    db.exec('ALTER TABLE committee_session ADD COLUMN protocol_url TEXT');
    console.log('  Added protocol_url to committee_session.');
  }

  const attCols = (db.prepare('PRAGMA table_info(committee_attendance)').all() as any[]).map((c: any) => c.name);
  if (!attCols.includes('role')) {
    db.exec("ALTER TABLE committee_attendance ADD COLUMN role TEXT");
    console.log('  Added role to committee_attendance.');
  }

  if (!cols.includes('protocol_text')) {
    db.exec('ALTER TABLE committee_session ADD COLUMN protocol_text TEXT');
    console.log('  Added protocol_text to committee_session.');
  }

  if (!cols.includes('session_url')) {
    db.exec('ALTER TABLE committee_session ADD COLUMN session_url TEXT');
    // Backfill for all existing sessions — derived from ID
    db.exec(`UPDATE committee_session SET session_url = 'https://main.knesset.gov.il/Activity/committees/Pages/AllCommitteeAgenda.aspx?ItemID=' || id`);
    console.log('  Added session_url to committee_session (backfilled for all sessions).');
  }

  // Ensure protocols backup directory exists
  fs.mkdirSync(PROTOCOLS_DIR, { recursive: true });

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_guest (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id   INTEGER NOT NULL,
      name         TEXT NOT NULL,
      role         TEXT,
      organization TEXT,
      lobbyist_id  INTEGER,  -- FK to lobbyist.id if name matches a known lobbyist
      person_type  TEXT      -- 'lobbyist' | 'official' | 'legal' | 'academic' | 'other'
    );
    CREATE INDEX IF NOT EXISTS idx_guest_session    ON session_guest (session_id);
    CREATE INDEX IF NOT EXISTS idx_guest_name       ON session_guest (name);
    CREATE INDEX IF NOT EXISTS idx_guest_lobbyist   ON session_guest (lobbyist_id);

    CREATE TABLE IF NOT EXISTS session_bill (
      session_id INTEGER NOT NULL,
      bill_id    INTEGER NOT NULL,
      PRIMARY KEY (session_id, bill_id)
    );
    CREATE INDEX IF NOT EXISTS idx_session_bill_bill ON session_bill (bill_id);
  `);
}

// ── Phase 1: Bulk-fetch protocol URLs via OData ───────────────────────────────

async function phase1FetchUrls(db: Database.Database) {
  const remaining = (db.prepare(
    "SELECT COUNT(*) as cnt FROM committee_session WHERE protocol_url IS NULL"
  ).get() as { cnt: number }).cnt;

  if (remaining === 0) {
    console.log('  Phase 1: All protocol URLs already fetched.');
    return;
  }

  // Get the session IDs we already have URLs for (from a previous partial run)
  const alreadyDone = new Set(
    (db.prepare("SELECT id FROM committee_session WHERE protocol_url IS NOT NULL").all() as { id: number }[])
      .map(r => r.id)
  );

  console.log(`  Phase 1: Bulk-fetching protocol document list from OData...`);
  console.log(`    (${alreadyDone.size} sessions already have URLs, skipping those)`);

  // Get the K25 session ID range to narrow the OData query
  const { minId, maxId } = db.prepare(
    'SELECT MIN(id) as minId, MAX(id) as maxId FROM committee_session'
  ).get() as { minId: number; maxId: number };

  // Fetch protocol documents (GroupTypeID=23) only for K25 session ID range
  const docs = await fetchAll(
    `${ODATA_API}/KNS_DocumentCommitteeSession?$filter=GroupTypeID eq 23 and CommitteeSessionID ge ${minId} and CommitteeSessionID le ${maxId}&$select=CommitteeSessionID,FilePath`
  );
  console.log(`\n    ${docs.length.toLocaleString()} protocol documents found.`);

  // Build session → best FilePath map (take first non-null per session)
  const urlMap = new Map<number, string>();
  for (const d of docs) {
    if (d.CommitteeSessionID && d.FilePath && !urlMap.has(d.CommitteeSessionID)) {
      urlMap.set(d.CommitteeSessionID, d.FilePath);
    }
  }

  // Update DB — set protocol_url for all sessions in our DB that aren't done yet
  const updateUrl = db.prepare('UPDATE committee_session SET protocol_url = ? WHERE id = ?');
  const ourSessions = db.prepare(
    "SELECT id FROM committee_session WHERE protocol_url IS NULL"
  ).all() as { id: number }[];

  let found = 0;
  let notFound = 0;
  db.transaction(() => {
    for (const s of ourSessions) {
      const url = urlMap.get(s.id) ?? '';
      updateUrl.run(url, s.id);
      if (url) found++; else notFound++;
    }
  })();

  console.log(`  Phase 1 done: ${found} protocols found, ${notFound} sessions without protocol.`);
}

// ── Phase 2: Parse attendance from protocol DOCX ─────────────────────────────

// Build lobbyist name → id map
function buildLobbyistNameMap(db: Database.Database): Map<string, number> {
  let rows: any[] = [];
  try {
    rows = db.prepare('SELECT id, first_name, last_name FROM lobbyist').all() as any[];
  } catch {
    return new Map();
  }
  const map = new Map<string, number>();
  for (const r of rows) {
    const full = `${r.first_name} ${r.last_name}`.trim();
    if (full) map.set(full, r.id);
  }
  return map;
}

// Classify a guest by their role/organization text
function classifyPersonType(role: string | null, organization: string | null): string {
  const text = `${role ?? ''} ${organization ?? ''}`.toLowerCase();
  if (text.includes('לוביסט') || text.includes('ייצוג אינטרסים')) return 'lobbyist';
  if (text.includes('יועץ משפטי') || text.includes('עורך דין') || text.includes('יעמ')) return 'legal';
  if (text.includes('פרופ') || text.includes('אוניברסיטה') || text.includes('מכון') || text.includes('מחקר')) return 'academic';
  if (text.includes('משרד') || text.includes('רשות') || text.includes('מנכ"ל') || text.includes('מנהל') ||
      text.includes('ממשלה') || text.includes('שר') || text.includes('מדינה')) return 'official';
  return 'other';
}

// Build name lookup: "first last" → person_id, also "last" → person_id[]
function buildMkNameMap(db: Database.Database): {
  full: Map<string, number>;
  byLast: Map<string, number[]>;
} {
  const mks = db.prepare('SELECT person_id, first_name, last_name FROM mk_person').all() as any[];
  const full = new Map<string, number>();
  const byLast = new Map<string, number[]>();
  for (const mk of mks) {
    const fullName = `${mk.first_name} ${mk.last_name}`;
    full.set(fullName, mk.person_id);
    const last = mk.last_name;
    if (!byLast.has(last)) byLast.set(last, []);
    byLast.get(last)!.push(mk.person_id);
  }
  return { full, byLast };
}

function resolveMkId(
  name: string,
  nameMap: { full: Map<string, number>; byLast: Map<string, number[]> }
): number | null {
  // Strip role suffix (e.g. "דוד ביטן – היו"ר" → "דוד ביטן")
  const cleanName = name.split('–')[0].split('—')[0].trim();
  if (nameMap.full.has(cleanName)) return nameMap.full.get(cleanName)!;
  // Last-name-only fallback (only if unambiguous)
  const parts = cleanName.split(' ');
  const lastName = parts[parts.length - 1];
  const candidates = nameMap.byLast.get(lastName);
  if (candidates?.length === 1) return candidates[0];
  return null;
}

interface AttendanceSection {
  committeeMembers: string[];
  visitingMks: string[];
  guests: Array<{ name: string; role: string | null; organization: string | null }>;
}

function parseAttendance(text: string): AttendanceSection {
  const start = text.indexOf('נכחו:');
  if (start === -1) return { committeeMembers: [], visitingMks: [], guests: [] };

  const sectionText = text.slice(start);
  const endMatch = sectionText.match(/\n(סדר היום|הישיבה נפתחה|הישיבה ננעלה|מר |גב' |ד"ר |היו"ר [^\n]+:)/m);
  const attendanceText = endMatch
    ? sectionText.slice(0, endMatch.index)
    : sectionText.slice(0, 2000);

  const committeeMembers: string[] = [];
  const visitingMks: string[] = [];
  const guests: Array<{ name: string; role: string | null; organization: string | null }> = [];

  let currentSection: 'committee' | 'visiting' | 'guests' | null = null;

  for (const rawLine of attendanceText.split('\n')) {
    const line = rawLine.trim();
    if (!line || line === 'נכחו:') continue;

    if (line === 'חברי הוועדה:') { currentSection = 'committee'; continue; }
    if (line === 'חברי הכנסת:') { currentSection = 'visiting'; continue; }
    if (line === 'מוזמנים:' || line === 'מוזמנות:') { currentSection = 'guests'; continue; }
    if (line.endsWith(':') && line.length < 40) continue;

    if (currentSection === 'committee') {
      committeeMembers.push(line);
    } else if (currentSection === 'visiting') {
      visitingMks.push(line);
    } else if (currentSection === 'guests') {
      const dashIdx = line.indexOf('–');
      const dashIdx2 = line.indexOf('—');
      const sepIdx = dashIdx !== -1 ? dashIdx : dashIdx2;
      if (sepIdx !== -1) {
        const name = line.slice(0, sepIdx).trim();
        const rest = line.slice(sepIdx + 1).trim();
        const commaIdx = rest.indexOf(',');
        let role: string | null = null;
        let organization: string | null = null;
        if (commaIdx !== -1) {
          role = rest.slice(0, commaIdx).trim() || null;
          organization = rest.slice(commaIdx + 1).trim() || null;
        } else {
          organization = rest || null;
        }
        if (name) guests.push({ name, role, organization });
      } else if (line) {
        guests.push({ name: line, role: null, organization: null });
      }
    }
  }

  return { committeeMembers, visitingMks, guests };
}

async function fetchSessionBills(sessionId: number): Promise<number[]> {
  try {
    const data = await fetchJson(
      `${ODATA_API}/KNS_CmtSessionItem?$filter=CommitteeSessionID eq ${sessionId}&$select=CommitteeSessionID,ItemID`
    );
    return (data?.value ?? []).map((r: any) => r.ItemID).filter(Boolean);
  } catch {
    return [];
  }
}

async function processSession(
  session: { id: number },
  protocolUrl: string,
  db: Database.Database,
  nameMap: { full: Map<string, number>; byLast: Map<string, number[]> },
  lobbyistMap: Map<string, number>,
  insertAttendance: Database.Statement,
  insertGuest: Database.Statement,
  insertBill: Database.Statement,
  saveText: Database.Statement,
): Promise<{ mks: number; guests: number; bills: number; unmatched: string[] }> {
  const unmatched: string[] = [];
  let mkCount = 0;
  let guestCount = 0;
  let billCount = 0;

  try {
    const buf = await downloadBuffer(protocolUrl);
    const result = await mammoth.extractRawText({ buffer: buf });
    const text = result.value.trim();

    if (text.length >= 100) {
      const { committeeMembers, visitingMks, guests } = parseAttendance(text);

      db.transaction(() => {
        // Save raw text — this is the resume marker and enables future re-parsing
        saveText.run(text, session.id);

        for (const name of [...committeeMembers, ...visitingMks]) {
          const role = committeeMembers.includes(name) ? 'member' : 'visitor';
          const mkId = resolveMkId(name, nameMap);
          if (mkId) {
            insertAttendance.run(session.id, mkId, role);
            mkCount++;
          } else {
            unmatched.push(name);
          }
        }
        for (const g of guests) {
          const lobbyistId = lobbyistMap.get(g.name) ?? null;
          const personType = lobbyistId ? 'lobbyist' : classifyPersonType(g.role, g.organization);
          insertGuest.run(session.id, g.name, g.role, g.organization, lobbyistId, personType);
          guestCount++;
        }
      })();
    } else {
      // Too short but still mark as processed (empty string = attempted, no useful content)
      saveText.run('', session.id);
    }
  } catch {
    // Protocol download/parse failed — skip (protocol_text stays NULL → will retry next run)
  }

  // Fetch session→bill links
  const billIds = await fetchSessionBills(session.id);
  if (billIds.length > 0) {
    db.transaction(() => {
      for (const billId of billIds) {
        insertBill.run(session.id, billId);
        billCount++;
      }
    })();
  }

  return { mks: mkCount, guests: guestCount, bills: billCount, unmatched };
}

async function phase2ParseAttendance(db: Database.Database) {
  const sessions = db.prepare(`
    SELECT id, protocol_url
    FROM committee_session
    WHERE protocol_url IS NOT NULL AND protocol_url != ''
      AND protocol_text IS NULL
    ORDER BY id ASC
  `).all() as { id: number; protocol_url: string }[];

  if (sessions.length === 0) {
    console.log('  Phase 2: All protocols already parsed.');
    return;
  }

  console.log(`  Phase 2: Parsing attendance from ${sessions.length} protocols...`);
  const nameMap = buildMkNameMap(db);
  const lobbyistMap = buildLobbyistNameMap(db);
  console.log(`    Name maps: ${nameMap.full.size} MKs, ${lobbyistMap.size} lobbyists`);

  const insertAttendance = db.prepare(
    'INSERT OR IGNORE INTO committee_attendance (session_id, mk_id, role) VALUES (?, ?, ?)'
  );
  const insertGuest = db.prepare(
    'INSERT INTO session_guest (session_id, name, role, organization, lobbyist_id, person_type) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertBill = db.prepare(
    'INSERT OR IGNORE INTO session_bill (session_id, bill_id) VALUES (?, ?)'
  );
  const saveText = db.prepare(
    'UPDATE committee_session SET protocol_text = ? WHERE id = ?'
  );

  let done = 0;
  let totalMks = 0;
  let totalGuests = 0;
  let totalBills = 0;
  const allUnmatched = new Map<string, number>();

  for (let i = 0; i < sessions.length; i += CONCURRENCY) {
    const batch = sessions.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(s =>
        processSession(s, s.protocol_url, db, nameMap, lobbyistMap, insertAttendance, insertGuest, insertBill, saveText)
      )
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        totalMks += r.value.mks;
        totalGuests += r.value.guests;
        totalBills += r.value.bills;
        for (const name of r.value.unmatched) {
          allUnmatched.set(name, (allUnmatched.get(name) ?? 0) + 1);
        }
      }
    }
    done += batch.length;
    if (done % 100 === 0 || done === sessions.length) {
      console.log(`    ${done}/${sessions.length} — ${totalMks} MK records, ${totalGuests} guests, ${totalBills} bill links`);
    }
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`\n  Phase 2 done:`);
  console.log(`    MK attendance records: ${totalMks}`);
  console.log(`    Guest records:         ${totalGuests}`);
  console.log(`    Session→bill links:    ${totalBills}`);

  if (allUnmatched.size > 0) {
    console.log(`\n  Top unmatched MK names (${allUnmatched.size} unique):`);
    [...allUnmatched.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .forEach(([name, count]) => console.log(`    ${count}x "${name}"`));
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const db = new Database(DB_PATH);

  console.log('Scrape Protocol Attendance');
  console.log('  Migrations...');
  migrate(db);

  await phase1FetchUrls(db);
  await phase2ParseAttendance(db);

  db.close();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
