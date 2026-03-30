/**
 * Smart Incremental Sync — Engine Room Version
 * Focuses on filling the "Investigation Gap" without re-scanning historical core data.
 */

import Database from 'better-sqlite3';
import path from 'path';

const API = 'https://knesset.gov.il/OdataV4/ParliamentInfo';
const DB_PATH = path.join(process.cwd(), 'knesset.db');
const K25_START = '2022-11-15T00:00:00+02:00';

async function fetchPage(url: string): Promise<{ value: any[]; next: string | null }> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`Knesset API ${res.status}`);
  const json = await res.json();
  return { value: json.value ?? [], next: json['@odata.nextLink'] ?? null };
}

async function fetchAll(url: string, limit = 50000): Promise<any[]> {
  const results: any[] = [];
  let next: string | null = url;
  while (next && results.length < limit) {
    const page = await fetchPage(next);
    results.push(...page.value);
    next = page.next;
    if (results.length % 500 === 0 && results.length > 0) process.stdout.write(`    ${results.length.toLocaleString()} records...`);
  }
  return results;
}

async function sync() {
  const db = new Database(DB_PATH);

  // ── 1. Determine High-Water Marks (Don't rescan old info) ──────────────────
  const { lastVoteId } = db.prepare('SELECT MAX(id) as lastVoteId FROM plenary_vote').get() as { lastVoteId: number };
  const { lastBillId } = db.prepare('SELECT MAX(id) as lastBillId FROM bill').get() as { lastBillId: number };
  
  // For new tables, we check if they are empty
  const { lobbyCount } = db.prepare('SELECT COUNT(*) as lobbyCount FROM lobbyist').get() as { lobbyCount: number };
  const { attendanceCount } = db.prepare('SELECT COUNT(*) as attendanceCount FROM committee_attendance').get() as { attendanceCount: number };

  console.log(`Starting Smart Sync.`);
  console.log(`  Current High-Water Marks: Vote ID ${lastVoteId}, Bill ID ${lastBillId}`);

  // ── 2. Sync NEW Bills only (since last high-water mark) ───────────────────
  console.log("  Fetching NEW bills since last sync...");
  const newBills = await fetchAll(`${API}/KNS_Bill?$filter=KnessetNum eq 25 and Id gt ${lastVoteId}&$select=Id,Name,SubTypeDesc,StatusID,CommitteeID,SummaryLaw,PublicationDate`);
  if (newBills.length > 0) {
    const insertBill = db.prepare('INSERT OR REPLACE INTO bill (id, title, subtype, status_id, is_passed, committee_id, publication_date) VALUES (?, ?, ?, ?, ?, ?, ?)');
    db.transaction((rows) => {
      for (const r of rows) insertBill.run(r.Id, r.Name, r.SubTypeDesc, r.StatusID, 0, r.CommitteeID, r.PublicationDate);
    })(newBills);
    console.log(`
    Sync'd ${newBills.length} NEW bills.`);
  } else {
    console.log("    No new bills found.");
  }

  // ── 3. Fill the Lobbyist Gap (Backfill once, then incremental) ────────────
  if (lobbyCount === 0) {
    console.log("  Backfilling Lobbyists (K25)...");
    const lobbyists = await fetchAll(`${API}/V_Lobbyists?$select=Id,FullName,CorporationName`);
    const insertLobby = db.prepare('INSERT OR REPLACE INTO lobbyist (id, first_name, last_name, is_active) VALUES (?, ?, ?, 1)');
    const insertClient = db.prepare('INSERT OR REPLACE INTO lobbyist_client (lobbyist_id, client_name) VALUES (?, ?)');
    
    db.transaction((rows) => {
      for (const r of rows) {
        const names = (r.FullName || '').split(' ');
        const first = names[0] || 'Unknown';
        const last = names.slice(1).join(' ') || '';
        insertLobby.run(r.Id, first, last);
        if (r.CorporationName) insertClient.run(r.Id, r.CorporationName);
      }
    })(lobbyists);
    console.log(`
    Loaded ${lobbyists.length} lobbyists.`);
  }

  // ── 4. Fill the Attendance Gap (Incremental since K25 start) ──────────────
  // We sync committee sessions from the last known session ID or K25 start
  const { lastSessionId } = db.prepare('SELECT COALESCE(MAX(id), 0) as lastSessionId FROM committee_session').get() as { lastSessionId: number };
  console.log(`  Syncing Committee Sessions since ID ${lastSessionId}...`);
  
  const newSessions = await fetchAll(`${API}/KNS_CommitteeSession?$filter=KnessetNum eq 25 and Id gt ${lastSessionId}&$select=Id,CommitteeID,Name,SessionDate`, 2000);
  
  if (newSessions.length > 0) {
    const insertSession = db.prepare('INSERT OR REPLACE INTO committee_session (id, committee_id, title, date) VALUES (?, ?, ?, ?)');
    const insertAtt = db.prepare('INSERT OR REPLACE INTO committee_attendance (session_id, mk_id) VALUES (?, ?)');
    
    db.transaction((rows) => {
      for (const r of rows) insertSession.run(r.Id, r.CommitteeID, r.Name, r.SessionDate);
    })(newSessions);

    console.log(`
    Fetching attendance for ${newSessions.length} sessions...`);
    // Batch fetch attendance to avoid URL length limits
    const sessionIds = newSessions.map(s => s.Id);
    const batchSize = 40;
    for (let i = 0; i < sessionIds.length; i += batchSize) {
      const batch = sessionIds.slice(i, i + batchSize);
      const filter = batch.map(id => `CommitteeSessionID eq ${id}`).join(' or ');
      const attRecords = await fetchAll(`${API}/KNS_PersonToCommitteeSession?$filter=${encodeURIComponent(filter)}&$select=CommitteeSessionID,PersonID`, 5000);
      db.transaction((rows) => {
        for (const r of rows) insertAtt.run(r.CommitteeSessionID, r.PersonID);
      })(attRecords);
    }
    console.log(`
    Attendance sync complete.`);
  } else {
    console.log("    No new sessions to sync.");
  }

  // ── 5. Derived Stats: The Rebellion Engine ────────────────────────────────
  // Only calculate for votes that don't have stats yet
  console.log("  Updating Rebellion Stats...");
  const factions = db.prepare('SELECT DISTINCT faction_id FROM mk_person WHERE faction_id IS NOT NULL').all() as any[];
  const uncalculatedVotes = db.prepare(`
    SELECT id FROM plenary_vote 
    WHERE id NOT IN (SELECT DISTINCT vote_id FROM vote_faction_stats)
    ORDER BY date DESC LIMIT 200
  `).all() as any[];

  if (uncalculatedVotes.length > 0) {
    const insertDiscipline = db.prepare(`
      INSERT OR REPLACE INTO vote_faction_stats (vote_id, faction_id, total_for, total_against, majority_code, rebel_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      for (const v of uncalculatedVotes) {
        for (const f of factions) {
          const results = db.prepare(`
            SELECT r.result_code, COUNT(*) as cnt
            FROM mk_vote_result r
            JOIN mk_person p ON p.person_id = r.mk_id
            WHERE r.vote_id = ? AND p.faction_id = ? AND r.result_code IN (7, 8)
            GROUP BY r.result_code
          `).all(v.id, f.faction_id) as any[];

          let forCnt = 0, againstCnt = 0;
          for (const res of results) {
            if (res.result_code === 7) forCnt = res.cnt;
            if (res.result_code === 8) againstCnt = res.cnt;
          }

          if (forCnt + againstCnt > 0) {
            const majority = forCnt >= againstCnt ? 7 : 8;
            const rebels = majority === 7 ? againstCnt : forCnt;
            insertDiscipline.run(v.id, f.faction_id, forCnt, againstCnt, majority, rebels);
          }
        }
      }
    })();
    console.log(`    Updated stats for ${uncalculatedVotes.length} votes.`);
  } else {
    console.log("    Rebellion stats are up to date.");
  }

  db.close();
  console.log("Incremental Smart Sync Finished.");
}

sync().catch(err => {
  console.error('Sync failed:', err.message);
  process.exit(1);
});
