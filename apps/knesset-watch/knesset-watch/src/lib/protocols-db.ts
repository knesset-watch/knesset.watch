// src/lib/protocols-db.ts
// Data access layer for protocols — uses Turso (libSQL) for hosted SQLite.

import { createClient, type Client } from '@libsql/client/http';

let _client: Client | null = null;

function getClient(): Client {
  if (!_client) {
    _client = createClient({
      url: process.env.TURSO_URL!,
      authToken: process.env.TURSO_TOKEN,
    });
  }
  return _client;
}

export function protocolsDbAvailable(): boolean {
  return !!(process.env.TURSO_URL);
}

export interface ProtocolSearchResult {
  chunkId: number;
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
  if (!process.env.TURSO_URL) return { results: [], total: 0, page };

  const client = getClient();
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  // Escape special FTS5 characters
  const safeQuery = query.replace(/["*^()?!:]/g, ' ').trim();
  if (!safeQuery) return { results: [], total: 0, page };

  if (committee) {
    const countRes = await client.execute({
      sql: `SELECT COUNT(*) as cnt
            FROM protocol_chunk_fts
            JOIN protocol_chunk pc ON pc.id = protocol_chunk_fts.rowid
            WHERE protocol_chunk_fts MATCH ? AND pc.committee_name = ?`,
      args: [safeQuery, committee],
    });
    const total = Number(countRes.rows[0]['cnt'] ?? 0);

    const rowsRes = await client.execute({
      sql: `SELECT
              pc.id as chunkId,
              pc.session_id as sessionId,
              sp.committee_id as committeeId,
              pc.committee_name as committeeName,
              pc.date,
              sp.title,
              pc.speaker,
              snippet(protocol_chunk_fts, 0, '<mark>', '</mark>', '...', 20) as snippet
            FROM protocol_chunk_fts
            JOIN protocol_chunk pc ON pc.id = protocol_chunk_fts.rowid
            JOIN session_protocol sp ON sp.session_id = pc.session_id
            WHERE protocol_chunk_fts MATCH ? AND pc.committee_name = ?
            ORDER BY rank
            LIMIT ? OFFSET ?`,
      args: [safeQuery, committee, pageSize, offset],
    });

    const results = rowsRes.rows.map(row => ({
      chunkId: Number(row['chunkId']),
      sessionId: Number(row['sessionId']),
      committeeId: Number(row['committeeId']),
      committeeName: String(row['committeeName'] ?? ''),
      date: String(row['date'] ?? ''),
      title: row['title'] != null ? String(row['title']) : null,
      speaker: row['speaker'] != null ? String(row['speaker']) : null,
      snippet: String(row['snippet'] ?? ''),
    }));

    return { results, total, page };
  }

  const countRes = await client.execute({
    sql: `SELECT COUNT(*) as cnt FROM protocol_chunk_fts WHERE protocol_chunk_fts MATCH ?`,
    args: [safeQuery],
  });
  const total = Number(countRes.rows[0]['cnt'] ?? 0);

  const rowsRes = await client.execute({
    sql: `SELECT
            pc.id as chunkId,
            pc.session_id as sessionId,
            sp.committee_id as committeeId,
            pc.committee_name as committeeName,
            pc.date,
            sp.title,
            pc.speaker,
            snippet(protocol_chunk_fts, 0, '<mark>', '</mark>', '...', 20) as snippet
          FROM protocol_chunk_fts
          JOIN protocol_chunk pc ON pc.id = protocol_chunk_fts.rowid
          JOIN session_protocol sp ON sp.session_id = pc.session_id
          WHERE protocol_chunk_fts MATCH ?
          ORDER BY rank
          LIMIT ? OFFSET ?`,
    args: [safeQuery, pageSize, offset],
  });

  const results = rowsRes.rows.map(row => ({
    chunkId: Number(row['chunkId']),
    sessionId: Number(row['sessionId']),
    committeeId: Number(row['committeeId']),
    committeeName: String(row['committeeName'] ?? ''),
    date: String(row['date'] ?? ''),
    title: row['title'] != null ? String(row['title']) : null,
    speaker: row['speaker'] != null ? String(row['speaker']) : null,
    snippet: String(row['snippet'] ?? ''),
  }));

  return { results, total, page };
}

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
  if (!process.env.TURSO_URL) return null;

  const client = getClient();

  const sessionRes = await client.execute({
    sql: `SELECT session_id as sessionId, committee_id as committeeId,
                 committee_name as committeeName, date, title,
                 doc_url as docUrl, chunk_count as chunkCount
          FROM session_protocol WHERE session_id = ?`,
    args: [sessionId],
  });

  if (sessionRes.rows.length === 0) return null;

  const r = sessionRes.rows[0];
  const session: ProtocolSession = {
    sessionId: Number(r['sessionId']),
    committeeId: Number(r['committeeId']),
    committeeName: r['committeeName'] != null ? String(r['committeeName']) : null,
    date: String(r['date'] ?? ''),
    title: r['title'] != null ? String(r['title']) : null,
    docUrl: r['docUrl'] != null ? String(r['docUrl']) : null,
    chunkCount: Number(r['chunkCount'] ?? 0),
  };

  const chunksRes = await client.execute({
    sql: `SELECT chunk_index as chunkIndex, text, speaker
          FROM protocol_chunk WHERE session_id = ?
          ORDER BY chunk_index ASC`,
    args: [sessionId],
  });

  const chunks: ProtocolChunk[] = chunksRes.rows.map(row => ({
    chunkIndex: Number(row['chunkIndex']),
    text: String(row['text'] ?? ''),
    speaker: row['speaker'] != null ? String(row['speaker']) : null,
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
  if (!process.env.TURSO_URL) return [];

  const client = getClient();

  const res = await client.execute({
    sql: `SELECT session_id as sessionId, date, title, chunk_count as chunkCount
          FROM session_protocol WHERE committee_name = ?
          ORDER BY date DESC`,
    args: [committeeName],
  });

  return res.rows.map(row => ({
    sessionId: Number(row['sessionId']),
    date: String(row['date'] ?? ''),
    title: row['title'] != null ? String(row['title']) : null,
    chunkCount: Number(row['chunkCount'] ?? 0),
  }));
}

export async function getProtocolCommitteeNames(): Promise<string[]> {
  if (!process.env.TURSO_URL) return [];

  const client = getClient();

  const res = await client.execute(
    `SELECT DISTINCT committee_name FROM session_protocol
     WHERE committee_name IS NOT NULL ORDER BY committee_name ASC`,
  );

  return res.rows.map(row => String(row['committee_name'] ?? '')).filter(Boolean);
}
