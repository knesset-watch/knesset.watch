import { kv } from '@vercel/kv';

const KNESSET_ORIGIN = 'https://knesset.gov.il';
const PROXY_BASE = (process.env.KNESSET_PROXY_URL ?? KNESSET_ORIGIN) + '/OdataV4/ParliamentInfo';
const K25_START = '2022-11-15T00:00:00+02:00';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VoteSummary {
  voteId: number;
  title: string;
  date: string;
}

export interface MkResult {
  mkId: number;
  firstName: string;
  lastName: string;
  result: 'בעד' | 'נגד' | 'נמנע' | 'נוכח';
  party?: string;
  isCoalition?: boolean;
}

export interface VoteResultData {
  title: string;
  date: string;
  mkResults: MkResult[];
}

export interface AgendaVotesData {
  votes: VoteSummary[];
  lastFetched: number;
}

export interface MkAgendaTopic {
  topicId: string;
  label: string;
  votes: Array<VoteSummary & { result: string | null }>; // null = absent
}

export interface MkAgendaData {
  topics: MkAgendaTopic[];
  lastFetched: number;
}

export interface MkLookupEntry {
  name: string;
  party: string;
  isCoalition: boolean;
}

// ── TTLs ──────────────────────────────────────────────────────────────────────

const TTL_AGENDA_VOTES  = 6  * 60 * 60;  // 6h
const TTL_VOTE_RESULTS  = 30 * 24 * 60 * 60; // 30d
const TTL_MK_LOOKUP     = 24 * 60 * 60;  // 24h
const TTL_MK_AGENDA     = 6  * 60 * 60;  // 6h

// ── KV helpers ────────────────────────────────────────────────────────────────

const kvEnabled = () => !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;

async function kvGet<T>(key: string): Promise<T | null> {
  if (!kvEnabled()) return null;
  try {
    return await kv.get<T>(key);
  } catch {
    return null;
  }
}

async function kvSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  if (!kvEnabled()) return;
  try {
    await kv.set(key, value, { ex: ttlSeconds });
  } catch {
    // silently fail — cache is best-effort
  }
}

// ── Agenda votes cache ─────────────────────────────────────────────────────────

export async function getCachedAgendaVotes(topicId: string): Promise<AgendaVotesData | null> {
  return kvGet<AgendaVotesData>(`agenda-votes:${topicId}`);
}

export async function setCachedAgendaVotes(topicId: string, data: AgendaVotesData): Promise<void> {
  return kvSet(`agenda-votes:${topicId}`, data, TTL_AGENDA_VOTES);
}

// ── Vote results cache ────────────────────────────────────────────────────────

export async function getCachedVoteResults(voteId: number): Promise<VoteResultData | null> {
  return kvGet<VoteResultData>(`vote-results:${voteId}`);
}

export async function setCachedVoteResults(voteId: number, data: VoteResultData): Promise<void> {
  return kvSet(`vote-results:${voteId}`, data, TTL_VOTE_RESULTS);
}

// ── MK agenda cache ───────────────────────────────────────────────────────────

export async function getCachedMkAgenda(mkId: string): Promise<MkAgendaData | null> {
  return kvGet<MkAgendaData>(`mk-agenda:${mkId}`);
}

export async function setCachedMkAgenda(mkId: string, data: MkAgendaData): Promise<void> {
  return kvSet(`mk-agenda:${mkId}`, data, TTL_MK_AGENDA);
}

// ── MK lookup cache ───────────────────────────────────────────────────────────

export async function getCachedMkLookup(): Promise<Record<string, MkLookupEntry> | null> {
  return kvGet<Record<string, MkLookupEntry>>('mk-lookup');
}

export async function setCachedMkLookup(data: Record<string, MkLookupEntry>): Promise<void> {
  return kvSet('mk-lookup', data, TTL_MK_LOOKUP);
}

// ── Knesset API fetchers ──────────────────────────────────────────────────────

