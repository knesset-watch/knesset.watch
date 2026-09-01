/* ═══════════════════════════════════════════════════════════════════════════
 *  מדד מעורבות באג'נדה
 *
 *  לכל חבר כנסת ולכל אג'נדה — ציון נפרד. ח"כ יכול לקבל 90 באג'נדה אחת
 *  ו-10 באחרת, וזה בדיוק העניין.
 *
 *      AgendaActivity(mk, a) = 0.6 · P_I(mk, a) + 0.4 · P_V(mk, a)
 *
 *    P_I — אחוזון מספר הצעות החוק שיזם באג'נדה.
 *    P_V — אחוזון שיעור ההצבעות שבהן תמך בכיוון האג'נדה.
 *
 *  ההבדל מ-getEngagementIndex ב-knesset-db.ts: שם המדד כללי ומודד כמה ח"כ
 *  פעיל בכלל; כאן הוא ממוקד בנושא ותלוי בעמדה שהמשתמש בחר.
 *
 *  ההבדל מ-computeMatch ב-compute-match.ts: שם השאלה היא "האם הוא מצביע
 *  כמוני" — ובגלל 99.83% משמעת סיעתית התשובה מוכתבת כמעט כולה על ידי הסיעה.
 *  כאן השאלה היא "כמה הוא עובד על זה", והיא מבדילה בין חברי אותה סיעה.
 *
 *  ⚠ שלוש מלכודות שנבדקו במאגר ומטופלות כאן במפורש:
 *
 *  1. אחוזון על אפסים. ברוב האג'נדות רוב הח"כים לא עשו דבר — ב"תחבורה
 *     ציבורית בשבת" ל-110 מתוך 120 יש אפס הצעות חוק. דירוג בתוך כל 120
 *     היה נותן להם אחוזון ~46, כלומר 28 נקודות על לא-כלום. לכן מדרגים רק
 *     בתוך קבוצת הפעילים, ומי שאין לו כלום מקבל 0 מפורש.
 *
 *  2. הסתייגויות. חוק שנוי במחלוקת מקבל עשרות הצבעות נפרדות שכולן נושאות
 *     את אותה כותרת — חוק אחד במאגר עם 268 הצבעות, בעוד החציון הוא 1.
 *     יוזם החוק מצביע נגד כל הסתייגות של האופוזיציה, וספירה נאיבית הופכת
 *     את זה ל"הצביע נגד החוק שלו". בלי ניכוי כפילויות מקבלים 35% כאלה,
 *     ואיתו — 3.7%. לכן נשמרת הצבעה אחת אחרונה לכל צמד (חוק, ח"כ).
 *
 *  3. שרים. לא מגישים הצעות חוק פרטיות ולא נוכחים בהצבעות, ולכן יקבלו אפס
 *     בכל אג'נדה. הדגל isMinister קיים כדי שהתצוגה תוכל להסביר זאת.
 *
 *  הנחת יסוד: המאגר מכיל את הכנסת ה-25 בלבד. ראו ההערה ב-getEngagementIndex.
 * ═══════════════════════════════════════════════════════════════════════════ */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { POLITICAL_ISSUES } from './agendas';
import {
  percentileRank,
  parseTenure,
  countVotesDuringTenure,
  billAdvanced,
} from './knesset-db';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

/** משקלות המדד. 60% יוזמה חקיקתית, 40% פעילות בהצבעות */
const WEIGHT_INITIATIVE = 0.6;
const WEIGHT_VOTING = 0.4;

/**
 * מתחת לסף הזה אין מספיק חומר באג'נדה כדי לדרג.
 * אחוזון על קבוצה של עשרה אנשים הוא רעש, לא מדד.
 */
const MIN_BILLS_FOR_RANKING = 15;
const MIN_VOTES_FOR_RANKING = 10;

const RESULT_FOR = 7;
const RESULT_AGAINST = 8;

/** התקבלה בקריאה שלישית. תואם ל-STATUS_BECAME_LAW ב-knesset-db.ts */
const STATUS_BECAME_LAW = 118;

