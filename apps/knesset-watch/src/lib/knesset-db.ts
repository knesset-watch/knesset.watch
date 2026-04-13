/**
 * Local SQLite database for Knesset K25 vote data.
 *
 * The database file (knesset.db) lives at the project root.
 * It is seeded once via `npm run db:seed` and updated nightly by GitHub Actions.
 *
 * If the file doesn't exist yet (before first seed), all functions return null/[]
 * and callers fall back to the live Knesset API.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { MK_NICKNAMES } from './nicknames';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

const CODE_TO_LABEL: Record<number, string> = {
  6: 'נוכח',
  7: 'בעד',
  8: 'נגד',
  9: 'נמנע',
};

// Singleton connection — reused across requests within a warm serverless instance
let _db: Database.Database | null = null;

function getDb(): Database.Database | null {
  if (_db) return _db;
  if (!fs.existsSync(DB_PATH)) return null;
  _db = new Database(DB_PATH, { readonly: true });
  return _db;
}

/** Whether the local database is available */
export function dbAvailable(): boolean {
  return fs.existsSync(DB_PATH);
}

export interface MkPerson {
  personId: number;
  firstName: string;
  lastName: string;
  factionId: number | null;
  factionName: string | null;
  slug: string | null;
}

export function getMkPerson(mkId: number): MkPerson | null {
  const db = getDb();
  if (!db) return null;

  const row = db
    .prepare(`SELECT person_id, first_name, last_name, faction_id, faction_name, slug FROM mk_person WHERE person_id = ?`)
    .get(mkId) as { person_id: number; first_name: string; last_name: string; faction_id: number | null; faction_name: string | null; slug: string | null } | undefined;

  if (!row) return null;
  return {
    personId: row.person_id,
    firstName: row.first_name,
    lastName: row.last_name,
    factionId: row.faction_id,
    factionName: row.faction_name,
    slug: row.slug,
  };
}

export interface VoteSummary {
  voteId: number;
  title: string;
  date: string;
  totalFor: number;
  totalAgainst: number;
  totalAbstain: number;
  isPassed: boolean;
}

/**
 * Find K25 votes whose title contains any of the given keywords.
 * Returns [] if the database isn't seeded yet.
 */
export function searchVotesByKeywords(keywords: string[]): VoteSummary[] {
  const db = getDb();
  if (!db || keywords.length === 0) return [];

  const conditions = keywords.map(() => 'title LIKE ?').join(' OR ');
  const params = keywords.map(kw => `%${kw}%`);

  const rows = db
    .prepare(
      `SELECT id, title, date, total_for, total_against, total_abstain, is_passed FROM plenary_vote
       WHERE (${conditions})
       ORDER BY date DESC
       LIMIT 200`,
    )
    .all(...params) as Array<{ id: number; title: string; date: string; total_for: number; total_against: number; total_abstain: number; is_passed: number }>;

  return rows.map(r => ({
    voteId: r.id,
    title: r.title,
    date: r.date,
    totalFor: r.total_for,
    totalAgainst: r.total_against,
    totalAbstain: r.total_abstain,
    isPassed: r.is_passed === 1,
  }));
}

/**
 * Get one MK's vote result on each of the given vote IDs.
 * Returns a map of voteId → Hebrew result label ('בעד', 'נגד', 'נמנע', 'נוכח').
 * Absent votes are not included in the map.
 */