async function knessetFetch(path: string): Promise<any> {
  const url = `${PROXY_BASE}/${path}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Knesset API error ${res.status}: ${path}`);
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) {
    const body = await res.text();
    throw new Error(`Knesset returned non-JSON (${contentType}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

export async function fetchAgendaVotesFromKnesset(keywords: string[]): Promise<VoteSummary[]> {
  const kwFilter = keywords
    .map(kw => `contains(VoteTitle,'${kw.replace(/'/g, "''")}')`)
    .join(' or ');

  const filter = `(${kwFilter}) and VoteDateTime ge ${K25_START}`;
  const path =
    `KNS_PlenumVote` +
    `?$filter=${encodeURIComponent(filter)}` +
    `&$select=Id,VoteTitle,VoteDateTime` +
    `&$orderby=VoteDateTime desc` +
    `&$top=200`;

  const data = await knessetFetch(path);
  const items: Array<{ Id: number; VoteTitle: string; VoteDateTime: string }> = data.value ?? [];

  // Deduplicate by Id
  const seen = new Set<number>();
  const votes: VoteSummary[] = [];
  for (const item of items) {
    if (seen.has(item.Id)) continue;
    seen.add(item.Id);
    votes.push({
      voteId: item.Id,
      title: item.VoteTitle ?? '',
      date: item.VoteDateTime ?? '',
    });
  }
  return votes;
}

// ResultCode → Hebrew label
const RESULT_CODE_LABEL: Record<number, string> = { 6: 'נוכח', 7: 'בעד', 8: 'נגד', 9: 'נמנע' };

/**
 * For a given MK, fetch their vote result on a specific set of vote IDs.
 * Batches into parallel OR-filter queries (30 per batch) so we only ask for
 * exactly what we need — no full history pagination required.
 * Returns a map of voteId → Hebrew result label.
 */
export async function fetchMkResultsForVotes(
  mkId: number,
  voteIds: number[],
): Promise<Record<number, string>> {
  if (voteIds.length === 0) return {};

  const BATCH = 30;
  const batches: number[][] = [];
  for (let i = 0; i < voteIds.length; i += BATCH) {
    batches.push(voteIds.slice(i, i + BATCH));
  }

  // All batches run in parallel
  const batchResults = await Promise.all(
    batches.map(async (batch) => {
      const voteFilter = batch.map(id => `VoteID eq ${id}`).join(' or ');
      const filter = `MkId eq ${mkId} and (${voteFilter})`;
      const path =
        `KNS_PlenumVoteResult` +
        `?$filter=${encodeURIComponent(filter)}` +
        `&$select=VoteID,ResultCode` +
        `&$top=${BATCH}`;
      const data = await knessetFetch(path);
      return (data.value ?? []) as Array<{ VoteID: number; ResultCode: number }>;
    }),
  );

  const map: Record<number, string> = {};
  for (const rows of batchResults) {
    for (const row of rows) {
      map[row.VoteID] = RESULT_CODE_LABEL[row.ResultCode] ?? 'נוכח';
    }
  }
  return map;
}

export async function fetchVoteResultsFromKnesset(voteId: number): Promise<{ title: string; date: string; mkResults: MkResult[] }> {
  // First fetch vote metadata (title + date)
  const metaPath =
    `KNS_PlenumVote` +
    `?$filter=Id eq ${voteId}` +
    `&$select=Id,VoteTitle,VoteDateTime`;
  const metaData = await knessetFetch(metaPath);
  const meta = (metaData.value ?? [])[0] as { Id: number; VoteTitle: string; VoteDateTime: string } | undefined;

  // Then fetch all MK results for this vote
  const resultsPath =
    `KNS_PlenumVoteResult` +
    `?$filter=VoteID eq ${voteId}` +
    `&$select=MkId,ResultDesc,FirstName,LastName` +
    `&$top=200`;
  const resultsData = await knessetFetch(resultsPath);
  const items: Array<{ MkId: number; ResultDesc: string; FirstName: string; LastName: string }> =
    resultsData.value ?? [];

  const mkResults: MkResult[] = items.map(item => ({
    mkId: item.MkId,
    firstName: item.FirstName ?? '',
    lastName: item.LastName ?? '',
    result: (item.ResultDesc ?? 'נוכח') as MkResult['result'],
  }));

  return {
    title: meta?.VoteTitle ?? '',
    date: meta?.VoteDateTime ?? '',
    mkResults,
  };
}