/** כמה הצעות חוק מוחזרות לקישור בכל אג'נדה. מספיק לאימות, לא מנפח את התשובה */
const MAX_BILL_REFS = 8;

/** מה המשתמש בחר: אג'נדה, ואם ידועה — גם העמדה שהוא מזדהה איתה */
export interface AgendaSelection {
  issueId: string;
  /** מזהה מתוך POLITICAL_ISSUES[].stances. בלעדיו המדד מתעלם מכיוון */
  stanceId?: string;
}

/** מאיפה הגיע שיוך הפריט לאג'נדה — משנה את מידת האמון בתוצאה */
export type AgendaSource = 'classification' | 'keywords';

export interface AgendaFlags {
  /** הצביע נגד עמדת סיעתו בהצבעות האג'נדה. 387 מקרים בכנסת כולה */
  rebelVotes: number;
  /** יזם חוק באג'נדה והצביע נגדו. 73 מקרים בכנסת כולה */
  contradictedOwnBill: number;
}

/** הצעת חוק קונקרטית שהח"כ יזם, לקישור מהתצוגה אל /bill/[id] */
export interface AgendaBillRef {
  billId: number;
  title: string;
  /** עברה את הקריאה הטרומית */
  advanced: boolean;
  /** התקבלה בקריאה שלישית */
  passed: boolean;
}

export interface AgendaScore {
  issueId: string;
  label: string;

  /** מספר הצעות החוק שיזם באג'נדה */
  billsInitiated: number;
  /** כמה מהן עברו את הקריאה הטרומית */
  billsAdvanced: number;
  /**
   * ההצעות עצמן, כדי שהמשתמש יוכל לאמת את הציון ולא רק לקרוא מספר.
   * מוגבל ל-MAX_BILL_REFS, ממוינות כך שמה שהתקדם מופיע ראשון.
   */
  bills: AgendaBillRef[];

  /** הצבעות שבהן תמך בכיוון האג'נדה */
  supportingVotes: number;
  /** הצבעות באג'נדה שהתקיימו בזמן כהונתו */
  voteOpportunities: number;
  /** supportingVotes / voteOpportunities, באחוזים */
  supportRate: number;

  pInitiative: number;
  pVoting: number;
  /** הציון לאג'נדה הזו, 0 עד 100 */
  score: number;

  flags: AgendaFlags;
}

export interface AgendaActivityRow {
  mkId: number;
  name: string;
  faction: string | null;
  slug: string | null;
  isCoalition: boolean;
  /** התצוגה חייבת להוסיף הערה — ראו מלכודת 3 למעלה */
  isMinister: boolean;

  /** ממוצע הציונים על כל האג'נדות שנבחרו */
  overallScore: number;
  perAgenda: AgendaScore[];
}

export interface AgendaCoverage {
  issueId: string;
  label: string;
  billCount: number;
  voteCount: number;
  /** כמה ח"כים מכהנים פעילים באג'נדה — קבוצת הדירוג */
  activeMks: number;
  source: AgendaSource;
  /** מתחת לסף. התצוגה צריכה להזהיר, לא להסתיר */
  belowThreshold: boolean;
}

export interface AgendaActivityResult {
  rows: AgendaActivityRow[];
  coverage: AgendaCoverage[];
  generatedAt: number;
}

/* ───────────────────────────── שיוך לאג'נדה ───────────────────────────── */