export function getMkResultsForVotes(
  mkId: number,
  voteIds: number[],
): Record<number, string> {
  const db = getDb();
  if (!db || voteIds.length === 0) return {};

  const placeholders = voteIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT vote_id, result_code FROM mk_vote_result
       WHERE mk_id = ? AND vote_id IN (${placeholders})`,
    )
    .all(mkId, ...voteIds) as Array<{ vote_id: number; result_code: number }>;

  return Object.fromEntries(
    rows.map(r => [r.vote_id, CODE_TO_LABEL[r.result_code] ?? 'נוכח']),
  );
}

/**
 * Get all MK results for a single vote.
 * Returns [] if the database isn't seeded yet.
 */
export function getVoteResults(
  voteId: number,
): Array<{ mkId: number; resultCode: number; slug: string | null; firstName: string; lastName: string; factionName: string | null; isCoalition: number | null }> {
  const db = getDb();
  if (!db) return [];

  return db
    .prepare(
      `SELECT r.mk_id AS mkId, r.result_code AS resultCode, p.slug,
              p.first_name AS firstName, p.last_name AS lastName,
              p.faction_name AS factionName,
              COALESCE(
                (SELECT fch.is_coalition
                 FROM faction_coalition_history fch
                 WHERE fch.faction_id = p.faction_id
                   AND fch.from_date <= date(pv.date)
                   AND (fch.to_date IS NULL OR fch.to_date > date(pv.date))
                 ORDER BY fch.from_date DESC
                 LIMIT 1),
                p.is_coalition
              ) AS isCoalition
       FROM mk_vote_result r
       LEFT JOIN mk_person p ON p.person_id = r.mk_id
       JOIN plenary_vote pv ON pv.id = r.vote_id
       WHERE r.vote_id = ?`,
    )
    .all(voteId) as Array<{ mkId: number; resultCode: number; slug: string | null; firstName: string; lastName: string; factionName: string | null; isCoalition: number | null }>;
}

export interface BillSummary {
  billId: number;
  title: string;
  subtype: string;
  isPassed: boolean;
  committeeId: number | null;
  committeeName: string | null;
  summary: string | null;
  docUrl: string | null;
  microAgenda: string | null;
  macroAgenda: string | null;
  initDate: string | null;
}

export interface BillTopic {
  committeeName: string;
  total: number;
  passed: number;
}

/**
 * Get all K25 bills proposed by a given MK.
 */
export function getMkBills(mkId: number): BillSummary[] {
  const db = getDb();
  if (!db) return [];

  return (
    db
      .prepare(
        `SELECT b.id, b.title, b.subtype, b.is_passed, b.committee_id, b.committee_name, b.summary, b.doc_url, b.micro_agenda, b.macro_agenda, b.init_date
         FROM bill b
         JOIN bill_initiator i ON i.bill_id = b.id
         WHERE i.mk_id = ?
         ORDER BY b.is_passed DESC, b.id DESC`,
      )
      .all(mkId) as Array<{ id: number; title: string; subtype: string; is_passed: number; committee_id: number | null; committee_name: string | null; summary: string | null; doc_url: string | null; micro_agenda: string | null; macro_agenda: string | null; init_date: string | null }>
  ).map(r => ({
    billId: r.id,
    title: r.title,
    subtype: r.subtype,
    isPassed: r.is_passed === 1,
    committeeId: r.committee_id,
    committeeName: r.committee_name,
    summary: r.summary,
    docUrl: r.doc_url,
    microAgenda: r.micro_agenda,
    macroAgenda: r.macro_agenda,
    initDate: r.init_date ?? null,
  }));
}

export interface QuerySummary {
  queryId: number;
  title: string;
  submitDate: string;
}

/**
 * Get all K25 parliamentary queries submitted by a given MK.
 */
export function getMkQueries(mkId: number): QuerySummary[] {
  const db = getDb();
  if (!db) return [];

  return (
    db
      .prepare(
        `SELECT id, title, submit_date FROM mk_query
         WHERE mk_id = ?
         ORDER BY submit_date DESC`,
      )
      .all(mkId) as Array<{ id: number; title: string; submit_date: string }>
  ).map(r => ({ queryId: r.id, title: r.title, submitDate: r.submit_date }));
}

export interface PositionSummary {
  id: number;
  dutyDesc: string | null;
  committeeId: number | null;
  committee: string | null;
  ministryId: number | null;
  ministry: string | null;
  startDate: string;
  finishDate: string | null;
  isCurrent: boolean;
}

/**
 * Get all K25 positions (committee memberships + ministerial roles) for a given MK.
 * Excludes bare "MK" entries (no committee, no ministry, no dutyDesc).
 */
export function getMkPositions(mkId: number): PositionSummary[] {
  const db = getDb();
  if (!db) return [];

  return (
    db
      .prepare(
        `SELECT id, duty_desc, committee_id, committee, ministry_id, ministry, start_date, finish_date, is_current
         FROM mk_position
         WHERE mk_id = ? AND (committee_id IS NOT NULL OR ministry_id IS NOT NULL OR duty_desc IS NOT NULL)
         ORDER BY is_current DESC, start_date DESC`,
      )
      .all(mkId) as Array<{
        id: number;
        duty_desc: string | null;
        committee_id: number | null;
        committee: string | null;
        ministry_id: number | null;
        ministry: string | null;
        start_date: string;
        finish_date: string | null;
        is_current: number;
      }>
  ).map(r => ({
    id: r.id,
    dutyDesc: r.duty_desc,
    committeeId: r.committee_id,
    committee: r.committee,
    ministryId: r.ministry_id,
    ministry: r.ministry,
    startDate: r.start_date,
    finishDate: r.finish_date,
    isCurrent: r.is_current === 1,
  }));
}

export interface MkVoteStats {
  total: number;
  forCount: number;
  againstCount: number;
  abstainCount: number;
  presentCount: number;
  absenceCount: number;   // plenary votes the MK didn't appear in at all
  majorityAlignment: number | null; // % of for/against votes that matched the outcome
}

/**
 * Get vote breakdown counts and majority-alignment stat for a given MK.
 */
export function getMkVoteStats(mkId: number): MkVoteStats | null {
  const db = getDb();
  if (!db) return null;

  const rows = db
    .prepare(
      `SELECT result_code, COUNT(*) as cnt
       FROM mk_vote_result WHERE mk_id = ?
       GROUP BY result_code`,
    )
    .all(mkId) as Array<{ result_code: number; cnt: number }>;

  const { totalVotes } = db
    .prepare('SELECT COUNT(*) as totalVotes FROM plenary_vote')
    .get() as { totalVotes: number };

  const stats: MkVoteStats = {
    total: 0, forCount: 0, againstCount: 0, abstainCount: 0, presentCount: 0,
    absenceCount: 0,
    majorityAlignment: null,
  };
  for (const row of rows) {
    stats.total += row.cnt;
    if (row.result_code === 7) stats.forCount = row.cnt;
    else if (row.result_code === 8) stats.againstCount = row.cnt;
    else if (row.result_code === 9) stats.abstainCount = row.cnt;
    else if (row.result_code === 6) stats.presentCount = row.cnt;
  }

  const aligned = db
    .prepare(
      `SELECT COUNT(*) as cnt
       FROM mk_vote_result mvr
       JOIN plenary_vote pv ON pv.id = mvr.vote_id
       WHERE mvr.mk_id = ?
         AND ((mvr.result_code = 7 AND pv.is_passed = 1)
           OR (mvr.result_code = 8 AND pv.is_passed = 0))`,
    )
    .get(mkId) as { cnt: number };

  const votingTotal = stats.forCount + stats.againstCount;
  stats.majorityAlignment = votingTotal > 0
    ? Math.round((aligned.cnt / votingTotal) * 100)
    : null;

  stats.absenceCount = Math.max(0, totalVotes - stats.total);

  return stats;
}

/**
 * Get votes where the MK voted with the majority outcome.
 * (בעד + passed, or נגד + failed)
 * For opposition MKs these are the anomalous "crossed the aisle" votes.
 * For coalition MKs these are routine — the interesting ones are the inverse.
 * Returns newest-first, capped at 200.
 */
export function getMkWithMajorityVotes(mkId: number): MkVoteRow[] {
  const db = getDb();
  if (!db) return [];

  return (
    db
      .prepare(
        `SELECT
           pv.id            AS voteId,
           pv.title,
           pv.date,
           pv.is_passed     AS isPassed,
           pv.total_for     AS totalFor,
           pv.total_against AS totalAgainst,
           pv.micro_agenda  AS microAgenda,
           pv.macro_agenda  AS macroAgenda,
           mvr.result_code  AS resultCode
         FROM mk_vote_result mvr
         JOIN plenary_vote pv ON pv.id = mvr.vote_id
         WHERE mvr.mk_id = ?
           AND ((mvr.result_code = 7 AND pv.is_passed = 1)
             OR (mvr.result_code = 8 AND pv.is_passed = 0))
         ORDER BY pv.date DESC
         LIMIT 200`,
      )
      .all(mkId) as Array<{
        voteId: number; title: string; date: string;
        isPassed: number; totalFor: number; totalAgainst: number;
        microAgenda: string | null; macroAgenda: string | null;
        resultCode: number;
      }>
  ).map(r => ({ ...r, isPassed: r.isPassed === 1 }));
}

export interface MkVoteRow {
  voteId: number;
  title: string;
  date: string;
  resultCode: number;
  isPassed: boolean;
  totalFor: number;
  totalAgainst: number;
  microAgenda: string | null;
  macroAgenda: string | null;
}

/**
 * Get all plenary votes cast by a given MK, with vote outcome context.
 * Returns votes ordered newest-first.
 */
export function getMkVotesFromDb(mkId: number): MkVoteRow[] {
  const db = getDb();
  if (!db) return [];

  return (
    db
      .prepare(
        `SELECT
           pv.id            AS voteId,
           pv.title,
           pv.date,
           pv.is_passed     AS isPassed,
           pv.total_for     AS totalFor,
           pv.total_against AS totalAgainst,
           pv.micro_agenda  AS microAgenda,
           pv.macro_agenda  AS macroAgenda,
           mvr.result_code  AS resultCode
         FROM mk_vote_result mvr
         JOIN plenary_vote pv ON pv.id = mvr.vote_id
         WHERE mvr.mk_id = ?
         ORDER BY pv.date DESC`,
      )
      .all(mkId) as Array<{
        voteId: number;
        title: string;
        date: string;
        isPassed: number;
        totalFor: number;
        totalAgainst: number;
        microAgenda: string | null;
        macroAgenda: string | null;
        resultCode: number;
      }>
  ).map(r => ({ ...r, isPassed: r.isPassed === 1 }));
}

/**
 * Aggregate a given MK's bills by committee (policy area).
 * Returns topics ordered by total bills DESC.
 */
export function getMkBillTopics(mkId: number): BillTopic[] {
  const db = getDb();
  if (!db) return [];

  return (
    db
      .prepare(
        `SELECT b.committee_name, COUNT(*) AS total, SUM(b.is_passed) AS passed
         FROM bill b
         JOIN bill_initiator i ON i.bill_id = b.id
         WHERE i.mk_id = ? AND b.committee_name IS NOT NULL
         GROUP BY b.committee_name
         ORDER BY total DESC`,
      )
      .all(mkId) as Array<{ committee_name: string; total: number; passed: number }>
  ).map(r => ({
    committeeName: r.committee_name,
    total: r.total,
    passed: r.passed,
  }));
}

export interface AgendaStat {
  macroAgenda: string;
  pushedCount: number;
  supportedCount: number;
}

/**
 * Get aggregated agenda stats for an MK.
 * Pushed: count of bills initiated by MK per macro agenda.
 * Supported: count of votes cast 'FOR' (7) by MK per macro agenda.
 */
export function getMkAgendaStats(mkId: number): AgendaStat[] {
  const db = getDb();
  if (!db) return [];

  const pushed = db.prepare(`
    SELECT b.macro_agenda, COUNT(*) as cnt
    FROM bill b
    JOIN bill_initiator i ON i.bill_id = b.id
    WHERE i.mk_id = ? AND b.macro_agenda IS NOT NULL
    GROUP BY b.macro_agenda
  `).all(mkId) as Array<{ macro_agenda: string; cnt: number }>;

  const supported = db.prepare(`
    SELECT pv.macro_agenda, COUNT(*) as cnt
    FROM mk_vote_result r
    JOIN plenary_vote pv ON pv.id = r.vote_id
    WHERE r.mk_id = ? AND r.result_code = 7 AND pv.macro_agenda IS NOT NULL
    GROUP BY pv.macro_agenda
  `).all(mkId) as Array<{ macro_agenda: string; cnt: number }>;

  const statsMap = new Map<string, { pushed: number; supported: number }>();

  for (const p of pushed) {
    statsMap.set(p.macro_agenda, { pushed: p.cnt, supported: 0 });
  }

  for (const s of supported) {
    const existing = statsMap.get(s.macro_agenda) || { pushed: 0, supported: 0 };
    statsMap.set(s.macro_agenda, { ...existing, supported: s.cnt });
  }

  return Array.from(statsMap.entries())
    .map(([macroAgenda, counts]) => ({
      macroAgenda,
      pushedCount: counts.pushed,
      supportedCount: counts.supported,
    }))
    .sort((a, b) => (b.pushedCount + b.supportedCount) - (a.pushedCount + a.supportedCount));
}
export interface NetworkNode {
  id: number;
  name: string;
  faction: string;
  isCoalition: number;
  billCount: number;
  passedCount: number;
}

export interface NetworkLink {
  source: number;
  target: number;
  value: number;
  isCrossAisle: boolean;
}

/**
 * Get the co-sponsorship network graph (nodes = current MKs, links = shared bills).
 * Only links with >3 shared bills are included for signal quality.
 */
export function getNetworkGraph(): { nodes: NetworkNode[]; links: NetworkLink[] } {
  const db = getDb();
  if (!db) return { nodes: [], links: [] };

  const mks = db.prepare(`
    SELECT
      person_id as id,
      first_name || ' ' || last_name as name,
      faction_name as faction,
      is_coalition as isCoalition,
      (SELECT COUNT(*) FROM bill_initiator WHERE mk_id = person_id) as billCount,
      (SELECT COUNT(DISTINCT bi.bill_id) FROM bill_initiator bi JOIN bill b ON b.id = bi.bill_id WHERE bi.mk_id = person_id AND b.is_passed = 1) as passedCount
    FROM mk_person
    WHERE is_current = 1
  `).all() as NetworkNode[];

  const rawLinks = db.prepare(`
    SELECT
      i1.mk_id as source,
      i2.mk_id as target,
      COUNT(*) as value
    FROM bill_initiator i1
    JOIN bill_initiator i2 ON i1.bill_id = i2.bill_id AND i1.mk_id < i2.mk_id
    JOIN mk_person p1 ON p1.person_id = i1.mk_id
    JOIN mk_person p2 ON p2.person_id = i2.mk_id
    WHERE p1.is_current = 1 AND p2.is_current = 1
    GROUP BY source, target
    HAVING value > 0
    ORDER BY value DESC
  `).all() as Array<{ source: number; target: number; value: number }>;

  const mkMap = new Map(mks.map(m => [m.id, m]));
  const links: NetworkLink[] = rawLinks.map(l => ({
    ...l,
    isCrossAisle: mkMap.get(l.source)?.isCoalition !== mkMap.get(l.target)?.isCoalition,
  }));

  return { nodes: mks, links };
}

export interface HeatmapDay {
  date: string;
  total: number;
  attended: number;
  rate: number;
}

/**
 * Get per-day plenary vote attendance for a given MK over the past year.
 */
export function getMkPresenceHeatmap(mkId: number): HeatmapDay[] {
  const db = getDb();
  if (!db) return [];

  const allVotes = db.prepare(`
    SELECT strftime('%Y-%m-%d', date) as day, COUNT(*) as totalVotes
    FROM plenary_vote
    WHERE date >= datetime('now', '-1 year')
    GROUP BY day
    ORDER BY day ASC
  `).all() as { day: string; totalVotes: number }[];

  const mkVotes = db.prepare(`
    SELECT strftime('%Y-%m-%d', pv.date) as day, COUNT(*) as attended
    FROM mk_vote_result r
    JOIN plenary_vote pv ON pv.id = r.vote_id
    WHERE r.mk_id = ? AND pv.date >= datetime('now', '-1 year')
    GROUP BY day
  `).all(mkId) as { day: string; attended: number }[];

  const attendanceMap = new Map(mkVotes.map(v => [v.day, v.attended]));

  return allVotes.map(v => ({
    date: v.day,
    total: v.totalVotes,
    attended: attendanceMap.get(v.day) ?? 0,
    rate: v.totalVotes > 0 ? (attendanceMap.get(v.day) ?? 0) / v.totalVotes : 0,
  }));
}

// ── Committee detail ────────────────────────────────────────────────────────

export interface CommitteeMember {
  id: number;
  name: string;
  slug: string | null;
  isCoalition: boolean | null;
  dutyDesc: string | null;
}

export interface CommitteeBill {
  billId: number;
  title: string;
  subtype: string;
  isPassed: boolean;
  statusDesc: string | null;
  summary: string | null;
  docUrl: string | null;
  microAgenda: string | null;
  macroAgenda: string | null;
  initDate: string | null;
  initiators: Array<{ id: number; name: string; slug: string | null }>;
}

export interface CommitteeDetail {
  name: string;
  committeeId: number | null;
  billCount: number;
  passedCount: number;
  sessionCount: number;
  members: CommitteeMember[];
  bills: CommitteeBill[];
}

export interface CommitteeSessionFull {
  id: number;
  date: string;
  statusDesc: string | null;       // "פעילה" | "מבוטלת"
  typeDesc: string | null;         // "פתוחה" | "חסויה"
  isJoint: boolean;
  sessionNumber: number | null;
  protocolNumber: number | null;
  protocolUrl: string | null;
  sessionUrl: string | null;
  noProtocolReason: string | null;
  startTime: string | null;
  endTime: string | null;
  firstAgendaTitle: string | null;
  firstBillTitle: string | null;   // fallback label when no agenda — first linked bill title
  voteCount: number;
  linkedBillCount: number;
  chunkCount: number;              // filled in by caller from Turso — always 0 here
}

export interface CommitteeSessionAgendaItem {
  itemNumber: number | null;
  title: string;
  itemType: string | null;
}

export interface CommitteeSessionVote {
  subject: string | null;
  result: string | null;
  forCount: number | null;
  againstCount: number | null;
  abstainCount: number | null;
  passed: number | null;
}

export interface CommitteeSessionLinkedBill {
  billId: number;
  title: string;
  subtype: string | null;
  isPassed: boolean;
}

export interface CommitteeSessionDocument {
  id: number;
  groupTypeDesc: string | null;
  documentName: string | null;
  filePath: string | null;
  applicationDesc: string | null;
}

export interface CommitteeSessionDetail {
  agendaItems: CommitteeSessionAgendaItem[];
  votes: CommitteeSessionVote[];
  linkedBills: CommitteeSessionLinkedBill[];
  documents: CommitteeSessionDocument[];
}

export function getCommitteeDetail(name: string): CommitteeDetail | null {
  const db = getDb();
  if (!db) return null;

  // First look up the committee in the committee table — prefer the one with sessions
  const committeeRow = db.prepare(`
    SELECT c.id FROM committee c
    LEFT JOIN (SELECT committee_id, COUNT(*) as cnt FROM committee_session GROUP BY committee_id) s ON s.committee_id = c.id
    WHERE c.name = ?
    ORDER BY COALESCE(s.cnt, 0) DESC, c.id DESC
    LIMIT 1
  `).get(name) as { id: number } | undefined;

  // Fall back to bill lookup for legacy compatibility
  const committeeIdFromBill = committeeRow ? null : (db.prepare(`
    SELECT DISTINCT committee_id FROM bill WHERE committee_name = ? AND committee_id != -1 LIMIT 1
  `).get(name) as { committee_id: number } | undefined)?.committee_id ?? null;

  const resolvedCommitteeId = committeeRow?.id ?? committeeIdFromBill;

  const sessionCount = resolvedCommitteeId
    ? (db.prepare(`SELECT COUNT(*) as cnt FROM committee_session WHERE committee_id = ?`).get(resolvedCommitteeId) as { cnt: number }).cnt
    : 0;

  const billStats = db.prepare(`
    SELECT COUNT(*) as total, SUM(is_passed) as passed
    FROM bill WHERE committee_name = ?
  `).get(name) as { total: number; passed: number } | undefined;

  // Return null only if we have no data at all
  if (!resolvedCommitteeId && (!billStats || billStats.total === 0)) return null;

  const memberQuery = db.prepare(`
    SELECT pos.duty_desc, mp.person_id as id, mp.first_name || ' ' || mp.last_name as name,
           mp.slug, mp.is_coalition as isCoalition
    FROM mk_position pos
    JOIN mk_person mp ON mp.person_id = pos.mk_id
    WHERE pos.is_current = 1 AND pos.committee_id = ? AND mp.is_current = 1
    GROUP BY mp.person_id
    ORDER BY mp.last_name
  `);
  const memberQueryByName = db.prepare(`
    SELECT pos.duty_desc, mp.person_id as id, mp.first_name || ' ' || mp.last_name as name,
           mp.slug, mp.is_coalition as isCoalition
    FROM mk_position pos
    JOIN mk_person mp ON mp.person_id = pos.mk_id
    WHERE pos.is_current = 1 AND pos.committee = ? AND mp.is_current = 1
    GROUP BY mp.person_id
    ORDER BY mp.last_name
  `);

  type MemberRow = { duty_desc: string | null; id: number; name: string; slug: string | null; isCoalition: number | null };
  // Try committee_id first, fall back to text name if empty (covers schema mismatches between DB versions)
  let memberRows: MemberRow[] = resolvedCommitteeId
    ? memberQuery.all(resolvedCommitteeId) as MemberRow[]
    : memberQueryByName.all(name) as MemberRow[];
  if (memberRows.length === 0 && resolvedCommitteeId) {
    memberRows = memberQueryByName.all(name) as MemberRow[];
  }

  const billRows = db.prepare(`
    SELECT b.id, b.title, b.subtype, b.is_passed, b.status_desc, b.summary, b.doc_url,
           b.micro_agenda, b.macro_agenda, b.init_date
    FROM bill b
    WHERE b.committee_name = ?
    ORDER BY b.is_passed DESC, b.id DESC
  `).all(name) as Array<{ id: number; title: string; subtype: string; is_passed: number; status_desc: string | null; summary: string | null; doc_url: string | null; micro_agenda: string | null; macro_agenda: string | null; init_date: string | null }>;

  // Fetch initiators for each bill
  const getInitiators = db.prepare(`
    SELECT mp.person_id as id, mp.first_name || ' ' || mp.last_name as name, mp.slug
    FROM bill_initiator bi
    JOIN mk_person mp ON mp.person_id = bi.mk_id
    WHERE bi.bill_id = ?
  `);

  const bills: CommitteeBill[] = billRows.map(r => ({
    billId: r.id,
    title: r.title,
    subtype: r.subtype,
    isPassed: r.is_passed === 1,
    statusDesc: r.status_desc ?? null,
    summary: r.summary,
    docUrl: r.doc_url,
    microAgenda: r.micro_agenda,
    macroAgenda: r.macro_agenda,
    initDate: r.init_date ?? null,
    initiators: getInitiators.all(r.id) as Array<{ id: number; name: string; slug: string | null }>,
  }));

  return {
    name,
    committeeId: resolvedCommitteeId,
    billCount: billStats?.total ?? 0,
    passedCount: billStats?.passed ?? 0,
    sessionCount,
    members: memberRows.map(r => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      isCoalition: r.isCoalition === null ? null : r.isCoalition === 1,
      dutyDesc: r.duty_desc,
    })),
    bills,
  };
}

/**
 * Returns all sessions for a committee with rich metadata from local SQLite.
 * chunkCount is left at 0 — caller merges it from Turso.
 */
export function getCommitteeSessionsFull(committeeName: string): CommitteeSessionFull[] {
  const db = getDb();
  if (!db) return [];

  type Row = {
    id: number; date: string; status_desc: string | null; type_desc: string | null;
    is_joint: number; session_number: number | null; protocol_number: number | null;
    protocol_url: string | null; session_url: string | null;
    no_protocol_reason: string | null; start_time: string | null; end_time: string | null;
    first_agenda: string | null; first_bill_title: string | null; vote_count: number; linked_bill_count: number;
  };

  // Queries by committee_name text field directly — no ID resolution.
  // Caller must supply the canonical name as stored in committee_session.committee_name.
  const rows = db.prepare(`
    SELECT
      cs.id, cs.date, cs.status_desc, cs.type_desc,
      cs.is_joint, cs.session_number, cs.protocol_number,
      cs.protocol_url, cs.session_url,
      cs.no_protocol_reason, cs.start_time, cs.end_time,
      (SELECT title FROM session_agenda_item WHERE session_id = cs.id LIMIT 1) AS first_agenda,
      (SELECT b.title FROM session_bill sb JOIN bill b ON b.id = sb.bill_id WHERE sb.session_id = cs.id LIMIT 1) AS first_bill_title,
      (SELECT COUNT(*) FROM session_vote WHERE session_id = cs.id) AS vote_count,
      (SELECT COUNT(*) FROM session_bill WHERE session_id = cs.id) AS linked_bill_count
    FROM committee_session cs
    WHERE cs.committee_name = ?
    ORDER BY cs.date DESC
  `).all(committeeName) as Row[];

  return rows.map(r => ({
    id: r.id,
    date: r.date,
    statusDesc: r.status_desc,
    typeDesc: r.type_desc,
    isJoint: r.is_joint === 1,
    sessionNumber: r.session_number,
    protocolNumber: r.protocol_number,
    protocolUrl: r.protocol_url,
    sessionUrl: r.session_url,
    noProtocolReason: r.no_protocol_reason,
    startTime: r.start_time,
    endTime: r.end_time,
    firstAgendaTitle: r.first_agenda,
    firstBillTitle: r.first_bill_title,
    voteCount: r.vote_count,
    linkedBillCount: r.linked_bill_count,
    chunkCount: 0,
  }));
}

/**
 * Returns full detail for a single committee session for lazy loading.
 */
export function getCommitteeSessionDetail(sessionId: number): CommitteeSessionDetail | null {
  const db = getDb();
  if (!db) return null;

  type AgendaRow = { item_number: number | null; title: string; item_type: string | null };
  type VoteRow = { subject: string | null; result: string | null; for_count: number | null; against_count: number | null; abstain_count: number | null; passed: number | null };
  type BillRow = { id: number; title: string; subtype: string | null; is_passed: number };
  type DocRow = { id: number; group_type_desc: string | null; document_name: string | null; file_path: string | null; application_desc: string | null };

  const agendaItems = (db.prepare(
    `SELECT item_number, title, item_type FROM session_agenda_item WHERE session_id = ? ORDER BY item_number`
  ).all(sessionId) as AgendaRow[]).map(r => ({
    itemNumber: r.item_number,
    title: r.title,
    itemType: r.item_type,
  }));

  const votes = (db.prepare(
    `SELECT subject, result, for_count, against_count, abstain_count, passed FROM session_vote WHERE session_id = ? ORDER BY rowid`
  ).all(sessionId) as VoteRow[]).map(r => ({
    subject: r.subject,
    result: r.result,
    forCount: r.for_count,
    againstCount: r.against_count,
    abstainCount: r.abstain_count,
    passed: r.passed,
  }));

  const linkedBills = (db.prepare(
    `SELECT b.id, b.title, b.subtype, b.is_passed
     FROM session_bill sb JOIN bill b ON b.id = sb.bill_id
     WHERE sb.session_id = ?
     ORDER BY b.is_passed DESC, b.id DESC`
  ).all(sessionId) as BillRow[]).map(r => ({
    billId: r.id,
    title: r.title,
    subtype: r.subtype,
    isPassed: r.is_passed === 1,
  }));

  const documents = (db.prepare(
    `SELECT id, group_type_desc, document_name, file_path, application_desc
     FROM session_document
     WHERE session_id = ? AND file_path IS NOT NULL AND file_path != ''
     ORDER BY group_type_id`
  ).all(sessionId) as DocRow[]).map(r => ({
    id: r.id,
    groupTypeDesc: r.group_type_desc,
    documentName: r.document_name,
    filePath: r.file_path,
    applicationDesc: r.application_desc,
  }));

  return { agendaItems, votes, linkedBills, documents };
}

// ── Ministers ────────────────────────────────────────────────────────────────

export interface MinisterInfo {
  id: number;
  name: string;
  slug: string | null;
  isCoalition: boolean | null;
  factionName: string | null;
  ministerRole: string;
  ministry: string | null;
  billCount: number;
  passedCount: number;
  committeeSessionCount: number;
}

export function getMinisters(): MinisterInfo[] {
  const db = getDb();
  if (!db) return [];

  return (db.prepare(`
    SELECT
      mp.person_id as id,
      mp.first_name || ' ' || mp.last_name as name,
      mp.slug,
      mp.is_coalition as isCoalition,
      mp.faction_name as factionName,
      -- Pick primary role by priority: PM > minister (שר/שרת) > minister (השר/השרה) > deputy PM > deputy minister > additional minister
      MIN(CASE
        WHEN pos.duty_desc LIKE 'ראש הממשלה%'    THEN '1:' || pos.duty_desc
        WHEN pos.duty_desc LIKE 'שר %'            THEN '2:' || pos.duty_desc
        WHEN pos.duty_desc LIKE 'שרת %'           THEN '2:' || pos.duty_desc
        WHEN pos.duty_desc LIKE 'השר %'           THEN '3:' || pos.duty_desc
        WHEN pos.duty_desc LIKE 'השרה %'          THEN '3:' || pos.duty_desc
        WHEN pos.duty_desc LIKE 'סגן ראש הממשלה%' THEN '4:' || pos.duty_desc
        WHEN pos.duty_desc LIKE 'סגן שר%'         THEN '5:' || pos.duty_desc
        WHEN pos.duty_desc LIKE 'סגנית שר%'       THEN '5:' || pos.duty_desc
        ELSE '6:' || pos.duty_desc
      END) as roleKey,
      pos.ministry,
      (SELECT COUNT(*) FROM bill_initiator WHERE mk_id = mp.person_id) as billCount,
      (SELECT COUNT(DISTINCT bi.bill_id) FROM bill_initiator bi JOIN bill b ON b.id = bi.bill_id WHERE bi.mk_id = mp.person_id AND b.is_passed = 1) as passedCount,
      (SELECT COUNT(*) FROM committee_attendance ca WHERE ca.mk_id = mp.person_id) as committeeSessionCount
    FROM mk_position pos
    JOIN mk_person mp ON mp.person_id = pos.mk_id
    WHERE pos.is_current = 1
      AND pos.ministry IS NOT NULL
      AND (pos.duty_desc LIKE 'שר %' OR pos.duty_desc LIKE 'שרת %'
        OR pos.duty_desc LIKE 'השר %' OR pos.duty_desc LIKE 'השרה %'
        OR pos.duty_desc LIKE 'ראש הממשלה%'
        OR pos.duty_desc LIKE 'סגן שר%' OR pos.duty_desc LIKE 'סגנית שר%')
    GROUP BY mp.person_id
    ORDER BY roleKey, mp.last_name
  `).all() as Array<{ id: number; name: string; slug: string | null; isCoalition: number | null; factionName: string | null; roleKey: string; ministry: string | null; billCount: number; passedCount: number; committeeSessionCount: number }>)
  .map(r => ({
    ...r,
    ministerRole: r.roleKey.replace(/^\d:/, ''),
    isCoalition: r.isCoalition === null ? null : r.isCoalition === 1,
  }));
}

/**
 * Get a vote's title, date, outcome and agenda by ID.
 */
export function getVoteMeta(
  voteId: number,
): { title: string; date: string; totalFor: number; totalAgainst: number; totalAbstain: number; isPassed: boolean; microAgenda: string | null; macroAgenda: string | null } | null {
  const db = getDb();
  if (!db) return null;

  const row = db
    .prepare(`SELECT title, date, total_for, total_against, total_abstain, is_passed, micro_agenda, macro_agenda FROM plenary_vote WHERE id = ?`)
    .get(voteId) as { title: string; date: string; total_for: number; total_against: number; total_abstain: number; is_passed: number; micro_agenda: string | null; macro_agenda: string | null } | undefined;

  if (!row) return null;
  return {
    title: row.title,
    date: row.date,
    totalFor: row.total_for,
    totalAgainst: row.total_against,
    totalAbstain: row.total_abstain,
    isPassed: row.is_passed === 1,
    microAgenda: row.micro_agenda,
    macroAgenda: row.macro_agenda,
  };
}

// ── Coalition/opposition vote breakdown ───────────────────────────────────────

export interface VoteCoalitionBreakdown {
  coalition: { for: number; against: number; abstain: number };
  opposition: { for: number; against: number; abstain: number };
}

export function getVoteCoalitionBreakdown(voteId: number): VoteCoalitionBreakdown | null {
  const db = getDb();
  if (!db) return null;

  // Use faction_coalition_history for historical accuracy (e.g. parties that
  // joined/left the coalition mid-term). Falls back to mk_person.is_coalition
  // for factions not recorded in the history table.
  const rows = db.prepare(`
    SELECT
      COALESCE(
        (SELECT fch.is_coalition
         FROM faction_coalition_history fch
         WHERE fch.faction_id = mp.faction_id
           AND fch.from_date <= date(pv.date)
           AND (fch.to_date IS NULL OR fch.to_date > date(pv.date))
         ORDER BY fch.from_date DESC
         LIMIT 1),
        mp.is_coalition
      ) AS is_coalition,
      mvr.result_code,
      COUNT(*) as cnt
    FROM mk_vote_result mvr
    JOIN mk_person mp ON mp.person_id = mvr.mk_id
    JOIN plenary_vote pv ON pv.id = mvr.vote_id
    WHERE mvr.vote_id = ? AND mp.is_coalition IS NOT NULL AND mvr.result_code IN (7, 8, 6)
    GROUP BY is_coalition, mvr.result_code
  `).all(voteId) as Array<{ is_coalition: number; result_code: number; cnt: number }>;

  const result: VoteCoalitionBreakdown = {
    coalition: { for: 0, against: 0, abstain: 0 },
    opposition: { for: 0, against: 0, abstain: 0 },
  };

  for (const r of rows) {
    const side = r.is_coalition === 1 ? 'coalition' : 'opposition';
    if (r.result_code === 7) result[side].for += r.cnt;
    else if (r.result_code === 8) result[side].against += r.cnt;
    else if (r.result_code === 6) result[side].abstain += r.cnt;
  }

  // Return null if no meaningful data
  if (
    result.coalition.for + result.coalition.against +
    result.opposition.for + result.opposition.against === 0
  ) return null;

  return result;
}

// ── Bills browser ─────────────────────────────────────────────────────────────

export interface BillRow {
  id: number;
  title: string;
  subtype: string;
  is_passed: number;
  status_desc: string | null;
  committee_name: string | null;
  summary: string | null;
  doc_url: string | null;
  micro_agenda: string | null;
  macro_agenda: string | null;
  publication_date: string | null;
  init_date: string | null;
  initiators: Array<{ person_id: number; first_name: string; last_name: string; slug: string | null }>;
}

export interface GetBillsOptions {
  limit?: number;
  offset?: number;
  passedOnly?: boolean;
  q?: string;
  committee?: string;
  from?: string;   // YYYY-MM-DD inclusive
  to?: string;     // YYYY-MM-DD inclusive
  /** @deprecated use from/to instead */
  year?: string;
}

export function getBills(opts: GetBillsOptions): { bills: BillRow[]; total: number } {
  const db = getDb();
  if (!db) return { bills: [], total: 0 };

  const { limit = 50, offset = 0, passedOnly, q, committee, from, to, year } = opts;

  let where = 'WHERE 1=1';
  const params: (string | number)[] = [];

  if (passedOnly) { where += ' AND b.is_passed = 1'; }
  if (q) {
    where += ' AND (b.title LIKE ? OR b.summary LIKE ? OR b.micro_agenda LIKE ?)';
    const term = `%${q}%`;
    params.push(term, term, term);
  }
  if (committee) { where += ' AND b.committee_name = ?'; params.push(committee); }
  // from/to take precedence over legacy year param
  if (from) { where += ' AND b.publication_date >= ?'; params.push(from); }
  if (to)   { where += ' AND b.publication_date <= ?'; params.push(to); }
  if (!from && !to && year) {
    where += ' AND b.publication_date >= ? AND b.publication_date <= ?';
    params.push(`${year}-01-01`, `${year}-12-31`);
  }

  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM bill b ${where}`).get(...params) as { cnt: number }).cnt;

  const bills = db.prepare(`
    SELECT b.id, b.title, b.subtype, b.is_passed, b.status_desc,
           b.committee_name, b.summary, b.doc_url, b.micro_agenda, b.macro_agenda,
           b.publication_date, b.init_date
    FROM bill b ${where}
    ORDER BY b.id DESC LIMIT ? OFFSET ?
  `).all(...params, Math.min(limit, 200), offset) as BillRow[];

  const getInitiators = db.prepare(`
    SELECT p.person_id, p.first_name, p.last_name, p.slug
    FROM bill_initiator i
    JOIN mk_person p ON p.person_id = i.mk_id
    WHERE i.bill_id = ?
  `);

  for (const bill of bills) {
    (bill as BillRow).initiators = getInitiators.all(bill.id) as BillRow['initiators'];
  }

  return { bills, total };
}

