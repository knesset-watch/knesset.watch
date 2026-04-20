/**
 * Daily incremental sync — run by GitHub Actions every night.
 * Fetches only records updated in the last 7 days and upserts them into knesset.db.
 *
 * Usage (manual):
 *   cd apps/knesset-watch
 *   npm run db:sync
 */

import Database from 'better-sqlite3';
import path from 'path';

const API = (process.env.KNESSET_API_BASE ?? 'https://knesset.gov.il') + '/OdataV4/ParliamentInfo';
const DB_PATH = path.join(process.cwd(), 'knesset.db');

// Overlap ensures we never miss anything due to clock skew or delayed updates
const LOOKBACK_DAYS = 7;

const PASSED_STATUS_IDS = new Set([118, 119, 6020, 6030, 6040]);

async function fetchPage(url: string): Promise<{ value: any[]; next: string | null }> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`Knesset API ${res.status}`);
  const json = await res.json();
  return { value: json.value ?? [], next: json['@odata.nextLink'] ?? null };
}

async function fetchAll(url: string): Promise<any[]> {
  const results: any[] = [];
  let next: string | null = url;
  while (next) {
    const page = await fetchPage(next);
    results.push(...page.value);
    next = page.next;
  }
  return results;
}

// Classify role type from API fields
function classifyRoleType(r: any): string {
  const d = r.DutyDesc ?? '';
  if (d.startsWith('ראש הממשלה')) return 'pm';
  if (d.startsWith('סגן ראש הממשלה') || d.startsWith('המשנה לראש הממשלה')) return 'deputy-pm';
  if (d === 'שר' || d === 'שרה') return 'minister';
  if (d.match(/^(שר |שרת |השר |השרה )/)) return 'minister';
  if (d.match(/^שר(ה|ת)? ללא תיק/)) return 'minister';
  if (d.startsWith('שר בשירות חוקי') || d.startsWith('ממלא מקום שר') || d.startsWith('ממלא מקום השר')) return 'acting';
  if (d.match(/^סגנ(ית)? שר/)) return 'deputy';
  if (r.CommitteeID) return 'committee';
  if (!d && !r.CommitteeID && !r.GovMinistryID) return 'mk';
  return 'other';
}