/** האם טבלת הסיווג של Gemini קיימת במאגר הזה */
function hasClassification(db: Database.Database): boolean {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='bill_political_classification'`)
    .get() as { n: number };
  return row.n > 0;
}

interface AgendaBill {
  billId: number;
  statusId: number;
  title: string;
  /** האם החוק דוחף לכיוון העמדה שנבחרה. null כשאין נתוני עמדה */
  matchesStance: boolean | null;
}

/**
 * הצעות החוק ששייכות לאג'נדה.
 *
 * מקור מועדף: הסיווג של Gemini, שנותן גם issue וגם stance. כשהוא חסר —
 * נפילה למילות המפתח של POLITICAL_ISSUES. מילות מפתח מזהות נושא אבל לא
 * כיוון, ולכן matchesStance נשאר null והמדד מתנהג כמדד השתתפות בלבד.
 */
function loadAgendaBills(
  db: Database.Database,
  selection: AgendaSelection,
  useClassification: boolean,
): AgendaBill[] {
  if (useClassification) {
    const rows = db
      .prepare(
        `SELECT c.bill_id AS billId, b.status_id AS statusId, b.title AS title,
                c.stance_id AS stanceId
         FROM bill_political_classification c
         JOIN bill b ON b.id = c.bill_id
         WHERE c.issue_id = ?`,
      )
      .all(selection.issueId) as Array<{
        billId: number; statusId: number; title: string; stanceId: string | null;
      }>;

    return rows.map(r => ({
      billId: r.billId,
      statusId: r.statusId,
      title: r.title,
      matchesStance: selection.stanceId && r.stanceId ? r.stanceId === selection.stanceId : null,
    }));
  }

  const issue = POLITICAL_ISSUES.find(i => i.id === selection.issueId);
  if (!issue || issue.keywords.length === 0) return [];

  const where = issue.keywords.map(() => 'title LIKE ?').join(' OR ');
  const params = issue.keywords.map(k => `%${k}%`);

  const rows = db
    .prepare(`SELECT id AS billId, status_id AS statusId, title FROM bill WHERE ${where}`)
    .all(...params) as Array<{ billId: number; statusId: number; title: string }>;

  return rows.map(r => ({ ...r, matchesStance: null }));
}

interface AgendaVote {
  voteId: number;
  billId: number | null;
  date: string;
  matchesStance: boolean | null;
}

/**
 * ההצבעות ששייכות לאג'נדה.
 *
 * דרך אחת: ההצבעה מקושרת לחוק מסווג (plenary_vote.bill_id, מאוכלס ב-67%
 * מההצבעות והוא היוריסטי — ראו bill_id_source). דרך שנייה, לשאר: מילות
 * מפתח על כותרת ההצבעה, אחרת שליש מההצבעות נעלמות.
 */
function loadAgendaVotes(
  db: Database.Database,
  selection: AgendaSelection,
  bills: AgendaBill[],
): AgendaVote[] {
  const stanceByBill = new Map(bills.map(b => [b.billId, b.matchesStance]));
  const found = new Map<number, AgendaVote>();

  if (stanceByBill.size > 0) {
    const ids = [...stanceByBill.keys()];
    const chunk = 400; // גבול פרמטרים של SQLite
    for (let i = 0; i < ids.length; i += chunk) {
      const slice = ids.slice(i, i + chunk);
      const rows = db
        .prepare(
          `SELECT id AS voteId, bill_id AS billId, date
           FROM plenary_vote
           WHERE bill_id IN (${slice.map(() => '?').join(',')})`,
        )
        .all(...slice) as Array<{ voteId: number; billId: number; date: string }>;

      for (const r of rows) {
        found.set(r.voteId, { ...r, matchesStance: stanceByBill.get(r.billId) ?? null });
      }
    }
  }

  const issue = POLITICAL_ISSUES.find(i => i.id === selection.issueId);
  if (issue && issue.keywords.length > 0) {
    const where = issue.keywords.map(() => 'title LIKE ?').join(' OR ');
    const rows = db
      .prepare(`SELECT id AS voteId, bill_id AS billId, date FROM plenary_vote WHERE ${where}`)
      .all(...issue.keywords.map(k => `%${k}%`)) as Array<{ voteId: number; billId: number | null; date: string }>;

    for (const r of rows) {
      if (!found.has(r.voteId)) {
        found.set(r.voteId, { ...r, matchesStance: r.billId ? stanceByBill.get(r.billId) ?? null : null });
      }
    }
  }

  return [...found.values()];
}

/* ───────────────────────────── ספירה לכל ח"כ ───────────────────────────── */

interface MkTally {
  billsInitiated: number;
  billsAdvanced: number;
  supportingVotes: number;
  rebelVotes: number;
  contradictedOwnBill: number;
  /** ההצעות עצמן, לקישור מהתצוגה */
  bills: AgendaBillRef[];
}

function emptyTally(): MkTally {
  return {
    billsInitiated: 0,
    billsAdvanced: 0,
    supportingVotes: 0,
    rebelVotes: 0,
    contradictedOwnBill: 0,
    bills: [],
  };
}

/**
 * תמיכה בכיוון האג'נדה.
 *
 * כשהעמדה ידועה — הצבעה בעד חוק תואם, או נגד חוק מנוגד, שתיהן תמיכה.
 * כשאינה ידועה — נופלים למדידת השתתפות: כל הצבעה שבה נקט עמדה (בעד או
 * נגד) נספרת, כי לקיחת צד היא מעורבות ואילו הימנעות אינה. הכיוון עצמו
 * אינו מבדיל בין ח"כים ממילא — 99.83% מההצבעות תואמות את רוב הסיעה.
 */
function isSupportive(resultCode: number, matchesStance: boolean | null): boolean {
  if (matchesStance === null) {
    return resultCode === RESULT_FOR || resultCode === RESULT_AGAINST;
  }
  if (matchesStance) return resultCode === RESULT_FOR;
  return resultCode === RESULT_AGAINST;
}

/**
 * ספירת הצבעות, אחרי ניכוי כפילויות ההסתייגויות.
 *
 * לכל צמד (חוק, ח"כ) נשמרת ההצבעה האחרונה בלבד — אותו דדופ שארבל עשתה
 * ב-compute-match.ts. הצבעות בלי חוק מזוהה נספרות כמות שהן, כי אין להן
 * כפילות. ראו מלכודת 2 בראש הקובץ.
 */
function tallyVotes(
  db: Database.Database,
  votes: AgendaVote[],
  tallies: Map<number, MkTally>,
  initiatorsByBill: Map<number, Set<number>>,
): void {
  if (votes.length === 0) return;

  const stanceByVote = new Map(votes.map(v => [v.voteId, v.matchesStance]));
  const billByVote = new Map(votes.map(v => [v.voteId, v.billId]));
  const dateByVote = new Map(votes.map(v => [v.voteId, v.date]));

  /** ההצבעה האחרונה שנשמרה לכל צמד חוק+ח"כ, כדי לנטרל הסתייגויות */
  const latestPerBillMk = new Map<string, { voteId: number; date: string; resultCode: number }>();
  const standalone: Array<{ mkId: number; voteId: number; resultCode: number }> = [];

  const ids = votes.map(v => v.voteId);
  const chunk = 400;

  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    const rows = db
      .prepare(
        `SELECT r.vote_id AS voteId, r.mk_id AS mkId, r.result_code AS resultCode,
                s.majority_code AS majorityCode
         FROM mk_vote_result r
         LEFT JOIN mk_person p ON p.person_id = r.mk_id
         LEFT JOIN vote_faction_stats s
                ON s.vote_id = r.vote_id AND s.faction_id = p.faction_id
         WHERE r.vote_id IN (${slice.map(() => '?').join(',')})
           AND r.result_code IN (${RESULT_FOR}, ${RESULT_AGAINST})`,
      )
      .all(...slice) as Array<{ voteId: number; mkId: number; resultCode: number; majorityCode: number | null }>;

    for (const r of rows) {
      // מרד סיעתי נספר על ההצבעה הגולמית, לפני הדדופ — כל חריגה נחשבת
      if (r.majorityCode !== null && r.resultCode !== r.majorityCode) {
        const t = tallies.get(r.mkId);
        if (t) t.rebelVotes += 1;
      }

      const billId = billByVote.get(r.voteId) ?? null;
      if (billId === null) {
        standalone.push({ mkId: r.mkId, voteId: r.voteId, resultCode: r.resultCode });
        continue;
      }

      const key = `${billId}|${r.mkId}`;
      const date = dateByVote.get(r.voteId) ?? '';
      const prev = latestPerBillMk.get(key);
      if (!prev || date > prev.date || (date === prev.date && r.voteId > prev.voteId)) {
        latestPerBillMk.set(key, { voteId: r.voteId, date, resultCode: r.resultCode });
      }
    }
  }

  for (const [key, v] of latestPerBillMk) {
    const [billIdStr, mkIdStr] = key.split('|');
    const billId = Number(billIdStr);
    const mkId = Number(mkIdStr);
    const t = tallies.get(mkId);
    if (!t) continue;

    if (isSupportive(v.resultCode, stanceByVote.get(v.voteId) ?? null)) {
      t.supportingVotes += 1;
    }
    if (v.resultCode === RESULT_AGAINST && initiatorsByBill.get(billId)?.has(mkId)) {
      t.contradictedOwnBill += 1;
    }
  }

  for (const s of standalone) {
    const t = tallies.get(s.mkId);
    if (!t) continue;
    if (isSupportive(s.resultCode, stanceByVote.get(s.voteId) ?? null)) {
      t.supportingVotes += 1;
    }
  }
}

/* ───────────────────────────── החישוב הראשי ───────────────────────────── */

interface MkMeta {
  mkId: number;
  name: string;
  faction: string | null;
  slug: string | null;
  isCoalition: boolean;
  isMinister: boolean;
  tenure: ReturnType<typeof parseTenure>;
}

function loadCurrentMks(db: Database.Database): Map<number, MkMeta> {
  const rows = db
    .prepare(
      `SELECT person_id AS mkId, first_name AS firstName, last_name AS lastName,
              faction_name AS faction, slug, is_coalition AS isCoalition, segments
       FROM mk_person
       WHERE is_current = 1`,
    )
    .all() as Array<{
      mkId: number; firstName: string; lastName: string;
      faction: string | null; slug: string | null; isCoalition: number; segments: string | null;
    }>;

  const ministers = loadMinisters(db);

  return new Map(
    rows.map(r => [
      r.mkId,
      {
        mkId: r.mkId,
        name: `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim(),
        faction: r.faction,
        slug: r.slug,
        isCoalition: r.isCoalition === 1,
        isMinister: ministers.has(r.mkId),
        tenure: parseTenure(r.segments),
      },
    ]),
  );
}