export function getBillById(id: number): BillRow | null {
  const db = getDb();
  if (!db) return null;

  const bill = db.prepare(`
    SELECT b.id, b.title, b.subtype, b.is_passed, b.status_desc,
           b.committee_name, b.summary, b.doc_url, b.micro_agenda, b.macro_agenda,
           b.publication_date, b.init_date
    FROM bill b WHERE b.id = ?
  `).get(id) as BillRow | undefined;

  if (!bill) return null;

  bill.initiators = db.prepare(`
    SELECT p.person_id, p.first_name, p.last_name, p.slug
    FROM bill_initiator i
    JOIN mk_person p ON p.person_id = i.mk_id
    WHERE i.bill_id = ?
  `).all(id) as BillRow['initiators'];

  return bill;
}

// ── Committee Sessions & Session Detail ────────────────────────────────────────

export interface SessionSummary {
  id: number;
  date: string;
  title: string | null;
  protocolNumber: number | null;
  startTime: string | null;
  endTime: string | null;
  attendeeCount: number;
  agendaCount: number;
  voteCount: number;
}

export function getCommitteeSessions(committeeId: number, limit = 100): SessionSummary[] {
  const db = getDb();
  if (!db) return [];

  return (db.prepare(`
    SELECT
      cs.id, cs.date, cs.title, cs.protocol_number, cs.start_time, cs.end_time,
      (SELECT COUNT(*) FROM committee_attendance WHERE session_id = cs.id) +
       (SELECT COUNT(*)/2 FROM session_guest WHERE session_id = cs.id AND (role IS NULL OR role != 'unresolved_mk')) as attendee_count,
      (SELECT COUNT(*) FROM session_agenda_item WHERE session_id = cs.id) as agenda_count,
      (SELECT COUNT(*) FROM session_vote WHERE session_id = cs.id) as vote_count
    FROM committee_session cs
    WHERE cs.committee_id = ?
    ORDER BY cs.date DESC
    LIMIT ?
  `).all(committeeId, limit) as Array<{
    id: number; date: string; title: string | null; protocol_number: number | null;
    start_time: string | null; end_time: string | null;
    attendee_count: number; agenda_count: number; vote_count: number;
  }>).map(r => ({
    id: r.id,
    date: r.date,
    title: r.title,
    protocolNumber: r.protocol_number,
    startTime: r.start_time,
    endTime: r.end_time,
    attendeeCount: r.attendee_count,
    agendaCount: r.agenda_count,
    voteCount: r.vote_count,
  }));
}

