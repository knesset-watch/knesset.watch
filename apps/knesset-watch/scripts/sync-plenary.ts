/**
 * Syncs K25 plenary session metadata from Knesset OData → knesset.db.
 * Fetches session list + protocol document URL for each session.
 *
 * Run: cd apps/knesset-watch && npx tsx scripts/sync-plenary.ts
 */
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const db = new Database(DB_PATH);
const API_BASE = process.env.KNESSET_API_BASE ?? 'https://knesset.gov.il/OdataV4/ParliamentInfo';
const PAGE_SIZE = 100;

const upsert = db.prepare(`
  INSERT INTO plenary_session (id, session_number, knesset_num, name, start_date, protocol_url, has_protocol, last_synced)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    session_number = excluded.session_number,
    name = excluded.name,
    start_date = excluded.start_date,
    protocol_url = excluded.protocol_url,
    has_protocol = excluded.has_protocol,
    last_synced = excluded.last_synced
`);

async function fetchJson(url: string) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function getProtocolUrl(sessionId: number): Promise<string | null> {
  const url = `${API_BASE}/KNS_DocumentPlenumSession?$filter=PlenumSessionID eq ${sessionId} and GroupTypeID eq 28&$select=FilePath&$top=1`;
  try {
    const data = await fetchJson(url) as { value: Array<{ FilePath: string }> };
    return data.value?.[0]?.FilePath ?? null;
  } catch { return null; }
}

async function main() {
  let skip = 0;
  let total = 0;

  while (true) {
    const url = `${API_BASE}/KNS_PlenumSession?$filter=KnessetNum eq 25&$orderby=Id asc&$top=${PAGE_SIZE}&$skip=${skip}`;
    const data = await fetchJson(url) as { value: unknown[] };
    const sessions = data.value as Array<{ Id: number; Number: number; KnessetNum: number; Name: string; StartDate: string }>;
    if (sessions.length === 0) break;

    for (const s of sessions) {
      const protocolUrl = await getProtocolUrl(s.Id);
      upsert.run(
        s.Id, s.Number, s.KnessetNum, s.Name, s.StartDate,
        protocolUrl, protocolUrl ? 1 : 0, new Date().toISOString()
      );
      total++;
    }
    console.log(`Synced ${total} sessions (skip=${skip})`);
    if (sessions.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
    await new Promise(r => setTimeout(r, 300));
  }

  const stats = db.prepare('SELECT COUNT(*) as n, SUM(has_protocol) as with_proto FROM plenary_session').get() as { n: number; with_proto: number };
  console.log(`Done. Total: ${stats.n}, with protocol: ${stats.with_proto}`);
}

main().catch(e => { console.error(e); process.exit(1); });