/**
 * שרים מכהנים, מתוך mk_position.duty_desc.
 *
 * הדפוסים מעוגנים לתחילת המחרוזת בכוונה. חיפוש חופשי של '%שר%' תופס גם
 * "חבר ועדה המיוחדת לדיון בהצעת חוק-יסוד: הממשלה (תיקון - שר נ..." ומנפח
 * את הרשימה מ-24 שרים אמיתיים ל-36.
 */
function loadMinisters(db: Database.Database): Set<number> {
  const rows = db
    .prepare(
      `SELECT DISTINCT mk_id AS mkId FROM mk_position
       WHERE is_current = 1
         AND (duty_desc LIKE 'שר %'
           OR duty_desc LIKE 'השר %'
           OR duty_desc LIKE 'שרה %'
           OR duty_desc LIKE 'השרה %'
           OR duty_desc = 'שר'
           OR duty_desc LIKE 'ראש הממשלה%'
           OR duty_desc LIKE 'סגן שר%'
           OR duty_desc LIKE 'סגנית שר%')`,
    )
    .all() as Array<{ mkId: number }>;
  return new Set(rows.map(r => r.mkId));
}

/**
 * הציון לכל ח"כ ולכל אג'נדה שנבחרה.
 *
 * @param selections האג'נדות שהמשתמש בחר, ואם ידועה — העמדה שהוא מזדהה איתה
 * @param opts.countOnlyAdvancedBills לספור רק הצעות שעברו קריאה טרומית.
 *        ברירת המחדל false, בעקבות ההחלטה ב-getEngagementIndex שם הספירה
 *        גולמית וההתקדמות היא נתון תצוגה. שווה לבדוק את שתי הגרסאות —
 *        באג'נדה בודדת המספרים קטנים והגשה סיטונאית משפיעה יותר.
 */