// Normalise Hebrew name for matching (strips punctuation, collapses spaces)
function normName(s: string): string {
  return s.replace(/[״׳"'\-]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * If a vote result arrives with an unknown KnsID (e.g. a replacement MK who
 * joined after the initial seed), resolve their PersonID by name-matching the
 * inline FirstName/LastName fields in the vote row against the K25 PersonID list,
 * then persist the mapping so subsequent rows are handled instantly.
 */
async function resolveNewKnsId(
  db: Database.Database,
  knsId: number,
  firstName: string,
  lastName: string,
  knsToPersonMap: Map<number, number>,
): Promise<number> {
  // Build name → PersonID index from K25 positions
  const k25People = db.prepare(
    `SELECT p.mk_id as person_id, p.duty_desc
     FROM mk_position p
     WHERE p.mk_id NOT IN (SELECT person_id FROM mk_id_map)
     LIMIT 1`,
  );

  // Fetch fresh K25 MK list from API to find the new person
  const posRows = await fetchAll(
    `${API}/KNS_PersonToPosition` +
    `?$filter=PositionID eq 54 and KnessetNum eq 25` +
    `&$expand=KNS_Person($select=Id,FirstName,LastName)` +
    `&$select=PersonID`,
  );

  const nameToPersonId = new Map<string, number>();
  for (const r of posRows) {
    const p = r.KNS_Person;
    if (!p) continue;
    const name = normName(`${p.FirstName ?? ''} ${p.LastName ?? ''}`);
    nameToPersonId.set(name, p.Id);
  }

  const voteName = normName(`${firstName} ${lastName}`);
  const personId = nameToPersonId.get(voteName);

  if (personId) {
    db.prepare('INSERT OR REPLACE INTO mk_id_map (person_id, kns_id) VALUES (?, ?)').run(personId, knsId);
    knsToPersonMap.set(knsId, personId);
    console.log(`  New MK resolved: KnsID ${knsId} → PersonID ${personId} (${firstName} ${lastName})`);
    return personId;
  }

  console.warn(`  Warning: could not resolve KnsID ${knsId} (${firstName} ${lastName}) — storing under KnsID`);
  return knsId;
}

async function sync() {
  const db = new Database(DB_PATH);

  // ── Schema version check ─────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version   INTEGER NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const { version: schemaVersion } = db
    .prepare('SELECT COALESCE(MAX(version), 0) as version FROM schema_version')
    .get() as { version: number };
  console.log(`DB schema version: ${schemaVersion}`);

  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);
  const sinceStr = since.toISOString().replace(/\.\d{3}Z$/, '+00:00');

  console.log(`Syncing records updated since ${since.toLocaleDateString()} …`);

  // ── Votes ─────────────────────────────────────────────────────────────────
  const voteCols = (db.prepare(`PRAGMA table_info(plenary_vote)`).all() as { name: string }[]).map(r => r.name);
  if (!voteCols.includes('micro_agenda')) db.exec(`ALTER TABLE plenary_vote ADD COLUMN micro_agenda TEXT`);
  if (!voteCols.includes('macro_agenda')) db.exec(`ALTER TABLE plenary_vote ADD COLUMN macro_agenda TEXT`);

  const insertVote = db.prepare(
    'INSERT OR REPLACE INTO plenary_vote (id, title, date, micro_agenda, macro_agenda) VALUES (?, ?, ?, ?, ?)',
  );
  const insertVotesBatch = db.transaction((rows: any[]) => {
    for (const r of rows) {
      const { macro, micro } = categorize(r.VoteTitle ?? '', null);
      insertVote.run(r.Id, r.VoteTitle ?? '', r.VoteDateTime ?? '', micro, macro);
    }
  });

  const votes = await fetchAll(
    `${API}/KNS_PlenumVote` +
    `?$filter=${encodeURIComponent(`VoteDateTime ge ${sinceStr}`)}` +
    `&$select=Id,VoteTitle,VoteDateTime`,
  );
  insertVotesBatch(votes);

  // ── Vote results ──────────────────────────────────────────────────────────
  // Load kns_id → person_id mapping so new vote rows are stored under PersonID
  const knsToPersonMap = new Map<number, number>(
    (db.prepare('SELECT kns_id, person_id FROM mk_id_map').all() as { kns_id: number; person_id: number }[])
      .map(r => [r.kns_id, r.person_id]),
  );

  const insertResult = db.prepare(
    'INSERT OR REPLACE INTO mk_vote_result (vote_id, mk_id, result_code) VALUES (?, ?, ?)',
  );

  // Fetch with FirstName/LastName so we can resolve any new KnsIDs on the fly
  const results = await fetchAll(
    `${API}/KNS_PlenumVoteResult` +
    `?$filter=${encodeURIComponent(`VoteDate ge ${sinceStr}`)}` +
    `&$select=VoteID,MkId,ResultCode,FirstName,LastName`,
  );

  // Resolve any unknown KnsIDs before batch-inserting
  const unknownKnsIds = new Set(results.map(r => r.MkId).filter(id => !knsToPersonMap.has(id)));
  if (unknownKnsIds.size > 0) {
    console.log(`Resolving ${unknownKnsIds.size} new KnsID(s) …`);
    // Group by KnsID to get a name sample for each
    const byKnsId = new Map<number, { firstName: string; lastName: string }>();
    for (const r of results) {
      if (unknownKnsIds.has(r.MkId) && !byKnsId.has(r.MkId)) {
        byKnsId.set(r.MkId, { firstName: r.FirstName ?? '', lastName: r.LastName ?? '' });
      }
    }
    for (const [knsId, { firstName, lastName }] of Array.from(byKnsId.entries())) {
      await resolveNewKnsId(db, knsId, firstName, lastName, knsToPersonMap);
    }
  }

  db.transaction((rows: any[]) => {
    for (const r of rows) {
      const personId = knsToPersonMap.get(r.MkId) ?? r.MkId;
      insertResult.run(r.VoteID, personId, r.ResultCode);
    }
  })(results);

  // ── MK person identity ────────────────────────────────────────────────────
  // Re-sync all current MKs to pick up faction changes / new arrivals
  db.exec(`CREATE TABLE IF NOT EXISTS mk_person (
    person_id    INTEGER PRIMARY KEY,
    first_name   TEXT    NOT NULL DEFAULT '',
    last_name    TEXT    NOT NULL DEFAULT '',
    faction_id   INTEGER,
    faction_name TEXT,
    slug         TEXT,
    is_current   INTEGER NOT NULL DEFAULT 0,
    is_coalition INTEGER,
    coalition_pct REAL,
    non_mk_pct   REAL,
    segments     TEXT
  )`);

  // Ensure all mk_person columns exist
  const personCols = (db.prepare(`PRAGMA table_info(mk_person)`).all() as { name: string }[]).map(r => r.name);
  if (!personCols.includes('is_current'))   db.exec(`ALTER TABLE mk_person ADD COLUMN is_current INTEGER NOT NULL DEFAULT 0`);
  if (!personCols.includes('is_coalition')) db.exec(`ALTER TABLE mk_person ADD COLUMN is_coalition INTEGER`);
  if (!personCols.includes('coalition_pct')) db.exec(`ALTER TABLE mk_person ADD COLUMN coalition_pct REAL`);
  if (!personCols.includes('non_mk_pct'))   db.exec(`ALTER TABLE mk_person ADD COLUMN non_mk_pct REAL`);
  if (!personCols.includes('segments'))     db.exec(`ALTER TABLE mk_person ADD COLUMN segments TEXT`);

  const K25_START = new Date('2022-11-15');
  const K25_COALITION_PERIODS: Array<{ factionId: number; start: Date | null; end: Date | null }> = [
    { factionId: 1096, start: null, end: null },  // הליכוד (Likud)
    { factionId: 1095, start: null, end: null },  // שס (Shas)
    { factionId: 1101, start: null, end: null },  // יהדות התורה (UTJ)
    { factionId: 1105, start: null, end: null },  // הציונות הדתית (Religious Zionism)
    { factionId: 1106, start: null, end: null },  // עוצמה יהודית (Otzma)
    { factionId: 1107, start: null, end: null },  // נעם (Noam)
    { factionId: 1098, start: new Date('2023-10-12'), end: new Date('2024-06-09') },  // הציונות הדתית (temporary)
    { factionId: 1108, start: new Date('2024-09-29'), end: null },  // לא מעורב (temporary)
  ];

  function isCoalitionAtTime(factionId: number, time: Date): boolean {
    return K25_COALITION_PERIODS.some(p => {
      if (p.factionId !== factionId) return false;
      const afterStart = p.start === null || time >= p.start;
      const beforeEnd = p.end === null || time <= p.end;
      return afterStart && beforeEnd;
    });
  }

  function computeSegments(records: any[], hasCurrent: boolean, k25TotalMs: number): any[] {
    const now = Date.now();
    const k25StartMs = K25_START.getTime();
    const stints = records
      .map(r => ({
        start: Math.max(new Date(r.StartDate).getTime(), k25StartMs),
        end: r.FinishDate ? new Date(r.FinishDate).getTime() : now,
        factionId: r.FactionID as number,
      }))
      .filter(r => r.end > r.start && r.start < now)
      .sort((a, b) => a.start - b.start);

    const result: any[] = [];
    let cursor = k25StartMs;
    for (const stint of stints) {
      if (stint.start > cursor) {
        result.push({ startFrac: (cursor - k25StartMs) / k25TotalMs, endFrac: (stint.start - k25StartMs) / k25TotalMs, state: 'none', startDate: new Date(cursor).toISOString().split('T')[0], endDate: new Date(stint.start).toISOString().split('T')[0] });
      }
      const events = new Set<number>([stint.start, stint.end]);
      for (const p of K25_COALITION_PERIODS) {
        if (p.factionId !== stint.factionId) continue;
        const pStart = (p.start ?? K25_START).getTime();
        const pEnd = p.end ? p.end.getTime() : now;
        if (pStart > stint.start && pStart < stint.end) events.add(pStart);
        if (pEnd > stint.start && pEnd < stint.end) events.add(pEnd);
      }
      const timeline = Array.from(events).sort((a, b) => a - b);
      for (let i = 0; i < timeline.length - 1; i++) {
        const s = timeline[i], e = timeline[i + 1], mid = (s + e) / 2;
        const isCoal = K25_COALITION_PERIODS.some(p => {
          if (p.factionId !== stint.factionId) return false;
          const pStart = (p.start ?? K25_START).getTime();
          const pEnd = p.end ? p.end.getTime() : now;
          return mid >= pStart && mid <= pEnd;
        });
        result.push({ startFrac: (s - k25StartMs) / k25TotalMs, endFrac: (e - k25StartMs) / k25TotalMs, state: isCoal ? 'coalition' : 'opposition', startDate: new Date(s).toISOString().split('T')[0], endDate: new Date(e).toISOString().split('T')[0] });
      }
      cursor = stint.end;
    }
    if (!hasCurrent && cursor < now) {
      result.push({ startFrac: (cursor - k25StartMs) / k25TotalMs, endFrac: 1.0, state: 'none', startDate: new Date(cursor).toISOString().split('T')[0], endDate: new Date(now).toISOString().split('T')[0] });
    }
    return result;
  }

  function computeCoalitionPct(records: any[]): number {
    const now = new Date();
    let totalMs = 0, coalitionMs = 0;
    for (const r of records) {
      const segStart = Math.max(new Date(r.StartDate).getTime(), K25_START.getTime());
      const segEnd = r.FinishDate ? new Date(r.FinishDate).getTime() : now.getTime();
      const duration = Math.max(0, segEnd - segStart);
      if (duration === 0) continue;
      totalMs += duration;
      for (const period of K25_COALITION_PERIODS) {
        if (period.factionId !== r.FactionID) continue;
        const pStart = (period.start ?? K25_START).getTime();
        const pEnd = period.end ? period.end.getTime() : now.getTime();
        const overlapStart = Math.max(segStart, pStart);
        const overlapEnd = Math.min(segEnd, pEnd);
        if (overlapEnd > overlapStart) coalitionMs += overlapEnd - overlapStart;
      }
    }
    return totalMs > 0 ? coalitionMs / totalMs : 0;
  }

  const insertPerson = db.prepare(
    `INSERT OR REPLACE INTO mk_person (person_id, first_name, last_name, faction_id, faction_name, slug, is_current, is_coalition, coalition_pct, non_mk_pct, segments)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const factionRows = await fetchAll(
    `${API}/KNS_Faction?$filter=${encodeURIComponent('KnessetNum eq 25')}`,
  );
  const factionMap = new Map<number, string>();
  for (const f of factionRows) {
    if (f.Id != null && f.Name) factionMap.set(f.Id, f.Name);
  }

  const personToPosRows = await fetchAll(
    `${API}/KNS_PersonToPosition` +
    `?$filter=${encodeURIComponent('KnessetNum eq 25 and PositionID eq 54')}` +
    `&$expand=KNS_Person` +
    `&$orderby=StartDate asc`,
  );

  const recordsByPerson = new Map<number, any[]>();
  for (const r of personToPosRows) {
    if (!r.KNS_Person) continue;
    const list = recordsByPerson.get(r.KNS_Person.Id) ?? [];
    list.push(r);
    recordsByPerson.set(r.KNS_Person.Id, list);
  }

  const now = new Date();
  const k25TotalMs = now.getTime() - K25_START.getTime();

  db.transaction(() => {
    for (const [pid, records] of recordsByPerson) {
      const hasCurrent = records.some(r => r.IsCurrent);
      const currentRec = hasCurrent
        ? (records.find(r => r.IsCurrent) ?? records[records.length - 1])
        : records.reduce((a, b) => {
            const da = a.FinishDate ? new Date(a.FinishDate) : new Date(0);
            const db = b.FinishDate ? new Date(b.FinishDate) : new Date(0);
            return db > da ? b : a;
          });

      const factionId = currentRec.FactionID ?? null;
      const factionName = factionId != null ? (factionMap.get(factionId) ?? null) : null;
      
      let nonMkPct = 0;
      let latestFinish: Date | null = null;
      if (!hasCurrent) {
        let lastMs = K25_START.getTime();
        for (const r of records) {
          const fin = r.FinishDate ? new Date(r.FinishDate).getTime() : now.getTime();
          if (fin > lastMs) { lastMs = fin; latestFinish = new Date(lastMs); }
        }
        nonMkPct = Math.max(0, Math.min(1, (now.getTime() - lastMs) / k25TotalMs));
      }

      const isCoal = factionId != null
        ? (hasCurrent
            ? K25_COALITION_PERIODS.some(p => p.factionId === factionId && (p.end === null || new Date() <= p.end))
            : (latestFinish ? isCoalitionAtTime(factionId, latestFinish) : false))
        : null;

      const rawPct = computeCoalitionPct(records);
      const coalitionPct = rawPct > 0.05 && rawPct < 0.95 ? rawPct : null;
      const segments = computeSegments(records, hasCurrent, k25TotalMs);

      // Slug logic: English name slug if available
      const person = currentRec.KNS_Person;
      const fEng = (person.FirstNameEng ?? '').trim(), lEng = (person.LastNameEng ?? '').trim();
      const slug = (fEng || lEng) 
        ? `${fEng}-${lEng}`.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-')
        : String(pid);

      insertPerson.run(
        pid, person.FirstName ?? '', person.LastName ?? '', factionId, factionName, slug,
        hasCurrent ? 1 : 0, isCoal ? 1 : 0, coalitionPct, nonMkPct, JSON.stringify(segments)
      );
    }
  })();
  console.log(`persons=${recordsByPerson.size}`);

  // ── Bills + initiators ────────────────────────────────────────────────────
  // Fetch committee names once for bill tagging
  const committeeRows = await fetchAll(`${API}/KNS_Committee?$select=Id,Name`);
  const committeeMap = new Map<number, string>();
  for (const r of committeeRows) { if (r.Id != null && r.Name) committeeMap.set(r.Id, r.Name); }

  // Ensure all bill columns exist (migration for older DBs)
  const billCols = (db.prepare(`PRAGMA table_info(bill)`).all() as { name: string }[]).map(r => r.name);
  if (!billCols.includes('committee_id'))   db.exec(`ALTER TABLE bill ADD COLUMN committee_id INTEGER`);
  if (!billCols.includes('committee_name')) db.exec(`ALTER TABLE bill ADD COLUMN committee_name TEXT`);
  if (!billCols.includes('summary'))        db.exec(`ALTER TABLE bill ADD COLUMN summary TEXT`);
  if (!billCols.includes('doc_url'))        db.exec(`ALTER TABLE bill ADD COLUMN doc_url TEXT`);
  if (!billCols.includes('micro_agenda'))   db.exec(`ALTER TABLE bill ADD COLUMN micro_agenda TEXT`);
  if (!billCols.includes('macro_agenda'))   db.exec(`ALTER TABLE bill ADD COLUMN macro_agenda TEXT`);
  if (!billCols.includes('publication_date')) db.exec(`ALTER TABLE bill ADD COLUMN publication_date TEXT`);
  if (!billCols.includes('status_desc')) db.exec(`ALTER TABLE bill ADD COLUMN status_desc TEXT`);
  if (!billCols.includes('init_date')) db.exec(`ALTER TABLE bill ADD COLUMN init_date TEXT`);

  const insertBill = db.prepare(
    'INSERT OR REPLACE INTO bill (id, title, subtype, status_id, status_desc, is_passed, committee_id, committee_name, summary, micro_agenda, macro_agenda, publication_date, init_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );

  // Simple categorization helper (copied from generation script)
  function categorize(title: string, committee: string | null): { macro: string; micro: string } {
    const t = title.toLowerCase();
    const c = committee || '';
    let macro = "מנהל ומשפט";
    if (c.includes("ביטחון") || t.includes('צה"ל') || t.includes("צבא") || t.includes("טרור") || t.includes("נשק") || t.includes("מילואים") || t.includes("חיילים")) macro = "ביטחון וצבא";
    else if (c.includes("כספים") || c.includes("כלכלה") || t.includes("מס ") || t.includes("מיסוי") || t.includes("תקציב") || t.includes("צרכן") || t.includes("בנק") || t.includes("מכס")) macro = "כלכלה ויוקר המחיה";
    else if (c.includes("בריאות") || c.includes("רווחה") || t.includes("בריאות") || t.includes("ביטוח לאומי") || t.includes("קצבת") || t.includes("נכים") || t.includes("עוני")) macro = "בריאות ורווחה";
    else if (c.includes("חינוך") || t.includes("חינוך") || t.includes("בתי ספר") || t.includes("תלמידים") || t.includes("אקדמיה") || t.includes("תרבות") || t.includes("ספורט")) macro = "חינוך ותרבות";
    else if (t.includes("רבנות") || t.includes("דת") || t.includes("כשרות") || t.includes("שבת") || t.includes("גיור") || t.includes("בתי דין רבניים")) macro = "דת ומדינה";
    else if (c.includes("חוקה") || c.includes("משפט") || t.includes("עונשין") || t.includes("פשיעה") || t.includes("אלימות") || t.includes("בתי משפט") || t.includes("שפיטה") || t.includes("מאסר")) macro = "משפט ופשיעה";
    else if (c.includes("סביבה") || t.includes("תכנון והבניה") || t.includes("תחבורה") || t.includes("מקרקעין") || t.includes("אנרגיה") || t.includes("מים") || t.includes("חשמל")) macro = "סביבה ותשתיות";
    else if (c.includes("עבודה") || t.includes("עובדים") || t.includes("שכר") || t.includes("תעסוקה") || t.includes("חופשה") || t.includes("פיצויי פיטורים")) macro = "עבודה ותעסוקה";
    else if (c.includes("פנים") || t.includes("רשויות מקומיות") || t.includes("בחירות") || t.includes("ממשלה") || t.includes("כנסת") || t.includes("שירות המדינה") || t.includes("מבקר המדינה")) macro = "שלטון ומינהל";
    else if (c.includes("זכויות") || c.includes("נשים") || t.includes("הפליה") || t.includes("שוויון") || t.includes('להט"ב')) macro = "זכויות אדם ושוויון";

    let micro = title.replace(/^הצעת /, '').replace(/, התשפ.*/, '').replace(/ \S+$/, '');
    const parenMatch = title.match(/\(([^0-9(]+)\)/);
    if (parenMatch && parenMatch[1] && parenMatch[1].length > 5 && !parenMatch[1].includes("תיקון")) {
      micro = parenMatch[1];
    } else {
      micro = micro.replace(/^חוק /, '').replace(/^לתיקון פקודת /, 'פקודת ').replace(/ \(תיקון מס' \d+\)/, '').replace(/ \(תיקון\)/, '').trim();
      if (micro.length > 50) micro = micro.substring(0, 47) + "...";
    }
    return { macro, micro };
  }

  const insertInitiator = db.prepare(
    'INSERT OR REPLACE INTO bill_initiator (bill_id, mk_id) VALUES (?, ?)',
  );
  const insertBillsBatch = db.transaction((rows: any[]) => {
    for (const r of rows) {
      const committeeName = r.CommitteeID != null ? (committeeMap.get(r.CommitteeID) ?? null) : null;
      const { macro, micro } = categorize(r.Name ?? '', committeeName);
      insertBill.run(
        r.Id, r.Name ?? '', r.SubTypeDesc ?? '', r.StatusID ?? 0,
        r.KNS_Status?.Desc ?? null,
        PASSED_STATUS_IDS.has(r.StatusID) ? 1 : 0,
        r.CommitteeID ?? null, committeeName,
        r.SummaryLaw?.trim() ?? null,
        micro, macro,
        r.PublicationDate ?? null,
        (() => { const m = (r.Name ?? '').trimEnd().match(/-(\d{4})$/); return m ? m[1] : null; })(),
      );
      for (const init of r.KNS_BillInitiator ?? []) {
        if (init.PersonID) insertInitiator.run(r.Id, init.PersonID);
      }
    }
  });

  const bills = await fetchAll(
    `${API}/KNS_Bill` +
    `?$filter=${encodeURIComponent(`KnessetNum eq 25 and LastUpdatedDate ge ${sinceStr}`)}` +
    `&$expand=KNS_BillInitiator($select=PersonID),KNS_Status($select=Desc)` +
    `&$select=Id,Name,SubTypeDesc,StatusID,CommitteeID,SummaryLaw,PublicationDate`,
  );
  insertBillsBatch(bills);

  // Update doc URLs for newly synced bills
  const normPath = (p: string) => p.replace(/\\/g, '/').replace(/\/\//g, '/').replace('https:/', 'https://');
  if (bills.length > 0) {
    const newBillIds = bills.map(r => r.Id);
    const idSet = new Set(newBillIds);
    const docRows = await fetchAll(
      `${API}/KNS_DocumentBill?$filter=${encodeURIComponent(`GroupTypeID eq 1 and LastUpdatedDate ge ${sinceStr}`)}&$select=BillID,FilePath,ApplicationID`,
    );
    const docMap = new Map<number, string>();
    for (const r of docRows) {
      if (!idSet.has(r.BillID)) continue;
      const existing = docMap.get(r.BillID);
      // prefer PDF (ApplicationID=4) over DOC (ApplicationID=1)
      if (!existing || r.ApplicationID === 4) docMap.set(r.BillID, normPath(r.FilePath));
    }
    const updateDocUrl = db.prepare(`UPDATE bill SET doc_url = ? WHERE id = ?`);
    db.transaction(() => {
      for (const [id, url] of docMap) updateDocUrl.run(url, id);
    })();
  }

  // ── Queries ───────────────────────────────────────────────────────────────
  // Ensure mk_query table has all columns
  const queryCols = (db.prepare(`PRAGMA table_info(mk_query)`).all() as { name: string }[]).map(r => r.name);
  if (!queryCols.includes('body'))                   db.exec(`ALTER TABLE mk_query ADD COLUMN body TEXT`);
  if (!queryCols.includes('ministry_response'))      db.exec(`ALTER TABLE mk_query ADD COLUMN ministry_response TEXT`);
  if (!queryCols.includes('enriched_at'))            db.exec(`ALTER TABLE mk_query ADD COLUMN enriched_at TEXT`);
  if (!queryCols.includes('source_url'))             db.exec(`ALTER TABLE mk_query ADD COLUMN source_url TEXT`);
  if (!queryCols.includes('ministry_response_url'))  db.exec(`ALTER TABLE mk_query ADD COLUMN ministry_response_url TEXT`);
  if (!queryCols.includes('gov_ministry_id'))        db.exec(`ALTER TABLE mk_query ADD COLUMN gov_ministry_id INTEGER`);
  if (!queryCols.includes('gov_ministry_name'))      db.exec(`ALTER TABLE mk_query ADD COLUMN gov_ministry_name TEXT`);
  if (!queryCols.includes('query_number'))           db.exec(`ALTER TABLE mk_query ADD COLUMN query_number INTEGER`);
  if (!queryCols.includes('type_desc'))              db.exec(`ALTER TABLE mk_query ADD COLUMN type_desc TEXT`);
  if (!queryCols.includes('reply_date'))             db.exec(`ALTER TABLE mk_query ADD COLUMN reply_date TEXT`);

  // Fetch ministry names for gov_ministry_name lookup
  const ministryRows = await fetchAll(`${API}/KNS_GovMinistry?$select=Id,Name`);
  const ministryMap = new Map<number, string>();
  for (const m of ministryRows) {
    if (m.Id != null && m.Name) ministryMap.set(m.Id, m.Name);
  }

  const insertQuery = db.prepare(
    `INSERT INTO mk_query (id, mk_id, title, submit_date, gov_ministry_id, gov_ministry_name, query_number, type_desc, reply_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       mk_id             = excluded.mk_id,
       title             = excluded.title,
       submit_date       = excluded.submit_date,
       gov_ministry_id   = excluded.gov_ministry_id,
       gov_ministry_name = excluded.gov_ministry_name,
       query_number      = excluded.query_number,
       type_desc         = excluded.type_desc,
       reply_date        = excluded.reply_date`,
  );
  const insertQueriesBatch = db.transaction((rows: any[]) => {
    for (const r of rows) {
      if (r.PersonID) {
        const ministryId = r.GovMinistryID ?? null;
        const ministryName = ministryId != null ? (ministryMap.get(ministryId) ?? null) : null;
        insertQuery.run(
          r.Id, r.PersonID, r.Name ?? '', r.SubmitDate ?? '',
          ministryId, ministryName,
          r.Number ?? null, r.TypeDesc ?? null, r.ReplyMinisterDate ?? null,
        );
      }
    }
  });

  const queries = await fetchAll(
    `${API}/KNS_Query` +
    `?$filter=${encodeURIComponent(`KnessetNum eq 25 and LastUpdatedDate ge ${sinceStr}`)}`,
  );
  insertQueriesBatch(queries);

  // ── Government Ministries ────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS gov_ministry (
      id           INTEGER PRIMARY KEY,
      name         TEXT NOT NULL,
      is_active    INTEGER NOT NULL DEFAULT 0,
      last_updated TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS canonical_office (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      slug         TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      short_name   TEXT,
      is_active    INTEGER NOT NULL DEFAULT 1,
      notes        TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS canonical_office_ministry (
      canonical_office_id INTEGER NOT NULL REFERENCES canonical_office(id),
      gov_ministry_id     INTEGER NOT NULL REFERENCES gov_ministry(id),
      PRIMARY KEY (canonical_office_id, gov_ministry_id)
    )
  `);

  const syncGovMinistries = async () => {
    const insertMinistry = db.prepare(
      `INSERT OR REPLACE INTO gov_ministry (id, name, is_active, last_updated)
       VALUES (?, ?, ?, ?)`
    );

    const ministries = await fetchAll(
      `${API}/KNS_GovMinistry?$select=Id,Name,IsActive,LastUpdatedDate`
    );

    db.transaction(() => {
      for (const m of ministries) {
        insertMinistry.run(m.Id ?? null, m.Name ?? '', m.IsActive ? 1 : 0, m.LastUpdatedDate ?? null);
      }
    })();

    console.log(`  synced ${ministries.length} government ministries`);
  };

  await syncGovMinistries();

  // ── Positions ─────────────────────────────────────────────────────────────
  // Ensure mk_position has government_num column
  const posCols = (db.prepare(`PRAGMA table_info(mk_position)`).all() as { name: string }[]).map(r => r.name);
  if (!posCols.includes('government_num')) db.exec(`ALTER TABLE mk_position ADD COLUMN government_num INTEGER`);

  const insertPosition = db.prepare(
    `INSERT OR REPLACE INTO mk_position
       (id, mk_id, duty_desc, committee_id, committee, ministry_id, ministry, start_date, finish_date, is_current, role_type, government_num)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertPositionsBatch = db.transaction((rows: any[]) => {
    for (const r of rows) {
      insertPosition.run(
        r.Id, r.PersonID, r.DutyDesc ?? null,
        r.CommitteeID ?? null, r.CommitteeName ?? null,
        r.GovMinistryID ?? null, r.GovMinistryName ?? null,
        r.StartDate ?? '', r.FinishDate ?? null,
        r.IsCurrent ? 1 : 0,
        classifyRoleType(r),
        r.GovernmentNum ?? null,
      );
    }
  });

  const positions = await fetchAll(
    `${API}/KNS_PersonToPosition` +
    `?$filter=${encodeURIComponent(`KnessetNum eq 25`)}` +
    `&$select=Id,PersonID,DutyDesc,CommitteeID,CommitteeName,GovMinistryID,GovMinistryName,StartDate,FinishDate,IsCurrent,GovernmentNum`,
  );
  insertPositionsBatch(positions);

  // ── Recompute all vote outcomes ───────────────────────────────────────────
  // Always recompute the full table — fast enough (~1s) and guarantees consistency
  // even if the Knesset corrects historical vote records.
  if (votes.length > 0 || results.length > 0) {
    db.exec(`
      UPDATE plenary_vote SET
        total_for     = (SELECT COUNT(*) FROM mk_vote_result r WHERE r.vote_id = plenary_vote.id AND r.result_code = 7),
        total_against = (SELECT COUNT(*) FROM mk_vote_result r WHERE r.vote_id = plenary_vote.id AND r.result_code = 8),
        total_abstain = (SELECT COUNT(*) FROM mk_vote_result r WHERE r.vote_id = plenary_vote.id AND r.result_code = 9),
        is_passed     = CASE WHEN
          (SELECT COUNT(*) FROM mk_vote_result r WHERE r.vote_id = plenary_vote.id AND r.result_code = 7) >
          (SELECT COUNT(*) FROM mk_vote_result r WHERE r.vote_id = plenary_vote.id AND r.result_code = 8)
        THEN 1 ELSE 0 END
    `);
  }

  db.close();
  console.log(
    `Done. votes=${votes.length}, results=${results.length.toLocaleString()}, ` +
    `bills=${bills.length}, queries=${queries.length}, positions=${positions.length}`,
  );
}

sync().catch(err => {
  console.error('Sync failed:', err.message);
  process.exit(1);
});
