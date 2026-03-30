/**
 * Builds mk_id_map (kns_id → person_id) and re-keys mk_vote_result so
 * mk_id always equals PersonID — consistent with bills, queries, positions.
 *
 * Problem: KNS_PlenumVoteResult.MkId (KnsID) ≠ KNS_PersonToPosition.PersonID
 * for MKs who are new to K25.  Veteran MKs kept their PersonID as their KnsID;
 * new entrants got a fresh KnsID (32xxx–34xxx range) that has no relation to
 * their PersonID (30xxx range).
 *
 * Solution: KNS_PlenumVoteResult rows include FirstName + LastName inline.
 * Fetch one full-house plenary vote (the 2023 budget, voteId=38740 — all 120
 * MKs present), collect KnsID→name, then name-match against the K25 PersonID
 * list from KNS_PersonToPosition.
 *
 * Usage:
 *   cd apps/knesset-watch
 *   npx tsx scripts/seed-id-map.ts
 */

import Database from 'better-sqlite3';
import path from 'path';

const API = 'https://knesset.gov.il/OdataV4/ParliamentInfo';
const DB_PATH = path.join(process.cwd(), 'knesset.db');

// A full-house plenary vote (2023 budget) — all 120 MKs present
const REFERENCE_VOTE_ID = 38740;

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url.slice(0, 100)}`);
  return res.json();
}

async function fetchAll(url: string): Promise<any[]> {
  const results: any[] = [];
  let next: string | null = url;
  while (next) {
    const data = await fetchJson(next);
    results.push(...(data.value ?? []));
    next = data['@odata.nextLink'] ?? null;
  }
  return results;
}

// Normalise Hebrew name for fuzzy matching
function norm(s: string): string {
  return s.replace(/[״׳"'\-]/g, '').replace(/\s+/g, ' ').trim();
}

async function seedIdMap() {
  const db = new Database(DB_PATH);

  // ── 1. Schema ────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS mk_id_map (
      person_id INTEGER PRIMARY KEY,
      kns_id    INTEGER NOT NULL UNIQUE
    );
    CREATE INDEX IF NOT EXISTS idx_idmap_kns ON mk_id_map (kns_id);
  `);

  // ── 2. Fetch all K25 MKs: PersonID → full name ──────────────────────────
  console.log('Fetching K25 MK list (PersonID + name) …');
  const posRows = await fetchAll(
    `${API}/KNS_PersonToPosition` +
    `?$filter=PositionID eq 54 and KnessetNum eq 25` +
    `&$expand=KNS_Person($select=Id,FirstName,LastName)` +
    `&$select=PersonID`,
  );

  const personMap = new Map<number, string>(); // personId → "First Last"
  for (const r of posRows) {
    const p = r.KNS_Person;
    if (!p) continue;
    const name = `${p.FirstName ?? ''} ${p.LastName ?? ''}`.trim();
    if (!personMap.has(p.Id)) personMap.set(p.Id, name);
  }
  console.log(`  ${personMap.size} distinct K25 PersonIDs\n`);

  // Reverse map: normalised name → personId (for matching)
  const nameToPersonId = new Map<string, number>();
  // Also last-name-only map for fallback
  const lastNameToPersonIds = new Map<string, number[]>();

  for (const [pid, name] of personMap) {
    nameToPersonId.set(norm(name), pid);
    const lastName = norm(name.split(' ').slice(1).join(' '));
    if (lastName) {
      const arr = lastNameToPersonIds.get(lastName) ?? [];
      arr.push(pid);
      lastNameToPersonIds.set(lastName, arr);
    }
  }

  // ── 3. Get all unique KnsIDs present in our vote results ─────────────────
  const knsIdsInVotes = (
    db.prepare('SELECT DISTINCT mk_id FROM mk_vote_result').all() as { mk_id: number }[]
  ).map(r => r.mk_id);
  console.log(`  ${knsIdsInVotes.length} distinct KnsIDs in mk_vote_result\n`);

  // ── 4. Direct matches: KnsID already equals a PersonID ──────────────────
  const personIds = new Set(personMap.keys());
  const directMatches: Array<{ person_id: number; kns_id: number }> = [];
  const needsResolution: number[] = [];

  for (const knsId of knsIdsInVotes) {
    if (personIds.has(knsId)) {
      directMatches.push({ person_id: knsId, kns_id: knsId });
    } else {
      needsResolution.push(knsId);
    }
  }
  console.log(`Direct matches (KnsID = PersonID): ${directMatches.length}`);
  console.log(`Needs name resolution: ${needsResolution.length}\n`);

  // ── 5. Name-based resolution via reference vote ───────────────────────────
  console.log(`Fetching names from reference vote ${REFERENCE_VOTE_ID} …`);
  const voteRows = await fetchAll(
    `${API}/KNS_PlenumVoteResult` +
    `?$filter=VoteID eq ${REFERENCE_VOTE_ID}` +
    `&$select=MkId,FirstName,LastName`,
  );

  // KnsID → name from the vote rows
  const knsIdToName = new Map<number, string>();
  for (const r of voteRows) {
    const name = `${r.FirstName ?? ''} ${r.LastName ?? ''}`.trim();
    if (r.MkId && name) knsIdToName.set(r.MkId, name);
  }
  console.log(`  ${knsIdToName.size} MKs named in reference vote\n`);

  // Resolve unmatched KnsIDs by name
  const nameMatches: Array<{ person_id: number; kns_id: number }> = [];
  const unresolved: number[] = [];

  for (const knsId of needsResolution) {
    const voteName = knsIdToName.get(knsId);
    if (!voteName) {
      // Not in reference vote — try any vote that contains this KnsID
      unresolved.push(knsId);
      continue;
    }

    // Exact name match first
    let personId = nameToPersonId.get(norm(voteName));

    // Fallback: last-name-only match (catches minor spelling differences)
    if (!personId) {
      const lastName = norm(voteName.split(' ').slice(1).join(' '));
      const candidates = lastNameToPersonIds.get(lastName);
      if (candidates?.length === 1) personId = candidates[0];
    }

    if (personId) {
      nameMatches.push({ person_id: personId, kns_id: knsId });
      process.stdout.write(`  ✓ KnsID ${knsId} → PersonID ${personId}  (${voteName})\n`);
    } else {
      unresolved.push(knsId);
      process.stdout.write(`  ✗ KnsID ${knsId} unresolved  (vote name: "${voteName}")\n`);
    }
  }

  // ── 6. For any still-unresolved, try fetching their name from any vote ───
  if (unresolved.length > 0) {
    console.log(`\nFetching names for ${unresolved.length} unresolved KnsIDs from live API …`);
    const finalUnresolved: number[] = [];

    for (const knsId of unresolved) {
      try {
        const rows = await fetchAll(
          `${API}/KNS_PlenumVoteResult` +
          `?$filter=MkId eq ${knsId}` +
          `&$select=MkId,FirstName,LastName` +
          `&$top=1`,
        );
        if (rows.length === 0) { finalUnresolved.push(knsId); continue; }
        const r = rows[0];
        const voteName = `${r.FirstName ?? ''} ${r.LastName ?? ''}`.trim();
        let personId = nameToPersonId.get(norm(voteName));
        if (!personId) {
          const lastName = norm(voteName.split(' ').slice(1).join(' '));
          const candidates = lastNameToPersonIds.get(lastName);
          if (candidates?.length === 1) personId = candidates[0];
        }
        if (personId) {
          nameMatches.push({ person_id: personId, kns_id: knsId });
          process.stdout.write(`  ✓ KnsID ${knsId} → PersonID ${personId}  (${voteName})\n`);
        } else {
          finalUnresolved.push(knsId);
          process.stdout.write(`  ✗ KnsID ${knsId} still unresolved  (name: "${voteName}")\n`);
        }
      } catch {
        finalUnresolved.push(knsId);
      }
    }
  }

  // ── 7. Insert mapping into DB ────────────────────────────────────────────
  const allMappings = [...directMatches, ...nameMatches];
  console.log(`\nInserting ${allMappings.length} mappings into mk_id_map …`);

  const insertMap = db.prepare('INSERT OR REPLACE INTO mk_id_map (person_id, kns_id) VALUES (?, ?)');
  db.transaction(() => {
    for (const m of allMappings) insertMap.run(m.person_id, m.kns_id);
  })();

  // ── 8. Re-key mk_vote_result: replace KnsID with PersonID ────────────────
  const remappings = allMappings.filter(m => m.person_id !== m.kns_id);
  console.log(`Re-keying ${remappings.length} rows in mk_vote_result …`);

  if (remappings.length > 0) {
    const updateVote = db.prepare('UPDATE mk_vote_result SET mk_id = ? WHERE mk_id = ?');
    db.transaction(() => {
      for (const m of remappings) updateVote.run(m.person_id, m.kns_id);
    })();
    console.log(`  Updated mk_id for ${remappings.length} MK identities.`);
  }

  // ── 9. Summary ────────────────────────────────────────────────────────────
  const mapped   = db.prepare('SELECT COUNT(*) as n FROM mk_id_map').get() as { n: number };
  const distinct = db.prepare('SELECT COUNT(DISTINCT mk_id) as n FROM mk_vote_result').get() as { n: number };

  console.log(`
Done!
  mk_id_map entries  : ${mapped.n}
  Distinct PersonIDs in mk_vote_result: ${distinct.n}
  Direct matches     : ${directMatches.length}
  Name-resolved      : ${nameMatches.length}
`);

  db.close();
}

seedIdMap().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