export function computeAgendaActivity(
  selections: AgendaSelection[],
  opts: { countOnlyAdvancedBills?: boolean } = {},
): AgendaActivityResult {
  const empty: AgendaActivityResult = { rows: [], coverage: [], generatedAt: Date.now() };
  if (selections.length === 0 || !fs.existsSync(DB_PATH)) return empty;

  const db = new Database(DB_PATH, { readonly: true });

  try {
    const useClassification = hasClassification(db);
    const mks = loadCurrentMks(db);
    const coverage: AgendaCoverage[] = [];
    const scoresByMk = new Map<number, AgendaScore[]>();

    for (const selection of selections) {
      const issue = POLITICAL_ISSUES.find(i => i.id === selection.issueId);
      if (!issue) continue;

      const bills = loadAgendaBills(db, selection, useClassification);
      const votes = loadAgendaVotes(db, selection, bills);

      const tallies = new Map<number, MkTally>();
      for (const mkId of mks.keys()) tallies.set(mkId, emptyTally());

      const initiatorsByBill = tallyBills(db, bills, tallies, opts.countOnlyAdvancedBills === true);
      tallyVotes(db, votes, tallies, initiatorsByBill);

      const voteDates = votes.map(v => v.date);

      // קבוצת הדירוג: רק מי שעשה משהו באג'נדה. ראו מלכודת 1 בראש הקובץ
      const active = [...tallies.entries()].filter(
        ([, t]) => t.billsInitiated > 0 || t.supportingVotes > 0,
      );

      const billValues = active.map(([, t]) => t.billsInitiated);
      const rateValues = active.map(([mkId, t]) => {
        const opportunities = countVotesDuringTenure(voteDates, mks.get(mkId)!.tenure);
        return opportunities > 0 ? t.supportingVotes / opportunities : 0;
      });

      for (const [mkId, tally] of active) {
        const meta = mks.get(mkId)!;
        const opportunities = countVotesDuringTenure(voteDates, meta.tenure);
        const rate = opportunities > 0 ? tally.supportingVotes / opportunities : 0;

        const pInitiative = percentileAmongActive(billValues, tally.billsInitiated);
        const pVoting = percentileAmongActive(rateValues, rate);

        const list = scoresByMk.get(mkId) ?? [];
        list.push({
          issueId: issue.id,
          label: issue.label,
          billsInitiated: tally.billsInitiated,
          billsAdvanced: tally.billsAdvanced,
          // מה שהתקדם ראשון — זו ההצעה ששווה ללחוץ עליה
          bills: [...tally.bills]
            .sort((x, y) => Number(y.passed) - Number(x.passed) || Number(y.advanced) - Number(x.advanced))
            .slice(0, MAX_BILL_REFS),
          supportingVotes: tally.supportingVotes,
          voteOpportunities: opportunities,
          supportRate: round1(rate * 100),
          pInitiative: round1(pInitiative),
          pVoting: round1(pVoting),
          score: round1(WEIGHT_INITIATIVE * pInitiative + WEIGHT_VOTING * pVoting),
          flags: {
            rebelVotes: tally.rebelVotes,
            contradictedOwnBill: tally.contradictedOwnBill,
          },
        });
        scoresByMk.set(mkId, list);
      }

      coverage.push({
        issueId: issue.id,
        label: issue.label,
        billCount: bills.length,
        voteCount: votes.length,
        activeMks: active.length,
        source: useClassification ? 'classification' : 'keywords',
        belowThreshold: bills.length < MIN_BILLS_FOR_RANKING || votes.length < MIN_VOTES_FOR_RANKING,
      });
    }

    const rows: AgendaActivityRow[] = [];
    for (const [mkId, perAgenda] of scoresByMk) {
      const meta = mks.get(mkId)!;
      // ממוצע על האג'נדות שנבחרו. אג'נדה שהח"כ לא נגע בה נספרת כאפס,
      // אחרת מי שפעיל באחת מתוך שלוש היה מדורג כמו מי שפעיל בכולן.
      const sum = perAgenda.reduce((s, a) => s + a.score, 0);
      rows.push({
        mkId,
        name: meta.name,
        faction: meta.faction,
        slug: meta.slug,
        isCoalition: meta.isCoalition,
        isMinister: meta.isMinister,
        overallScore: round1(sum / selections.length),
        perAgenda: perAgenda.sort((a, b) => b.score - a.score),
      });
    }

    rows.sort((a, b) => b.overallScore - a.overallScore);

    return { rows, coverage, generatedAt: Date.now() };
  } finally {
    db.close();
  }
}