export interface AttendingMember {
  mkId: number;
  name: string;
  slug: string | null;
  factionName: string | null;
  isCoalition: boolean | null;
  role: string;
}

export interface SessionGuest {
  name: string;
  role: string | null;
  organization: string | null;
  method: string | null;
}

export interface SessionAgendaItem {
  itemNumber: number;
  title: string;
}

export interface SessionVote {
  voteNumber: number;
  subject: string | null;
  result: string | null;
  forCount: number;
  againstCount: number;
  abstainCount: number;
  passed: boolean | null; // null = outcome unknown
}

export interface SessionBillLink {
  billId: number;
  title: string | null;
}

export interface SessionDetail {
  id: number;
  committeeId: number;
  committeeName: string | null;
  date: string;
  title: string | null;
  protocolNumber: number | null;
  startTime: string | null;
  endTime: string | null;
  members: AttendingMember[];
  guests: SessionGuest[];
  staff: Array<{ role: string; name: string }>;
  agenda: SessionAgendaItem[];
  votes: SessionVote[];
  bills: SessionBillLink[];
  documents: Array<{
    id: number;
    name: string;
    url: string;
    type: 'protocol' | 'background' | 'other';
    appDesc: string | null;
  }>;
}

export function getSessionDetail(sessionId: number): SessionDetail | null {
  const db = getDb();
  if (!db) return null;

  const session = db.prepare(`
    SELECT cs.id, cs.committee_id, c.name as committee_name,
           cs.date, cs.title, cs.protocol_number, cs.start_time, cs.end_time
    FROM committee_session cs
    LEFT JOIN committee c ON c.id = cs.committee_id
    WHERE cs.id = ?
  `).get(sessionId) as {
    id: number; committee_id: number; committee_name: string | null;
    date: string; title: string | null; protocol_number: number | null;
    start_time: string | null; end_time: string | null;
  } | undefined;

  if (!session) return null;

  const members = (db.prepare(`
    SELECT ca.mk_id, mp.first_name || ' ' || mp.last_name as name, mp.slug,
           mp.faction_name, mp.is_coalition, ca.role
    FROM committee_attendance ca
    JOIN mk_person mp ON mp.person_id = ca.mk_id
    WHERE ca.session_id = ?
    ORDER BY ca.role, mp.last_name
  `).all(sessionId) as Array<{
    mk_id: number; name: string; slug: string | null;
    faction_name: string | null; is_coalition: number | null; role: string;
  }>).map(r => ({
    mkId: r.mk_id,
    name: r.name,
    slug: r.slug,
    factionName: r.faction_name,
    isCoalition: r.is_coalition === null ? null : r.is_coalition === 1,
    role: r.role,
  }));

  // The Knesset API stores guests as alternating rows: name row, then title/description row.
  // The description is stored in the `name` column of the next row (role/organization are NULL).
  // ORDER BY id preserves insertion order so we can pair consecutive rows correctly.
  const rawGuestRows = db.prepare(`
    SELECT name, role, organization, attendance_method
    FROM session_guest
    WHERE session_id = ? AND (role IS NULL OR role != 'unresolved_mk')
    ORDER BY rowid
  `).all(sessionId) as Array<{
    name: string; role: string | null; organization: string | null; attendance_method: string | null;
  }>;

  const guests: Array<{ name: string; role: string | null; organization: string | null; method: string | null }> = [];
  for (let i = 0; i < rawGuestRows.length; i++) {
    const row = rawGuestRows[i];
    // A "description row" has no role/org AND its name looks like a title (contains comma or
    // starts with known title prefixes). Attach it to the previous person.
    const looksLikeTitle = !row.role && !row.organization &&
      (row.name.includes(',') || /^(עו"ד|עו״ד|ד"ר|ד״ר|פרופ|רס"ן|מנכ"ל|מנכ״ל|סמנכ"ל|סמנכ״ל|מזכ"ל|מזכ״ל|יו"ר|יו״ר|מ"מ|רכז|שותף|שותפה|חבר |חברת |יועמ"ש|יועמ״ש|מנהל|מנהלת|ראש |נשיא|סגן |נציג|רפרט|כלכלן|כלכלנית|חוקר|חוקרת|שדלן|שדלנית|דובר |דוברת|עורך|עורכת|Privacy|Cyber)/.test(row.name));
    if (looksLikeTitle && guests.length > 0 && guests[guests.length - 1].role === null) {
      guests[guests.length - 1].role = row.name;
    } else {
      guests.push({ name: row.name, role: row.role ?? null, organization: row.organization ?? null, method: row.attendance_method ?? null });
    }
  }

  const agenda = (db.prepare(`
    SELECT item_number, title FROM session_agenda_item WHERE session_id = ? ORDER BY item_number
  `).all(sessionId) as Array<{ item_number: number; title: string }>).map(r => ({
    itemNumber: r.item_number,
    title: r.title,
  }));

  const votes = (db.prepare(`
    SELECT vote_number, subject, result, for_count, against_count, abstain_count, passed
    FROM session_vote WHERE session_id = ? ORDER BY vote_number
  `).all(sessionId) as Array<{
    vote_number: number; subject: string | null; result: string | null;
    for_count: number; against_count: number; abstain_count: number; passed: number;
  }>).map(r => ({
    voteNumber: r.vote_number,
    subject: r.subject,
    result: r.result,
    forCount: r.for_count,
    againstCount: r.against_count,
    abstainCount: r.abstain_count,
    passed: r.passed === null ? null : r.passed === 1,
  }));

  const bills = (db.prepare(`
    SELECT sb.bill_id, b.title
    FROM session_bill sb
    LEFT JOIN bill b ON b.id = sb.bill_id
    WHERE sb.session_id = ?
  `).all(sessionId) as Array<{ bill_id: number; title: string | null }>).map(r => ({
    billId: r.bill_id,
    title: r.title,
  }));

  const staff = (db.prepare(`
    SELECT role, name_text FROM session_staff WHERE session_id = ? ORDER BY id
  `).all(sessionId) as Array<{ role: string; name_text: string }>).map(r => ({
    role: r.role,
    name: r.name_text,
  }));

  const documents = (db.prepare(`
    SELECT id, document_name, file_path, group_type_id, application_desc
    FROM session_document
    WHERE session_id = ? AND file_path IS NOT NULL AND file_path != ''
    ORDER BY group_type_id
  `).all(sessionId) as Array<{
    id: number; document_name: string; file_path: string;
    group_type_id: number | null; application_desc: string | null;
  }>).map(d => ({
    id: d.id,
    name: d.document_name,
    url: d.file_path,
    type: (d.group_type_id === 23 ? 'protocol' : d.group_type_id === 87 ? 'background' : 'other') as 'protocol' | 'background' | 'other',
    appDesc: d.application_desc,
  }));

  return {
    id: session.id,
    committeeId: session.committee_id,
    committeeName: session.committee_name,
    date: session.date,
    title: session.title,
    protocolNumber: session.protocol_number,
    startTime: session.start_time,
    endTime: session.end_time,
    members,
    guests,
    staff,
    agenda,
    votes,
    bills,
    documents,
  };
}

export interface SpeakerTurn {
  turnNumber: number;
  mkId: number | null;
  rawName: string | null;
  factionName: string | null;
  slug: string | null;
  speakerRole: string | null;
  text: string;
}

export function getSessionSpeakerTurns(sessionId: number, mkId?: number): SpeakerTurn[] {
  const db = getDb();
  if (!db) return [];

  const sql = mkId
    ? `SELECT st.turn_number, st.mk_id, st.raw_name, st.faction_name, mp.slug, st.speaker_role, st.text
       FROM session_speaker_turn st
       LEFT JOIN mk_person mp ON mp.person_id = st.mk_id
       WHERE st.session_id = ? AND st.mk_id = ?
       ORDER BY st.turn_number`
    : `SELECT st.turn_number, st.mk_id, st.raw_name, st.faction_name, mp.slug, st.speaker_role, st.text
       FROM session_speaker_turn st
       LEFT JOIN mk_person mp ON mp.person_id = st.mk_id
       WHERE st.session_id = ?
       ORDER BY st.turn_number`;

  const params = mkId ? [sessionId, mkId] : [sessionId];

  return (db.prepare(sql).all(...params) as Array<{
    turn_number: number; mk_id: number | null; raw_name: string | null;
    faction_name: string | null; slug: string | null; speaker_role: string | null; text: string;
  }>).map(r => ({
    turnNumber: r.turn_number,
    mkId: r.mk_id,
    rawName: r.raw_name,
    factionName: r.faction_name,
    slug: r.slug,
    speakerRole: r.speaker_role,
    text: r.text,
  }));
}

export interface CommitteeActivity {
  committeeId: number;
  name: string;
  sessionCount: number;
  lastSessionDate: string | null;
  lastProtocolDate: string | null;
}

export interface SearchHit {
  type: 'mk' | 'committee' | 'bill' | 'session';
  id: string;
  title: string;
  subtitle: string | null;
  url: string;
}

export function searchAll(q: string): SearchHit[] {
  const db = getDb();
  if (!db) return [];
  const term = `%${q}%`;
  const results: SearchHit[] = [];

  const mks = db.prepare(`
    SELECT person_id as id, first_name || ' ' || last_name as name, faction_name, slug
    FROM mk_person WHERE (first_name || ' ' || last_name) LIKE ? LIMIT 20
  `).all(term) as Array<{ id: number; name: string; faction_name: string | null; slug: string | null }>;
  for (const m of mks) {
    results.push({ type: 'mk', id: String(m.id), title: m.name, subtitle: m.faction_name ?? null, url: `/mk/${m.slug ?? m.id}` });
  }

  const committees = db.prepare(`
    SELECT DISTINCT committee_name as name FROM bill WHERE committee_name IS NOT NULL AND committee_name LIKE ? ORDER BY committee_name LIMIT 20
  `).all(term) as Array<{ name: string }>;
  for (const c of committees) {
    results.push({ type: 'committee', id: c.name, title: c.name, subtitle: 'ועדה', url: `/committee/${encodeURIComponent(c.name)}` });
  }

  const bills = db.prepare(`
    SELECT id, title, status_desc, is_passed FROM bill WHERE title LIKE ?
    ORDER BY is_passed DESC, id DESC LIMIT 20
  `).all(term) as Array<{ id: number; title: string; status_desc: string | null; is_passed: number }>;
  for (const b of bills) {
    results.push({ type: 'bill', id: String(b.id), title: b.title, subtitle: b.status_desc ?? (b.is_passed ? 'עבר' : 'בטיפול'), url: `/bill/${b.id}` });
  }

  return results;
}

// ── Faction detail ─────────────────────────────────────────────────────────────

export interface FactionMk {
  personId: number;
  firstName: string;
  lastName: string;
  slug: string | null;
  isCurrent: boolean;
}

export interface FactionDetail {
  name: string;
  isCoalition: boolean | null;
  mks: FactionMk[];
  billCount: number;
  passedCount: number;
  rebellionRate: number | null;
}

export function getFactionDetail(name: string): FactionDetail | null {
  const db = getDb();
  if (!db) return null;

  // DB stores faction names with trailing spaces (e.g. "הליכוד ") — normalise
  const trimmed = name.trim();

  const mks = (db.prepare(`
    SELECT person_id, first_name, last_name, slug, is_current, is_coalition
    FROM mk_person WHERE TRIM(faction_name) = ?
    ORDER BY is_current DESC, last_name ASC
  `).all(trimmed) as Array<{
    person_id: number; first_name: string; last_name: string;
    slug: string | null; is_current: number; is_coalition: number | null;
  }>);

  if (mks.length === 0) return null;

  const isCoalition = mks[0].is_coalition === null ? null : mks[0].is_coalition === 1;

  const bills = db.prepare(`
    SELECT COUNT(b.id) as billCount, SUM(b.is_passed) as passedCount
    FROM bill b
    JOIN bill_initiator i ON i.bill_id = b.id
    JOIN mk_person p ON p.person_id = i.mk_id
    WHERE TRIM(p.faction_name) = ?
  `).get(trimmed) as { billCount: number; passedCount: number } | undefined;

  const rebelStats = db.prepare(`
    SELECT SUM(rebel_count) as totalRebels, COUNT(*) as totalVotes
    FROM vote_faction_stats
    WHERE faction_id = (SELECT faction_id FROM mk_person WHERE TRIM(faction_name) = ? AND faction_id IS NOT NULL LIMIT 1)
  `).get(trimmed) as { totalRebels: number; totalVotes: number } | undefined;

  const rebellionRate =
    rebelStats && rebelStats.totalVotes > 0
      ? (rebelStats.totalRebels / rebelStats.totalVotes) * 100
      : null;

  return {
    name: trimmed,
    isCoalition,
    mks: mks.map(r => ({
      personId: r.person_id,
      firstName: r.first_name,
      lastName: r.last_name,
      slug: r.slug,
      isCurrent: r.is_current === 1,
    })),
    billCount: bills?.billCount ?? 0,
    passedCount: bills?.passedCount ?? 0,
    rebellionRate,
  };
}

// ── Ministry detail ─────────────────────────────────────────────────────────────

export interface MinistryMinister {
  personId: number;
  name: string;
  slug: string | null;
  role: string;
  factionName: string | null;
  isCurrent: boolean;
}

export interface MinistryDetail {
  name: string;
  ministers: MinistryMinister[];
  billCount: number;
  passedCount: number;
}

export function getMinistryDetail(name: string): MinistryDetail | null {
  const db = getDb();
  if (!db) return null;

  const ministers = (db.prepare(`
    SELECT pos.mk_id as person_id, mp.first_name || ' ' || mp.last_name as name,
           mp.slug, pos.duty_desc, mp.faction_name,
           CASE WHEN pos.finish_date IS NULL OR pos.is_current = 1 THEN 1 ELSE 0 END as is_current
    FROM mk_position pos
    JOIN mk_person mp ON mp.person_id = pos.mk_id
    WHERE pos.ministry = ?
    ORDER BY is_current DESC, pos.start_date DESC
  `).all(name) as Array<{
    person_id: number; name: string; slug: string | null;
    duty_desc: string | null; faction_name: string | null; is_current: number;
  }>);

  if (ministers.length === 0) return null;

  const bills = db.prepare(`
    SELECT COUNT(*) as billCount, SUM(is_passed) as passedCount
    FROM bill
    WHERE committee_name LIKE ? OR macro_agenda LIKE ?
  `).get(`%${name}%`, `%${name}%`) as { billCount: number; passedCount: number } | undefined;

  return {
    name,
    ministers: ministers.map(r => ({
      personId: r.person_id,
      name: r.name,
      slug: r.slug,
      role: r.duty_desc ?? name,
      factionName: r.faction_name,
      isCurrent: r.is_current === 1,
    })),
    billCount: bills?.billCount ?? 0,
    passedCount: bills?.passedCount ?? 0,
  };
}

// ── Votes listing ──────────────────────────────────────────────────────────────

export interface VoteListRow {
  voteId: number;
  title: string;
  date: string;
  totalFor: number;
  totalAgainst: number;
  totalAbstain: number;
  isPassed: boolean;
  margin: number;
  microAgenda: string | null;
  macroAgenda: string | null;
}

export interface GetVoteListOptions {
  passedOnly?: boolean;
  failedOnly?: boolean;
  maxMargin?: number;   // only votes decided by ≤ N votes
  search?: string;
  limit?: number;
  offset?: number;
  from?: string;        // YYYY-MM-DD inclusive
  to?: string;          // YYYY-MM-DD inclusive
}

export function getVoteList(opts: GetVoteListOptions = {}): { votes: VoteListRow[]; total: number } {
  const db = getDb();
  if (!db) return { votes: [], total: 0 };

  const { passedOnly, failedOnly, maxMargin, search, limit = 50, offset = 0, from, to } = opts;
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (passedOnly) { conditions.push('is_passed = 1'); }
  if (failedOnly) { conditions.push('is_passed = 0'); }
  if (maxMargin !== undefined) {
    conditions.push('ABS(total_for - total_against) <= ?');
    params.push(maxMargin);
  }
  if (search) {
    conditions.push('title LIKE ?');
    params.push(`%${search}%`);
  }
  if (from) { conditions.push('date >= ?'); params.push(from); }
  if (to) { conditions.push('date <= ?'); params.push(to + 'T23:59:59'); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM plenary_vote ${where}`).get(...params) as { cnt: number }).cnt;
  const rows = db.prepare(`
    SELECT id, title, date, total_for, total_against, total_abstain, is_passed, micro_agenda, macro_agenda
    FROM plenary_vote ${where}
    ORDER BY date DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Array<{
    id: number; title: string; date: string; total_for: number; total_against: number;
    total_abstain: number; is_passed: number; micro_agenda: string | null; macro_agenda: string | null;
  }>;

  return {
    votes: rows.map(r => ({
      voteId: r.id,
      title: r.title,
      date: r.date,
      totalFor: r.total_for,
      totalAgainst: r.total_against,
      totalAbstain: r.total_abstain,
      isPassed: r.is_passed === 1,
      margin: Math.abs(r.total_for - r.total_against),
      microAgenda: r.micro_agenda,
      macroAgenda: r.macro_agenda,
    })),
    total,
  };
}

// ── Session title search (for global search) ────────────────────────────────────

export function searchSessions(q: string, limit = 10): Array<{ id: number; title: string | null; committeeName: string | null; date: string }> {
  const db = getDb();
  if (!db) return [];
  try {
    // Try with committee JOIN first (newer schema); fall back to no-JOIN if committee table missing
    try {
      return (db.prepare(`
        SELECT cs.id, cs.title, c.name as committee_name, cs.date
        FROM committee_session cs
        LEFT JOIN committee c ON c.id = cs.committee_id
        WHERE cs.title LIKE ? AND cs.title IS NOT NULL
        ORDER BY cs.date DESC LIMIT ?
      `).all(`%${q}%`, limit) as Array<{ id: number; title: string | null; committee_name: string | null; date: string }>)
      .map(r => ({ id: r.id, title: r.title, committeeName: r.committee_name, date: r.date }));
    } catch {
      // Older schema: no committee table; use committee_name column directly if available
      return (db.prepare(`
        SELECT id, title, committee_name, date
        FROM committee_session
        WHERE title LIKE ? AND title IS NOT NULL
        ORDER BY date DESC LIMIT ?
      `).all(`%${q}%`, limit) as Array<{ id: number; title: string | null; committee_name: string | null; date: string }>)
      .map(r => ({ id: r.id, title: r.title, committeeName: r.committee_name, date: r.date }));
    }
  } catch {
    return [];
  }
}

// Find sessions where a speaker with a matching name appeared in the transcript
export function searchSessionsBySpeaker(
  q: string,
): Array<{ id: number; title: string | null; committeeName: string | null; date: string; speakerName: string }> {
  const db = getDb();
  if (!db) return [];
  try {
    return (db.prepare(`
      SELECT cs.id, cs.title, c.name as committee_name, cs.date, sst.raw_name as speaker_name
      FROM session_speaker_turn sst
      JOIN committee_session cs ON cs.id = sst.session_id
      LEFT JOIN committee c ON c.id = cs.committee_id
      WHERE sst.raw_name LIKE ?
      GROUP BY cs.id
      ORDER BY cs.date DESC
    `).all(`%${q}%`) as Array<{ id: number; title: string | null; committee_name: string | null; date: string; speaker_name: string }>)
    .map(r => ({ id: r.id, title: r.title, committeeName: r.committee_name, date: r.date, speakerName: r.speaker_name }));
  } catch {
    return [];
  }
}

export function getAllCommitteeActivity(): CommitteeActivity[] {
  const db = getDb();
  if (!db) return [];

  // Only show committees active in K25 (sessions from Nov 2022 onward).
  // Deduplicate by name in SQL using MAX to pick the most-active committee_id per name.
  return (db.prepare(`
    SELECT c.name,
           MAX(c.id) as committee_id,
           COUNT(cs.id) as session_count,
           MAX(cs.date) as last_session_date
    FROM committee c
    JOIN committee_session cs ON cs.committee_id = c.id
    WHERE cs.date >= '2022-11-15'
    GROUP BY c.name
    HAVING session_count > 0
    ORDER BY last_session_date DESC
  `).all() as Array<{
    committee_id: number; name: string; session_count: number; last_session_date: string | null;
  }>)
  .map(r => ({ committeeId: r.committee_id, name: r.name, sessionCount: r.session_count, lastSessionDate: r.last_session_date, lastProtocolDate: null }));
}

// ── AI Search helpers ────────────────────────────────────────────────────────

/**
 * Scans all MKs to find one whose name appears in the query text.
 * Three-pass strategy:
 *   1. Full name match ("first last") — most precise
 *   2. Last name only — word-boundary match, skips names < 3 chars
 *   3. Nickname lookup — checks MK_NICKNAMES map for informal aliases (ביבי, etc.)
 */
export function findMkInText(query: string): { mkId: number; fullName: string } | null {
  const db = getDb();
  if (!db) return null;
  try {
    const mks = db.prepare(
      `SELECT person_id, first_name, last_name FROM mk_person ORDER BY person_id`,
    ).all() as Array<{ person_id: number; first_name: string; last_name: string }>;

    // Pass 1: full name match
    for (const mk of mks) {
      const fullName = `${mk.first_name} ${mk.last_name}`;
      if (query.includes(fullName)) {
        return { mkId: mk.person_id, fullName };
      }
    }

    // Pass 2: last name only (word boundary, ≥3 chars)
    for (const mk of mks) {
      if (mk.last_name.length < 3) continue;
      // Escape any regex special chars in the last name
      const escaped = mk.last_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(^|\\s)${escaped}(\\s|$)`);
      if (pattern.test(query)) {
        return { mkId: mk.person_id, fullName: `${mk.first_name} ${mk.last_name}` };
      }
    }

    // Pass 3: nickname / alias lookup
    for (const [nickname, fullName] of Object.entries(MK_NICKNAMES)) {
      if (query.includes(nickname)) {
        const mk = mks.find(m => `${m.first_name} ${m.last_name}` === fullName);
        if (mk) return { mkId: mk.person_id, fullName };
      }
    }

    return null;
  } catch {
    return null;
  }
}

export interface VoteSearchResult {
  voteId: number;
  title: string;
  date: string;
  microAgenda: string | null;
  macroAgenda: string | null;
  isPassed: boolean;
  totalFor: number;
  totalAgainst: number;
  mkVoteResult: string | null; // 'בעד' | 'נגד' | 'נמנע' | null
}

/**
 * For a specific MK: returns their recent votes.
 * Without an MK: keyword search on title/micro_agenda/macro_agenda.
 * Accepts a single keyword or array of keywords (OR-matched).
 */
export function searchVotesByKeyword(keyword: string | string[], mkId?: number, limit = 10): VoteSearchResult[] {
  const db = getDb();
  if (!db) return [];
  try {
    const keywords = (Array.isArray(keyword) ? keyword : [keyword]).filter(k => k.length >= 2);
    if (keywords.length === 0) return [];
    const VOTE_LABEL: Record<number, string> = { 7: 'בעד', 8: 'נגד', 9: 'נמנע', 6: 'נוכח' };
    type Row = { id: number; title: string; date: string; micro_agenda: string | null; macro_agenda: string | null; is_passed: number; total_for: number; total_against: number; result_code?: number };
    const map = (r: Row): VoteSearchResult => ({
      voteId: r.id, title: r.title, date: r.date,
      microAgenda: r.micro_agenda, macroAgenda: r.macro_agenda,
      isPassed: r.is_passed === 1, totalFor: r.total_for, totalAgainst: r.total_against,
      mkVoteResult: r.result_code !== undefined ? (VOTE_LABEL[r.result_code] ?? null) : null,
    });
    const mkCond = keywords.map(() => '(pv.title LIKE ? OR pv.micro_agenda LIKE ? OR pv.macro_agenda LIKE ?)').join(' OR ');
    const plainCond = keywords.map(() => '(title LIKE ? OR micro_agenda LIKE ? OR macro_agenda LIKE ?)').join(' OR ');
    const kArgs = keywords.flatMap(k => [`%${k}%`, `%${k}%`, `%${k}%`]);

    // Compute per-keyword match counts so rarer keywords get higher weight.
    // A vote matching "סביר" (2 total matches) ranks above one matching only "ביטול" (100+ matches).
    const kWeights = keywords.map(k => {
      const cnt = (db.prepare('SELECT COUNT(*) as cnt FROM plenary_vote WHERE title LIKE ? OR micro_agenda LIKE ? OR macro_agenda LIKE ?').get(`%${k}%`, `%${k}%`, `%${k}%`) as { cnt: number }).cnt;
      return cnt > 0 ? 1 / cnt : 1;
    });

    const scoreRows = <T extends Record<string, unknown>>(rows: T[]): T[] =>
      rows
        .map(r => {
          const fields = [r['title'] as string, r['micro_agenda'] as string, r['macro_agenda'] as string];
          const score = keywords.reduce((s, k, i) => s + (fields.some(f => f?.includes(k)) ? kWeights[i] : 0), 0);
          return { ...r, _score: score };
        })
        .sort((a, b) => (b._score as number) - (a._score as number) || (String(b['date'] ?? '') > String(a['date'] ?? '') ? 1 : -1))
        .slice(0, limit) as T[];

    if (mkId !== undefined) {
      const filtered = scoreRows(db.prepare(`
        SELECT pv.id, pv.title, pv.date, pv.micro_agenda, pv.macro_agenda, pv.is_passed, pv.total_for, pv.total_against, mvr.result_code
        FROM plenary_vote pv
        JOIN mk_vote_result mvr ON mvr.vote_id = pv.id AND mvr.mk_id = ?
        WHERE ${mkCond}
        ORDER BY pv.date DESC LIMIT 100
      `).all(mkId, ...kArgs) as Row[]).map(map);
      if (filtered.length > 0) return filtered;
      return (db.prepare(`
        SELECT pv.id, pv.title, pv.date, pv.micro_agenda, pv.macro_agenda, pv.is_passed, pv.total_for, pv.total_against, mvr.result_code
        FROM plenary_vote pv
        JOIN mk_vote_result mvr ON mvr.vote_id = pv.id AND mvr.mk_id = ?
        ORDER BY pv.date DESC LIMIT ?
      `).all(mkId, limit) as Row[]).map(map);
    }
    return scoreRows(db.prepare(`
      SELECT id, title, date, micro_agenda, macro_agenda, is_passed, total_for, total_against
      FROM plenary_vote WHERE ${plainCond}
      ORDER BY date DESC LIMIT 100
    `).all(...kArgs) as Row[]).map(map);
  } catch {
    return [];
  }
}

export interface BillSearchResult {
  billId: number;
  title: string;
  committeeName: string | null;
  isPassed: boolean;
}

/**
 * For a specific MK: returns their recent bill proposals.
 * Without an MK: keyword search on bill title.
 * Accepts a single keyword or array of keywords (OR-matched).
 */
export function searchBillsByKeyword(keyword: string | string[], mkId?: number, limit = 8): BillSearchResult[] {
  const db = getDb();
  if (!db) return [];
  try {
    const keywords = (Array.isArray(keyword) ? keyword : [keyword]).filter(k => k.length >= 2);
    if (keywords.length === 0) return [];
    type Row = { id: number; title: string; committee_name: string | null; is_passed: number };
    const map = (r: Row): BillSearchResult => ({
      billId: r.id, title: r.title, committeeName: r.committee_name, isPassed: r.is_passed === 1,
    });
    const mkCond = keywords.map(() => 'b.title LIKE ?').join(' OR ');
    const plainCond = keywords.map(() => 'title LIKE ?').join(' OR ');
    const kArgs = keywords.map(k => `%${k}%`);

    // Inverse-frequency weighting: rare keyword matches rank above common ones.
    const kWeights = keywords.map(k => {
      const cnt = (db.prepare('SELECT COUNT(*) as cnt FROM bill WHERE title LIKE ?').get(`%${k}%`) as { cnt: number }).cnt;
      return cnt > 0 ? 1 / cnt : 1;
    });
    const scoreRows = <T extends Record<string, unknown>>(rows: T[]): T[] =>
      rows
        .map(r => {
          const score = keywords.reduce((s, k, i) => s + ((r['title'] as string)?.includes(k) ? kWeights[i] : 0), 0);
          return { ...r, _score: score };
        })
        .sort((a, b) => (b._score as number) - (a._score as number))
        .slice(0, limit) as T[];

    if (mkId !== undefined) {
      const filtered = scoreRows(db.prepare(`
        SELECT b.id, b.title, b.committee_name, b.is_passed
        FROM bill b
        JOIN bill_initiator i ON i.bill_id = b.id AND i.mk_id = ?
        WHERE ${mkCond}
        ORDER BY b.id DESC LIMIT 100
      `).all(mkId, ...kArgs) as Row[]).map(map);
      if (filtered.length > 0) return filtered;
      return (db.prepare(`
        SELECT b.id, b.title, b.committee_name, b.is_passed
        FROM bill b
        JOIN bill_initiator i ON i.bill_id = b.id AND i.mk_id = ?
        ORDER BY b.id DESC LIMIT ?
      `).all(mkId, limit) as Row[]).map(map);
    }
    return scoreRows(db.prepare(`
      SELECT id, title, committee_name, is_passed
      FROM bill WHERE ${plainCond}
      ORDER BY id DESC LIMIT 100
    `).all(...kArgs) as Row[]).map(map);
  } catch {
    return [];
  }
}

// ── MK Topic Timeline ──────────────────────────────────────────────────────────

export interface TimelineEvent {
  type: 'bill' | 'vote' | 'query';
  date: string;
  title: string;
  detail: string;   // bill status_desc, vote stance (בעד/נגד/נמנע), or empty
  sourceId: number; // bill id, plenary_vote id, or mk_query id
}

/**
 * Build a chronological activity timeline for a given MK on a topic.
 * Searches bills (by initiator), plenary votes, and parliamentary queries using
 * LIKE matching against the first (most specific) keyword.
 * Returns up to `limit` events sorted newest-first.
 */
export function getMkTopicTimeline(
  mkId: number,
  keywords: string[],
  limit = 20,
): TimelineEvent[] {
  const db = getDb();
  if (!db || keywords.length === 0) return [];

  // Use the first keyword (longest/most specific after caller sorts them)
  const kw = `%${keywords[0]}%`;
  const events: TimelineEvent[] = [];

  try {
    // Bills: bill table joined with bill_initiator
    const bills = db.prepare(`
      SELECT b.id, b.title, b.init_date, b.status_desc, b.is_passed
      FROM bill b
      JOIN bill_initiator bi ON bi.bill_id = b.id
      WHERE bi.mk_id = ? AND b.title LIKE ?
      ORDER BY b.init_date DESC
      LIMIT ?
    `).all(mkId, kw, limit) as Array<{ id: number; title: string; init_date: string | null; status_desc: string | null; is_passed: number }>;

    for (const b of bills) {
      events.push({
        type: 'bill',
        date: b.init_date?.slice(0, 10) ?? '',
        title: b.title,
        detail: b.status_desc ?? (b.is_passed ? 'עבר' : ''),
        sourceId: b.id,
      });
    }

    // Votes: plenary_vote joined with mk_vote_result
    const VOTE_LABEL: Record<number, string> = { 7: 'בעד', 8: 'נגד', 9: 'נמנע', 6: 'נוכח' };
    const votes = db.prepare(`
      SELECT pv.id, pv.title, pv.date, mvr.result_code
      FROM plenary_vote pv
      JOIN mk_vote_result mvr ON mvr.vote_id = pv.id AND mvr.mk_id = ?
      WHERE pv.title LIKE ? OR pv.micro_agenda LIKE ?
      ORDER BY pv.date DESC
      LIMIT ?
    `).all(mkId, kw, kw, limit) as Array<{ id: number; title: string; date: string; result_code: number }>;

    for (const v of votes) {
      events.push({
        type: 'vote',
        date: v.date?.slice(0, 10) ?? '',
        title: v.title,
        detail: VOTE_LABEL[v.result_code] ?? '',
        sourceId: v.id,
      });
    }

    // Queries: mk_query
    const queries = db.prepare(`
      SELECT id, title, submit_date
      FROM mk_query
      WHERE mk_id = ? AND (title LIKE ? OR body LIKE ?)
      ORDER BY submit_date DESC
      LIMIT ?
    `).all(mkId, kw, kw, limit) as Array<{ id: number; title: string; submit_date: string }>;

    for (const q of queries) {
      events.push({
        type: 'query',
        date: q.submit_date?.slice(0, 10) ?? '',
        title: q.title,
        detail: '',
        sourceId: q.id,
      });
    }
  } catch (e) {
    console.error('getMkTopicTimeline error:', e);
  }

  // Sort all events by date descending and cap at limit
  events.sort((a, b) => b.date.localeCompare(a.date));
  return events.slice(0, limit);
}

export interface QuerySearchResult {
  queryId: number;
  title: string;
  submitDate: string;
  mkId: number;
  mkName: string;
  body: string | null;
  ministryResponse: string | null;
}

/**
 * For a specific MK: returns their recent parliamentary queries.
 * Without an MK: keyword search on query title or body.
 * Accepts a single keyword or array of keywords (OR-matched).
 */
export function searchQueriesByKeyword(keyword: string | string[], mkId?: number, limit = 8): QuerySearchResult[] {
  const db = getDb();
  if (!db) return [];
  try {
    const keywords = (Array.isArray(keyword) ? keyword : [keyword]).filter(k => k.length >= 2);
    if (keywords.length === 0) return [];
    type Row = { id: number; title: string; submit_date: string; mk_id: number; first_name: string; last_name: string; body: string | null; ministry_response: string | null };
    const map = (r: Row): QuerySearchResult => ({
      queryId: r.id, title: r.title, submitDate: r.submit_date,
      mkId: r.mk_id, mkName: `${r.first_name} ${r.last_name}`,
      body: r.body, ministryResponse: r.ministry_response,
    });
    const cond = keywords.map(() => '(q.title LIKE ? OR q.body LIKE ?)').join(' OR ');
    const kArgs = keywords.flatMap(k => [`%${k}%`, `%${k}%`]);

    if (mkId !== undefined) {
      const filtered = (db.prepare(`
        SELECT q.id, q.title, q.submit_date, q.mk_id, p.first_name, p.last_name, q.body, q.ministry_response
        FROM mk_query q JOIN mk_person p ON p.person_id = q.mk_id
        WHERE q.mk_id = ? AND (${cond})
        ORDER BY q.submit_date DESC LIMIT ?
      `).all(mkId, ...kArgs, limit) as Row[]).map(map);
      if (filtered.length > 0) return filtered;
      return (db.prepare(`
        SELECT q.id, q.title, q.submit_date, q.mk_id, p.first_name, p.last_name, q.body, q.ministry_response
        FROM mk_query q JOIN mk_person p ON p.person_id = q.mk_id
        WHERE q.mk_id = ?
        ORDER BY q.submit_date DESC LIMIT ?
      `).all(mkId, limit) as Row[]).map(map);
    }
    return (db.prepare(`
      SELECT q.id, q.title, q.submit_date, q.mk_id, p.first_name, p.last_name, q.body, q.ministry_response
      FROM mk_query q JOIN mk_person p ON p.person_id = q.mk_id
      WHERE ${cond}
      ORDER BY q.submit_date DESC LIMIT ?
    `).all(...kArgs, limit) as Row[]).map(map);
  } catch {
    return [];
  }
}

// ── Vote coalition breakdown ─────────────────────────────────────────────────

export interface FactionVoteBreakdown {
  factionName: string;
  forCount: number;
  againstCount: number;
  abstainCount: number;
  presentCount: number;
}

export interface VoteCoalitionData {
  voteId: number;
  voteTitle: string;
  voteDate: string;
  totalFor: number;
  totalAgainst: number;
  totalAbstain: number;
  isPassed: boolean;
  factions: FactionVoteBreakdown[];
}

/**
 * Get a per-faction vote breakdown for a single plenary vote.
 * Uses mk_person.faction_name to group MKs (the faction recorded at sync time).
 * result_code: 7=בעד, 8=נגד, 9=נמנע, 6=נוכח
 */
export function getVoteCoalition(voteId: number): VoteCoalitionData | null {
  const db = getDb();
  if (!db) return null;

  const vote = db
    .prepare(
      `SELECT id, title, date, total_for, total_against, total_abstain, is_passed
       FROM plenary_vote WHERE id = ?`,
    )
    .get(voteId) as {
      id: number; title: string; date: string;
      total_for: number; total_against: number; total_abstain: number; is_passed: number;
    } | undefined;

  if (!vote) return null;

  const rows = db
    .prepare(
      `SELECT p.faction_name, r.result_code, COUNT(*) as cnt
       FROM mk_vote_result r
       JOIN mk_person p ON p.person_id = r.mk_id
       WHERE r.vote_id = ?
       GROUP BY p.faction_name, r.result_code`,
    )
    .all(voteId) as Array<{ faction_name: string | null; result_code: number; cnt: number }>;

  // Aggregate per faction
  const factionMap = new Map<string, FactionVoteBreakdown>();
  for (const row of rows) {
    const name = row.faction_name?.trim() || 'לא ידוע';
    if (!factionMap.has(name)) {
      factionMap.set(name, { factionName: name, forCount: 0, againstCount: 0, abstainCount: 0, presentCount: 0 });
    }
    const f = factionMap.get(name)!;
    if (row.result_code === 7) f.forCount += row.cnt;
    else if (row.result_code === 8) f.againstCount += row.cnt;
    else if (row.result_code === 9) f.abstainCount += row.cnt;
    else if (row.result_code === 6) f.presentCount += row.cnt;
  }

  const factions = Array.from(factionMap.values()).sort(
    (a, b) => (b.forCount + b.againstCount) - (a.forCount + a.againstCount),
  );

  return {
    voteId: vote.id,
    voteTitle: vote.title,
    voteDate: vote.date.slice(0, 10),
    totalFor: vote.total_for,
    totalAgainst: vote.total_against,
    totalAbstain: vote.total_abstain,
    isPassed: vote.is_passed === 1,
    factions,
  };
}

// ── Faction vote context ─────────────────────────────────────────────────────────

export interface FactionVoteContext {
  voteId: number;
  totalFor: number;
  totalAgainst: number;
  majorityCode: number; // 7=for, 8=against, 6=abstain
  rebelCount: number;
}

export function getMkFactionId(mkId: number): number | null {
  const db = getDb();
  if (!db) return null;
  const r = db.prepare('SELECT faction_id FROM mk_person WHERE person_id = ?').get(mkId) as { faction_id: number } | undefined;
  return r?.faction_id ?? null;
}

export function getVoteFactionContext(voteIds: number[], factionId: number): Map<number, FactionVoteContext> {
  const db = getDb();
  if (!db || voteIds.length === 0) return new Map();
  const placeholders = voteIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT vote_id, total_for, total_against, majority_code, rebel_count
    FROM vote_faction_stats
    WHERE vote_id IN (${placeholders}) AND faction_id = ?
  `).all(...voteIds, factionId) as Array<{ vote_id: number; total_for: number; total_against: number; majority_code: number; rebel_count: number }>;
  return new Map(rows.map(r => [r.vote_id, {
    voteId: r.vote_id,
    totalFor: r.total_for,
    totalAgainst: r.total_against,
    majorityCode: r.majority_code,
    rebelCount: r.rebel_count,
  }]));
}
