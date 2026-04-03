/**
 * Turso-backed database client for committee session data.
 *
 * Used in production (Vercel) where there is no local knesset.db.
 * Falls back gracefully when TURSO_URL is not set (local dev uses knesset-db.ts instead).
 * Covers: committee, committee_session, committee_attendance, session_guest,
 *   session_staff, session_agenda_item, session_vote, session_speaker_turn,
 *   mk_person, bill, session_bill, faction.
 *
 * Only covers tables migrated to Turso:
 *   committee, committee_session, committee_attendance, session_guest,
 *   session_staff, session_agenda_item, session_vote, session_speaker_turn,
 *   mk_person, bill, session_bill, faction
 */

import { createClient, type Client } from '@libsql/client';
import type {
  SessionDetail, SessionSummary, CommitteeActivity,
  AttendingMember, SessionGuest, SessionAgendaItem, SessionVote,
  SessionBillLink, SpeakerTurn, CommitteeDetail,
} from './knesset-db';

// ── Singleton client ──────────────────────────────────────────────────────────

let _client: Client | null = null;

export function getTursoClient(): Client | null {
  if (_client) return _client;
  if (!process.env.TURSO_URL) return null;
  _client = createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_TOKEN,
  });
  return _client;
}

export function tursoAvailable(): boolean {
  return !!process.env.TURSO_URL;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function n(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const num = Number(v);
  return isNaN(num) ? null : num;
}
function s(v: unknown): string | null {
  return (v === null || v === undefined) ? null : String(v);
}

// ── Committee session list ────────────────────────────────────────────────────

export async function getTursoCommitteeSessions(
  committeeId: number,
  limit = 100,
): Promise<SessionSummary[]> {
  const client = getTursoClient();
  if (!client) return [];

  const res = await client.execute({
    sql: `
      SELECT
        cs.id, cs.date, cs.title, cs.protocol_number, cs.start_time, cs.end_time,
        (SELECT COUNT(*) FROM committee_attendance WHERE session_id = cs.id) as member_count,
        (SELECT COUNT(*) FROM session_guest       WHERE session_id = cs.id) as guest_count,
        (SELECT COUNT(*) FROM session_agenda_item WHERE session_id = cs.id) as agenda_count,
        (SELECT COUNT(*) FROM session_vote        WHERE session_id = cs.id) as vote_count
      FROM committee_session cs
      WHERE cs.committee_id = ?
      ORDER BY cs.date DESC
      LIMIT ?
    `,
    args: [committeeId, limit],
  });

  return res.rows.map(r => ({
    id: n(r.id)!,
    date: s(r.date)!,
    title: s(r.title),
    protocolNumber: n(r.protocol_number),
    startTime: s(r.start_time),
    endTime: s(r.end_time),
    attendeeCount: (n(r.member_count) ?? 0) + Math.floor((n(r.guest_count) ?? 0) / 2),
    agendaCount: n(r.agenda_count) ?? 0,
    voteCount: n(r.vote_count) ?? 0,
  }));
}

// ── All committee activity ────────────────────────────────────────────────────

export async function getTursoAllCommitteeActivity(
  from?: string,
  to?: string,
): Promise<CommitteeActivity[]> {
  const client = getTursoClient();
  if (!client) return [];

  const dateFilter = from && to
    ? 'AND cs.date >= ? AND cs.date <= ?'
    : from ? 'AND cs.date >= ?'
    : to   ? 'AND cs.date <= ?'
    : '';
  const args: string[] = [from, to].filter(Boolean) as string[];

  const res = await client.execute({
    sql: `
      SELECT c.id as committee_id, c.name,
             COUNT(cs.id) as session_count,
             MAX(cs.date) as last_session_date,
             (SELECT MAX(cs2.date) FROM committee_session cs2
              WHERE cs2.committee_id = c.id ${dateFilter}
              AND EXISTS (SELECT 1 FROM session_speaker_turn sst WHERE sst.session_id = cs2.id)) as last_protocol_date
      FROM committee c
      JOIN committee_session cs ON cs.committee_id = c.id
      WHERE 1=1 ${dateFilter}
      GROUP BY c.id
      HAVING session_count > 0
      ORDER BY session_count DESC
    `,
    args: [...args, ...args],  // args used twice (subquery + main WHERE)
  });

  return res.rows
    .reduce((acc, r) => {
      const name = s(r.name)!;
      if (!acc.find(a => a.name === name)) {
        acc.push({
          committeeId: n(r.committee_id)!,
          name,
          sessionCount: n(r.session_count) ?? 0,
          lastSessionDate: s(r.last_session_date),
          lastProtocolDate: s(r.last_protocol_date),
        });
      }
      return acc;
    }, [] as CommitteeActivity[])
    .sort((a, b) => (b.lastSessionDate ?? '').localeCompare(a.lastSessionDate ?? ''));
}

// ── Session detail ────────────────────────────────────────────────────────────

export async function getTursoSessionDetail(sessionId: number): Promise<SessionDetail | null> {
  const client = getTursoClient();
  if (!client) return null;

  const sessionRes = await client.execute({
    sql: `SELECT id, committee_id, committee_name, date, title,
                 protocol_number, start_time, end_time
          FROM committee_session WHERE id = ?`,
    args: [sessionId],
  });
  if (sessionRes.rows.length === 0) return null;
  const sr = sessionRes.rows[0];

  const [membersRes, guestsRes, staffRes, agendaRes, votesRes, billsRes, docsRes] =
    await Promise.all([
      client.execute({
        sql: `SELECT ca.mk_id, mp.first_name || ' ' || mp.last_name as name, mp.slug,
                     mp.faction_name, mp.is_current as is_coalition, ca.role
              FROM committee_attendance ca
              JOIN mk_person mp ON mp.person_id = ca.mk_id
              WHERE ca.session_id = ?
              ORDER BY ca.role, mp.last_name`,
        args: [sessionId],
      }),
      client.execute({
        sql: `SELECT name, role, organization, attendance_method
              FROM session_guest WHERE session_id = ?
              ORDER BY id`,
        args: [sessionId],
      }),
      client.execute({
        sql: `SELECT role, name_text FROM session_staff WHERE session_id = ? ORDER BY id`,
        args: [sessionId],
      }),
      client.execute({
        sql: `SELECT item_number, title FROM session_agenda_item
              WHERE session_id = ? ORDER BY item_number`,
        args: [sessionId],
      }),
      client.execute({
        sql: `SELECT vote_number, subject, for_count, against_count, abstain_count, passed
              FROM session_vote WHERE session_id = ? ORDER BY vote_number`,
        args: [sessionId],
      }),
      client.execute({
        sql: `SELECT sb.bill_id, b.title
              FROM session_bill sb LEFT JOIN bill b ON b.id = sb.bill_id
              WHERE sb.session_id = ?`,
        args: [sessionId],
      }),
      // Documents aren't migrated to Turso — return empty
      Promise.resolve({ rows: [] }),
    ]);

  const members: AttendingMember[] = membersRes.rows.map(r => ({
    mkId: n(r.mk_id)!,
    name: s(r.name)!,
    slug: s(r.slug),
    factionName: s(r.faction_name),
    isCoalition: r.is_coalition === null ? null : Number(r.is_coalition) === 1,
    role: s(r.role)!,
  }));

  const guests: SessionGuest[] = guestsRes.rows.map(r => ({
    name: s(r.name)!,
    role: s(r.role),
    organization: s(r.organization),
    method: s(r.attendance_method),
  }));

  const staff: SessionDetail['staff'] = staffRes.rows.map(r => ({
    role: s(r.role)!,
    name: s(r.name_text)!,
  }));

  const agenda: SessionAgendaItem[] = agendaRes.rows.map(r => ({
    itemNumber: n(r.item_number)!,
    title: s(r.title)!,
  }));

  const votes: SessionVote[] = votesRes.rows.map(r => ({
    voteNumber: n(r.vote_number)!,
    subject: s(r.subject),
    result: null,
    forCount: n(r.for_count) ?? 0,
    againstCount: n(r.against_count) ?? 0,
    abstainCount: n(r.abstain_count) ?? 0,
    passed: r.passed === null ? null : Number(r.passed) === 1,
  }));

  const bills: SessionBillLink[] = billsRes.rows.map(r => ({
    billId: n(r.bill_id)!,
    title: s(r.title),
  }));

  return {
    id: n(sr.id)!,
    committeeId: n(sr.committee_id)!,
    committeeName: s(sr.committee_name),
    date: s(sr.date)!,
    title: s(sr.title),
    protocolNumber: n(sr.protocol_number),
    startTime: s(sr.start_time),
    endTime: s(sr.end_time),
    members,
    guests,
    staff,
    agenda,
    votes,
    bills,
    documents: [],
  };
}

// ── Speaker turns ─────────────────────────────────────────────────────────────

export async function getTursoSessionSpeakerTurns(
  sessionId: number,
  mkId?: number,
): Promise<SpeakerTurn[]> {
  const client = getTursoClient();
  if (!client) return [];

  const res = await client.execute(mkId ? {
    sql: `SELECT st.turn_number, st.mk_id, st.raw_name, st.faction_name,
                 mp.slug, st.speaker_role, st.text
          FROM session_speaker_turn st
          LEFT JOIN mk_person mp ON mp.person_id = st.mk_id
          WHERE st.session_id = ? AND st.mk_id = ?
          ORDER BY st.turn_number`,
    args: [sessionId, mkId],
  } : {
    sql: `SELECT st.turn_number, st.mk_id, st.raw_name, st.faction_name,
                 mp.slug, st.speaker_role, st.text
          FROM session_speaker_turn st
          LEFT JOIN mk_person mp ON mp.person_id = st.mk_id
          WHERE st.session_id = ?
          ORDER BY st.turn_number`,
    args: [sessionId],
  });

  return res.rows.map(r => ({
    turnNumber: n(r.turn_number)!,
    mkId: n(r.mk_id),
    rawName: s(r.raw_name),
    factionName: s(r.faction_name),
    slug: s(r.slug),
    speakerRole: s(r.speaker_role),
    text: s(r.text)!,
  }));
}

// ── Committee detail ──────────────────────────────────────────────────────────

export async function getTursoCommitteeDetail(name: string): Promise<CommitteeDetail | null> {
  const client = getTursoClient();
  if (!client) return null;

  const committeeRes = await client.execute({
    sql: `SELECT id FROM committee WHERE name = ? ORDER BY id DESC LIMIT 1`,
    args: [name],
  });
  const committeeId = committeeRes.rows.length > 0 ? n(committeeRes.rows[0].id) : null;
  if (!committeeId) return null;

  const [sessionRes, billRes, billRows] = await Promise.all([
    client.execute({
      sql: `SELECT COUNT(*) as cnt FROM committee_session WHERE committee_id = ?`,
      args: [committeeId],
    }),
    client.execute({
      sql: `SELECT COUNT(*) as total, SUM(CAST(is_passed AS INTEGER)) as passed FROM bill WHERE committee_name = ?`,
      args: [name],
    }),
    client.execute({
      sql: `SELECT id, title, subtype, is_passed, status_desc, summary, doc_url, micro_agenda, macro_agenda, init_date
            FROM bill WHERE committee_name = ? ORDER BY is_passed DESC, id DESC`,
      args: [name],
    }),
  ]);

  return {
    name,
    committeeId,
    billCount: n(billRes.rows[0]?.total) ?? 0,
    passedCount: n(billRes.rows[0]?.passed) ?? 0,
    sessionCount: n(sessionRes.rows[0]?.cnt) ?? 0,
    members: [], // mk_position not migrated to Turso
    bills: billRows.rows.map(r => ({
      billId: n(r.id)!,
      title: s(r.title)!,
      subtype: s(r.subtype) ?? '',
      isPassed: Number(r.is_passed) === 1,
      statusDesc: s(r.status_desc),
      summary: s(r.summary),
      docUrl: s(r.doc_url),
      microAgenda: s(r.micro_agenda),
      macroAgenda: s(r.macro_agenda),
      initDate: s(r.init_date),
      initiators: [],
    })),
  };
}

// ── Vector search (RAG) ───────────────────────────────────────────────────────

export async function tursoVectorSearch(
  embedding: number[],
  limit = 8,
): Promise<Array<{ sessionId: number; committeeName: string | null; date: string; title: string | null; ragCard: string }>> {
  const client = getTursoClient();
  if (!client) return [];

  // Turso vector search: vector_distance_cos returns cosine distance (lower = more similar)
  const res = await client.execute({
    sql: `
      SELECT id, committee_name, date, title, rag_card,
             vector_distance_cos(embedding, vector32(?)) as distance
      FROM committee_session
      WHERE embedding IS NOT NULL
      ORDER BY distance ASC
      LIMIT ?
    `,
    args: [JSON.stringify(embedding), limit],
  });

  return res.rows.map(r => ({
    sessionId: n(r.id)!,
    committeeName: s(r.committee_name),
    date: s(r.date)!,
    title: s(r.title),
    ragCard: s(r.rag_card)!,
  }));
}