/** ספירת הצעות החוק לכל ח"כ, ומיפוי היוזמים לכל חוק לצורך דגל הסתירה */
function tallyBills(
  db: Database.Database,
  bills: AgendaBill[],
  tallies: Map<number, MkTally>,
  onlyAdvanced: boolean,
): Map<number, Set<number>> {
  const initiatorsByBill = new Map<number, Set<number>>();
  if (bills.length === 0) return initiatorsByBill;

  const byId = new Map(bills.map(b => [b.billId, b]));
  const ids = [...byId.keys()];
  const chunk = 400;

  // אילו חוקים הגיעו להצבעה במליאה — נדרש ל-billAdvanced
  const reachedPlenary = new Set<number>();
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    const rows = db
      .prepare(
        `SELECT DISTINCT bill_id AS billId FROM plenary_vote
         WHERE bill_id IN (${slice.map(() => '?').join(',')})`,
      )
      .all(...slice) as Array<{ billId: number }>;
    for (const r of rows) reachedPlenary.add(r.billId);
  }

  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    const rows = db
      .prepare(
        `SELECT bill_id AS billId, mk_id AS mkId FROM bill_initiator
         WHERE bill_id IN (${slice.map(() => '?').join(',')})`,
      )
      .all(...slice) as Array<{ billId: number; mkId: number }>;

    for (const r of rows) {
      let set = initiatorsByBill.get(r.billId);
      if (!set) initiatorsByBill.set(r.billId, (set = new Set()));
      set.add(r.mkId);

      const tally = tallies.get(r.mkId);
      const bill = byId.get(r.billId);
      if (!tally || !bill) continue;

      const advanced = billAdvanced(bill.statusId, reachedPlenary.has(r.billId));
      if (advanced) tally.billsAdvanced += 1;
      if (!onlyAdvanced || advanced) {
        tally.billsInitiated += 1;
        tally.bills.push({
          billId: bill.billId,
          title: bill.title,
          advanced,
          passed: bill.statusId === STATUS_BECAME_LAW,
        });
      }
    }
  }

  return initiatorsByBill;
}

/**
 * אחוזון בתוך הפעילים בלבד. אפס נשאר אפס.
 *
 * זה הלב של מלכודת 1. סינון קבוצת הדירוג לבדו אינו מספיק: גם בתוך קבוצת
 * הפעילים רוב הח"כים לא יזמו כלום באג'נדה מסוימת, וכולם חולקים את הערך
 * אפס. percentileRank סופר תיקו כחצי, ולכן היה מזכה אותם באחוזון ~45 —
 * כלומר 27 נקודות על אפס הצעות חוק. נמדד בפועל על "הרפורמה המשפטית",
 * שם ל-108 מתוך 111 הפעילים אין ולו הצעה אחת.
 *
 * לכן כל רכיב מדורג בנפרד, בתוך מי שיש לו ערך חיובי באותו רכיב.
 */
function percentileAmongActive(allValues: number[], value: number): number {
  if (value <= 0) return 0;
  const active = allValues.filter(v => v > 0);
  return percentileRank(active, value);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
