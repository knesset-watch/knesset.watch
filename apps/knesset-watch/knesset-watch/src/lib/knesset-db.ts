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
): Array<{ mkId: number; resultCode: number }> {
  const db = getDb();
  if (!db) return [];

  return db
    .prepare(
      `SELECT mk_id AS mkId, result_code AS resultCode
       FROM mk_vote_result WHERE vote_id = ?`,
    )
    .all(voteId) as Array<{ mkId: number; resultCode: number }>;
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
  summary: string | null;
  docUrl: string | null;
  microAgenda: string | null;
  macroAgenda: string | null;
  initDate: string | null;
  initiators: Array<{ id: number; name: string; slug: string | null }>;
}

export interface CommitteeDetail {
  name: string;
  billCount: number;
  passedCount: number;
  sessionCount: number;
  members: CommitteeMember[];
  bills: CommitteeBill[];
}

export function getCommitteeDetail(name: string): CommitteeDetail | null {
  const db = getDb();
  if (!db) return null;

  const billStats = db.prepare(`
    SELECT COUNT(*) as total, SUM(is_passed) as passed
    FROM bill WHERE committee_name = ?
  `).get(name) as { total: number; passed: number } | undefined;
  if (!billStats || billStats.total === 0) return null;

  // Get committee_id for session count lookup
  const committeeIdRow = db.prepare(`
    SELECT DISTINCT committee_id FROM bill WHERE committee_name = ? AND committee_id != -1 LIMIT 1
  `).get(name) as { committee_id: number } | undefined;

  const sessionCount = committeeIdRow
    ? (db.prepare(`SELECT COUNT(*) as cnt FROM committee_session WHERE committee_id = ?`).get(committeeIdRow.committee_id) as { cnt: number }).cnt
    : 0;

  const memberRows = db.prepare(`
    SELECT pos.duty_desc, mp.person_id as id, mp.first_name || ' ' || mp.last_name as name,
           mp.slug, mp.is_coalition as isCoalition
    FROM mk_position pos
    JOIN mk_person mp ON mp.person_id = pos.mk_id
    WHERE pos.is_current = 1 AND pos.committee = ? AND mp.is_current = 1
    GROUP BY mp.person_id
    ORDER BY mp.last_name
  `).all(name) as Array<{ duty_desc: string | null; id: number; name: string; slug: string | null; isCoalition: number | null }>;

  const billRows = db.prepare(`
    SELECT b.id, b.title, b.subtype, b.is_passed, b.summary, b.doc_url,
           b.micro_agenda, b.macro_agenda, b.init_date
    FROM bill b
    WHERE b.committee_name = ?
    ORDER BY b.is_passed DESC, b.id DESC
  `).all(name) as Array<{ id: number; title: string; subtype: string; is_passed: number; summary: string | null; doc_url: string | null; micro_agenda: string | null; macro_agenda: string | null; init_date: string | null }>;

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
    summary: r.summary,
    docUrl: r.doc_url,
    microAgenda: r.micro_agenda,
    macroAgenda: r.macro_agenda,
    initDate: r.init_date ?? null,
    initiators: getInitiators.all(r.id) as Array<{ id: number; name: string; slug: string | null }>,
  }));

  return {
    name,
    billCount: billStats.total,
    passedCount: billStats.passed ?? 0,
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
      pos.duty_desc as ministerRole,
      pos.ministry,
      (SELECT COUNT(*) FROM bill_initiator WHERE mk_id = mp.person_id) as billCount,
      (SELECT COUNT(DISTINCT bi.bill_id) FROM bill_initiator bi JOIN bill b ON b.id = bi.bill_id WHERE bi.mk_id = mp.person_id AND b.is_passed = 1) as passedCount
    FROM mk_position pos
    JOIN mk_person mp ON mp.person_id = pos.mk_id
    WHERE pos.is_current = 1 AND mp.is_current = 1
      AND (pos.duty_desc LIKE 'שר %' OR pos.duty_desc LIKE 'שרת %'
        OR pos.duty_desc LIKE 'השר %' OR pos.duty_desc LIKE 'השרה %'
        OR pos.duty_desc LIKE 'סגן שר%' OR pos.duty_desc LIKE 'סגנית שר%')
    GROUP BY mp.person_id
    ORDER BY
      CASE WHEN pos.duty_desc LIKE 'סגן%' OR pos.duty_desc LIKE 'סגנית%' THEN 1 ELSE 0 END,
      mp.last_name
  `).all() as Array<{ id: number; name: string; slug: string | null; isCoalition: number | null; factionName: string | null; ministerRole: string; ministry: string | null; billCount: number; passedCount: number }>)
  .map(r => ({
    ...r,
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
  year?: string;
}

export function getBills(opts: GetBillsOptions): { bills: BillRow[]; total: number } {
  const db = getDb();
  if (!db) return { bills: [], total: 0 };

  const { limit = 50, offset = 0, passedOnly, q, committee, year } = opts;

  let where = 'WHERE 1=1';
  const params: (string | number)[] = [];

  if (passedOnly) { where += ' AND b.is_passed = 1'; }
  if (q) {
    where += ' AND (b.title LIKE ? OR b.summary LIKE ? OR b.micro_agenda LIKE ?)';
    const term = `%${q}%`;
    params.push(term, term, term);
  }
  if (committee) { where += ' AND b.committee_name = ?'; params.push(committee); }
  if (year) { where += ' AND b.init_date = ?'; params.push(year); }

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
