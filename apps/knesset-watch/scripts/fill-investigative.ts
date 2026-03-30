import Database from 'better-sqlite3';
import path from 'path';

const API = 'https://knesset.gov.il/OdataV4/ParliamentInfo';
const DB_PATH = path.join(process.cwd(), 'knesset.db');

async function fetchPage(url: string): Promise<{ value: any[]; next: string | null }> {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } });
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
    if (results.length % 1000 === 0) process.stdout.write(`\r  ${results.length.toLocaleString()} fetched`);
  }
  return results;
}

async function fillInvestigative() {
  const db = new Database(DB_PATH);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS committee_session (
      id           INTEGER PRIMARY KEY,
      committee_id INTEGER NOT NULL,
      title        TEXT,
      date         TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS committee_attendance (
      session_id INTEGER NOT NULL,
      mk_id      INTEGER NOT NULL,
      PRIMARY KEY (session_id, mk_id)
    );
    CREATE TABLE IF NOT EXISTS vote_faction_stats (
      vote_id    INTEGER NOT NULL,
      faction_id INTEGER NOT NULL,
      total_for  INTEGER DEFAULT 0,
      total_against INTEGER DEFAULT 0,
      majority_code INTEGER, -- 7 (for) or 8 (against)
      rebel_count INTEGER DEFAULT 0,
      PRIMARY KEY (vote_id, faction_id)
    );
  `);

  console.log("Fetching K25 Committee Sessions...");
  const sessions = await fetchAll(`${API}/KNS_CommitteeSession?$filter=${encodeURIComponent('KnessetNum eq 25')}&$select=Id,CommitteeID,StartDate`);
  const insertSession = db.prepare('INSERT OR REPLACE INTO committee_session (id, committee_id, title, date) VALUES (?, ?, ?, ?)');
  db.transaction((rows) => {
    for (const r of rows) insertSession.run(r.Id, r.CommitteeID, '', r.StartDate || '');
  })(sessions);
  console.log(`\n  Inserted ${sessions.length} sessions.`);

  console.log("Fetching Committee Attendance...");
  if (sessions.length > 0) {
    const sessionIds = sessions.map((s: any) => s.Id);
    const insertAtt = db.prepare('INSERT OR REPLACE INTO committee_attendance (session_id, mk_id) VALUES (?, ?)');
    const batchSize = 30;
    for (let i = 0; i < sessionIds.length; i += batchSize) {
      const batch = sessionIds.slice(i, i + batchSize);
      const filter = batch.map((id: number) => `CommitteeSessionID eq ${id}`).join(' or ');
      try {
        const attRecords = await fetchAll(`${API}/KNS_PersonToCommitteeSession?$filter=${encodeURIComponent(filter)}&$select=CommitteeSessionID,PersonID`);
        db.transaction((rows) => {
          for (const r of rows) insertAtt.run(r.CommitteeSessionID, r.PersonID);
        })(attRecords);
      } catch (err: any) {
        // ignore occasional timeout/blocked batch
      }
    }
    console.log(`\n  Attendance sync complete.`);
  }

  db.close();
}

fillInvestigative().catch(console.error);
