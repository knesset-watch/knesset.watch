// scripts/probe-protocol-api.ts
// Run: npm run db:probe-protocols
// Purpose: Discover what GroupTypeID corresponds to protocol documents.

import Database from 'better-sqlite3';
import path from 'path';

const API = 'https://knesset.gov.il/OdataV4/ParliamentInfo';
const DB_PATH = path.join(process.cwd(), 'knesset.db');

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function probe() {
  const db = new Database(DB_PATH, { readonly: true });

  // Pick 20 sessions spread across different committees
  const sessions = db.prepare(`
    SELECT id, committee_id, date FROM committee_session
    ORDER BY id DESC LIMIT 20
  `).all() as Array<{ id: number; committee_id: number; date: string }>;

  console.log(`Probing ${sessions.length} sessions...\n`);

  const groupTypeCounts: Record<string, number> = {};
  let sessionsWithDocs = 0;

  for (const s of sessions) {
    const url = `${API}/KNS_DocumentCommitteeSession?$filter=CommitteeSessionID eq ${s.id}&$select=GroupTypeID,GroupTypeDesc,ApplicationID,ApplicationDesc,FilePath`;
    try {
      const json = await fetchJson(url);
      const docs: any[] = json.value ?? [];
      if (docs.length > 0) {
        sessionsWithDocs++;
        for (const doc of docs) {
          const key = `GroupTypeID=${doc.GroupTypeID} (${doc.GroupTypeDesc}) | AppID=${doc.ApplicationID} (${doc.ApplicationDesc})`;
          groupTypeCounts[key] = (groupTypeCounts[key] ?? 0) + 1;
          if (doc.FilePath) {
            console.log(`Session ${s.id}: ${key}`);
            console.log(`  FilePath: ${doc.FilePath}`);
          }
        }
      }
    } catch (e: any) {
      console.log(`Session ${s.id}: ERROR — ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n=== GroupType Summary ===');
  for (const [k, v] of Object.entries(groupTypeCounts)) {
    console.log(`  ${v}x ${k}`);
  }
  console.log(`\nSessions with documents: ${sessionsWithDocs}/${sessions.length}`);
  db.close();
}

probe().catch(err => {
  console.error(err.message);
  process.exit(1);
});
