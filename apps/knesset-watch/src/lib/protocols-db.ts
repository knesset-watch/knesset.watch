// src/lib/protocols-db.ts
// Data access layer for protocol search and RAG.
//
// Search strategy:
//   1. Embed the query with OpenAI text-embedding-3-small
//   2. Vector ANN search on committee_session.embedding in Turso
//   3. Return session-level results (rag_card as snippet)
//
// Context retrieval for /ask:
//   Uses session_speaker_turn rows as "chunks" (filtered to turns already
//   migrated to Turso, i.e. LENGTH(text) > 200).

import { createClient, type Client } from '@libsql/client/http';

const DIMS = 768;

// ── Clients (singletons) ──────────────────────────────────────────────────────

let _turso: Client | null = null;

function getTurso(): Client | null {
  if (!process.env.TURSO_URL) return null;
  if (!_turso) {
    _turso = createClient({
      url: process.env.TURSO_URL,
      authToken: process.env.TURSO_TOKEN,
    });
  }
  return _turso;
}

export function protocolsDbAvailable(): boolean {
  return !!(process.env.TURSO_URL);
}

// ── Embed a query string via Jina AI ─────────────────────────────────────────

async function embedQuery(text: string): Promise<number[] | null> {
  if (!process.env.JINA_API_KEY) return null;
  const res = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.JINA_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'jina-embeddings-v3',
      input: [text],
      dimensions: DIMS,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json() as { data: Array<{ embedding: number[] }> };
  return data.data[0]?.embedding ?? null;
}

// ── Search ────────────────────────────────────────────────────────────────────

export interface ProtocolSearchResult {
  chunkId: number;       // = sessionId (session-level results now)
  sessionId: number;
  committeeId: number;
  committeeName: string;
  date: string;
  title: string | null;
  speaker: string | null;
  snippet: string;
}

export interface ProtocolSearchResponse {
  results: ProtocolSearchResult[];
  total: number;
  page: number;
}

export async function searchProtocols(
  query: string,
  committee: string | null,
  page: number,
): Promise<ProtocolSearchResponse> {
  const client = getTurso();
  if (!client || !query.trim()) return { results: [], total: 0, page };

  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  // Embed the query for vector search
  const embedding = await embedQuery(query);

  if (embedding) {
    // Vector search path — semantically find matching sessions
    const vecRes = await client.execute({
      sql: `
        SELECT cs.id, cs.committee_id, cs.committee_name, cs.date, cs.title, cs.rag_card,
               vector_distance_cos(embedding, vector32(?)) as distance
        FROM committee_session cs
        WHERE cs.embedding IS NOT NULL
          ${committee ? 'AND cs.committee_name = ?' : ''}
        ORDER BY distance ASC
        LIMIT ? OFFSET ?
      `,
      args: committee
        ? [JSON.stringify(embedding), committee, pageSize, offset]
        : [JSON.stringify(embedding), pageSize, offset],
    });

    const results: ProtocolSearchResult[] = vecRes.rows.map(r => ({
      chunkId: Number(r['id']),
      sessionId: Number(r['id']),
      committeeId: Number(r['committee_id'] ?? 0),
      committeeName: String(r['committee_name'] ?? ''),
      date: String(r['date'] ?? ''),
      title: r['title'] != null ? String(r['title']) : null,
      speaker: null,
      snippet: String(r['rag_card'] ?? '').slice(0, 300),
    }));

    // Approximate total — vector search doesn't give exact counts cheaply
    const totalRes = await client.execute({
      sql: `SELECT COUNT(*) as cnt FROM committee_session WHERE embedding IS NOT NULL
            ${committee ? 'AND committee_name = ?' : ''}`,
      args: committee ? [committee] : [],
    });
    const total = Math.min(Number(totalRes.rows[0]['cnt'] ?? 0), 200);

    return { results, total, page };
  }

  // Fallback: simple LIKE search on rag_card (no embedding available)
  const term = `%${query}%`;
  const whereClause = committee
    ? 'WHERE rag_card LIKE ? AND committee_name = ?'
    : 'WHERE rag_card LIKE ?';
  const args = committee ? [term, committee] : [term];

  const countRes = await client.execute({
    sql: `SELECT COUNT(*) as cnt FROM committee_session ${whereClause}`,
    args,
  });
  const total = Number(countRes.rows[0]['cnt'] ?? 0);

  const rowsRes = await client.execute({
    sql: `SELECT id, committee_id, committee_name, date, title, rag_card
          FROM committee_session ${whereClause}
          ORDER BY date DESC LIMIT ? OFFSET ?`,
    args: [...args, pageSize, offset],
  });

  const results: ProtocolSearchResult[] = rowsRes.rows.map(r => ({
    chunkId: Number(r['id']),
    sessionId: Number(r['id']),
    committeeId: Number(r['committee_id'] ?? 0),
    committeeName: String(r['committee_name'] ?? ''),
    date: String(r['date'] ?? ''),
    title: r['title'] != null ? String(r['title']) : null,
    speaker: null,
    snippet: String(r['rag_card'] ?? '').slice(0, 300),
  }));

  return { results, total, page };
}

// ── Session + turns for RAG context ──────────────────────────────────────────

export interface ProtocolSession {
  sessionId: number;
  committeeId: number;
  committeeName: string | null;
  date: string;
  title: string | null;
  docUrl: string | null;
  chunkCount: number;
}

export interface ProtocolChunk {
  chunkIndex: number;
  text: string;
  speaker: string | null;
}

export async function getProtocolSession(
  sessionId: number,
): Promise<{ session: ProtocolSession; chunks: ProtocolChunk[] } | null> {
  const client = getTurso();
  if (!client) return null;

  const [sessionRes, turnsRes] = await Promise.all([
    client.execute({
      sql: `SELECT id, committee_id, committee_name, date, title, protocol_url
            FROM committee_session WHERE id = ?`,
      args: [sessionId],
    }),
    client.execute({
      sql: `SELECT turn_number, text, raw_name
            FROM session_speaker_turn WHERE session_id = ?
            ORDER BY turn_number ASC`,
      args: [sessionId],
    }),
  ]);

  if (sessionRes.rows.length === 0) return null;

  const sr = sessionRes.rows[0];
  const session: ProtocolSession = {
    sessionId: Number(sr['id']),
    committeeId: Number(sr['committee_id'] ?? 0),
    committeeName: sr['committee_name'] != null ? String(sr['committee_name']) : null,
    date: String(sr['date'] ?? ''),
    title: sr['title'] != null ? String(sr['title']) : null,
    docUrl: sr['protocol_url'] != null ? String(sr['protocol_url']) : null,
    chunkCount: turnsRes.rows.length,
  };

  const chunks: ProtocolChunk[] = turnsRes.rows.map((r, i) => ({
    chunkIndex: i,
    text: String(r['text'] ?? ''),
    speaker: r['raw_name'] != null ? String(r['raw_name']) : null,
  }));

  return { session, chunks };
}

export interface CommitteeProtocolSession {
  sessionId: number;
  date: string;
  title: string | null;
  chunkCount: number;
}

export async function getCommitteeProtocolSessions(
  committeeName: string,
): Promise<CommitteeProtocolSession[]> {
  const client = getTurso();
  if (!client) return [];

  const res = await client.execute({
    sql: `SELECT cs.id as sessionId, cs.date, cs.title,
                 COUNT(sst.id) as chunkCount
          FROM committee_session cs
          LEFT JOIN session_speaker_turn sst ON sst.session_id = cs.id
          WHERE cs.committee_name = ?
          GROUP BY cs.id
          ORDER BY cs.date DESC`,
    args: [committeeName],
  });

  return res.rows.map(r => ({
    sessionId: Number(r['sessionId']),
    date: String(r['date'] ?? ''),
    title: r['title'] != null ? String(r['title']) : null,
    chunkCount: Number(r['chunkCount'] ?? 0),
  }));
}

export async function getProtocolCommitteeNames(): Promise<string[]> {
  const client = getTurso();
  if (!client) return [];

  const res = await client.execute(
    `SELECT DISTINCT committee_name FROM committee_session
     WHERE committee_name IS NOT NULL ORDER BY committee_name ASC`,
  );

  return res.rows.map(r => String(r['committee_name'] ?? '')).filter(Boolean);
}
