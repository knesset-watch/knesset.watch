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
 *  P_V סופר אך ורק הצבעות שהן בעד האג'נדה: בעד חוק שכיוונו תואם לעמדת
 *  המשתמש, או נגד חוק שכיוונו מנוגד לה. הצבעה שכיוון החוק שלה לא ידוע
 *  אינה נספרת — לא במונה וגם לא במכנה. כשאין באג'נדה אף הצבעה מסווגת,
 *  רכיב ההצבעות אינו קיים והציון נשען על החקיקה בלבד (votingAvailable).
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
import { dbPath } from '@/lib/knesset-db';
import fs from 'fs';
import { POLITICAL_ISSUES } from './canonical-agendas';
import {
  percentileRank,
  parseTenure,
  countVotesDuringTenure,
  billAdvanced,
} from './knesset-db';

// הנתיב נפתר מרכזית; cwd של פונקציה סרברלס אינו תיקיית האפליקציה
const DB_PATH = dbPath() ?? '';

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

/**
 * כמה הצעות חוק מוחזרות לקישור בכל אג'נדה. היה 8 ("מספיק לאימות"), והתצוגה
 * הציגה "ועוד 7". עכשיו התצוגה מפרטת את כולן, בלי קיצורים, ולכן התקרה
 * גבוהה מכל מה שנראה במאגר (המקסימום לח"כ בציר אחד הוא כמה עשרות).
 */
const MAX_BILL_REFS = 100;

/**
 * רצפת ימי כהונה לחישוב קצב. מי שכיהן שבועיים ויזם הצעה אחת היה מקבל
 * קצב אסטרונומי ומדלג לראש הדירוג.
 */
const MIN_TENURE_DAYS = 90;

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
  /** לתווית השלב בתצוגה (bill-stage.ts), בלי להביא את כל החוק */
  statusId: number;
  /** עברה את הקריאה הטרומית */
  advanced: boolean;
  /** התקבלה בקריאה שלישית */
  passed: boolean;
  /** סוג ההצעה כשאינה פרטית: ממשלתית (מגיעה לרשימה רק דרך מיזוג עם הצעה פרטית) או של ועדה */
  kind?: 'government' | 'committee';
  /** הקרדיט ניתן כיו"ר הוועדה שהגישה את ההצעה, לא כיוזם חתום */
  viaChair?: boolean;
}

/** הצבעה אחת של הח"כ באג'נדה, לפירוט בתצוגה ולקישור אל /vote/[id] */
export interface AgendaVoteRef {
  voteId: number;
  billId: number | null;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** איך הצביע: בעד או נגד ההצעה */
  votedFor: boolean;
  /** האם ההצבעה הזאת היא בכיוון האג'נדה (true) או נגדו (false) */
  supportive: boolean;
  /** האם הצביע כמו רוב סיעתו. null כשאין נתון על הסיעה */
  withFaction: boolean | null;
  /** ההצבעה היא על הצעת חוק ממשלתית */
  government?: boolean;
  /** שלב ההצעה שהצביעו עליה (status_id), לתווית בתצוגה. null כשההצבעה לא מקושרת להצעה מסווגת */
  statusId?: number | null;
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
  /**
   * האם היו באג'נדה הצבעות עם כיוון ידוע. כשאין — pVoting הוא 0 מחוסר
   * נתונים ולא מחוסר פעילות, והציון נשען על החקיקה בלבד.
   */
  votingAvailable: boolean;
  /**
   * true — נספרו רק חוקים והצבעות שדוחפים לכיוון שהמשתמש בחר.
   * false — אין נתוני עמדה, ולכן זו פעילות בנושא ולא התאמה לעמדה.
   * התצוגה חייבת להבחין בין השניים.
   */
  stanceAware: boolean;
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

  /**
   * סיים את כהונתו. התצוגה חייבת לסמן זאת — אחרת המשתמש מקבל שם של
   * מי שפעל בכנסת ה-25 ומניח שאפשר לפנות אליו היום.
   */
  isFormer: boolean;
  /** התאריך האחרון שבו כיהן, YYYY-MM-DD. null אצל מכהנים. */
  tenureEnd: string | null;

  /** ממוצע הציונים על כל האג'נדות שנבחרו */
  overallScore: number;

  /**
   * כמה אירועים מתועדים עמדו מאחורי הציון — הצעות חוק שיזם ועוד
   * הצבעות שהיו לו הזדמנות להשתתף בהן, על פני כל האג'נדות שנבחרו.
   */
  evidenceCount: number;

  /**
   * 0–100. אמירה על גודל המדגם ולא על טיב ההתאמה: ציון 90 שנשען על
   * שתי ראיות וציון 90 שנשען על ארבעים אינם אותו דבר, והמשתמש אינו
   * יכול להבחין ביניהם בלי המספר הזה.
   */
  confidencePercent: number;

  perAgenda: AgendaScore[];
}

export interface AgendaCoverage {
  issueId: string;
  label: string;
  billCount: number;
  voteCount: number;
  /** מתוכן, כמה הצבעות כיוון החוק שלהן ידוע. רק הן נכנסות לרכיב ההצבעות */
  votesWithStance: number;
  /** האם באג'נדה הזו הופעל סינון לפי כיוון. ראו AgendaScore.stanceAware */
  stanceAware: boolean;
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
  /** "פרטית" / "ממשלתית" / "ועדה" כפי שבמאגר, או null */
  subtype: string | null;
  /** הוועדה שההצעה משויכת לה; להצעת ועדה זו הוועדה שהגישה */
  committeeName: string | null;
  /** תאריך הפרסום, לפתרון מי היה יו"ר הוועדה אז */
  publicationDate: string | null;
}

const SUBTYPE_GOVERNMENT = 'ממשלתית';
const SUBTYPE_COMMITTEE = 'ועדה';

function billKind(subtype: string | null): AgendaBillRef['kind'] {
  if (subtype === SUBTYPE_GOVERNMENT) return 'government';
  if (subtype === SUBTYPE_COMMITTEE) return 'committee';
  return undefined;
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
                c.stance_id AS stanceId, b.subtype AS subtype,
                b.committee_name AS committeeName, b.publication_date AS publicationDate
         FROM bill_political_classification c
         JOIN bill b ON b.id = c.bill_id
         WHERE c.issue_id = ?`,
      )
      .all(selection.issueId) as Array<{
        billId: number; statusId: number; title: string; stanceId: string | null;
        subtype: string | null; committeeName: string | null; publicationDate: string | null;
      }>;

    return rows.map(r => ({
      billId: r.billId,
      statusId: r.statusId,
      title: r.title,
      matchesStance: selection.stanceId && r.stanceId ? r.stanceId === selection.stanceId : null,
      subtype: r.subtype,
      committeeName: r.committeeName,
      publicationDate: r.publicationDate,
    }));
  }

  const issue = POLITICAL_ISSUES.find(i => i.id === selection.issueId);
  if (!issue || issue.keywords.length === 0) return [];

  const where = issue.keywords.map(() => 'title LIKE ?').join(' OR ');
  const params = issue.keywords.map(k => `%${k}%`);

  const rows = db
    .prepare(
      `SELECT id AS billId, status_id AS statusId, title, subtype,
              committee_name AS committeeName, publication_date AS publicationDate
       FROM bill WHERE ${where}`,
    )
    .all(...params) as Array<{
      billId: number; statusId: number; title: string;
      subtype: string | null; committeeName: string | null; publicationDate: string | null;
    }>;

  return rows.map(r => ({ ...r, matchesStance: null }));
}

interface AgendaVote {
  voteId: number;
  billId: number | null;
  title: string;
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
          `SELECT id AS voteId, bill_id AS billId, title, date
           FROM plenary_vote
           WHERE bill_id IN (${slice.map(() => '?').join(',')})`,
        )
        .all(...slice) as Array<{ voteId: number; billId: number; title: string; date: string }>;

      for (const r of rows) {
        found.set(r.voteId, { ...r, matchesStance: stanceByBill.get(r.billId) ?? null });
      }
    }
  }

  const issue = POLITICAL_ISSUES.find(i => i.id === selection.issueId);
  if (issue && issue.keywords.length > 0) {
    const where = issue.keywords.map(() => 'title LIKE ?').join(' OR ');
    const rows = db
      .prepare(`SELECT id AS voteId, bill_id AS billId, title, date FROM plenary_vote WHERE ${where}`)
      .all(...issue.keywords.map(k => `%${k}%`)) as Array<{ voteId: number; billId: number | null; title: string; date: string }>;

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
  /** פעילות נגד הכיוון שנבחר, למודל של היגד-היגד (computeStatementLeaders) */
  billsAgainst: number;
  billsAgainstRefs: AgendaBillRef[];
  opposingVotes: number;
  /** ההצבעות שנספרו, לפירוט */
  votes: AgendaVoteRef[];
}

function emptyTally(): MkTally {
  return {
    billsInitiated: 0,
    billsAdvanced: 0,
    supportingVotes: 0,
    rebelVotes: 0,
    contradictedOwnBill: 0,
    bills: [],
    billsAgainst: 0,
    billsAgainstRefs: [],
    opposingVotes: 0,
    votes: [],
  };
}

/**
 * תמיכה בכיוון האג'נדה.
 *
 * נספרות רק הצבעות שהן בעד האג'נדה בפועל: בעד חוק שכיוונו תואם לעמדת
 * המשתמש, או נגד חוק שכיוונו מנוגד לה. שתיהן תמיכה באותה עמדה.
 *
 * הצבעה שכיוון החוק שלה אינו ידוע (אין סיווג) אינה נספרת כתמיכה — וגם
 * אינה נספרת במכנה. אחרת שיעור התמיכה היה יורד באג'נדות שהסיווג בהן
 * חלקי, והמדד היה מעניש ח"כים על פערים בנתונים במקום על התנהגות.
 */
function isSupportive(resultCode: number, matchesStance: boolean | null): boolean {
  if (matchesStance === null) return false;
  if (matchesStance) return resultCode === RESULT_FOR;
  return resultCode === RESULT_AGAINST;
}

/** המראה של isSupportive: בעד חוק מנוגד, או נגד חוק תואם */
function isOpposing(resultCode: number, matchesStance: boolean | null): boolean {
  if (matchesStance === null) return false;
  if (matchesStance) return resultCode === RESULT_AGAINST;
  return resultCode === RESULT_FOR;
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
  const titleByVote = new Map(votes.map(v => [v.voteId, v.title]));

  /** רושם הצבעה שנספרה (תומכת או מתנגדת) ברשימת הפירוט של הח"כ */
  const record = (t: MkTally, voteId: number, resultCode: number, supportive: boolean, majorityCode: number | null) => {
    t.votes.push({
      voteId,
      billId: billByVote.get(voteId) ?? null,
      title: titleByVote.get(voteId) ?? '',
      date: (dateByVote.get(voteId) ?? '').slice(0, 10),
      votedFor: resultCode === RESULT_FOR,
      supportive,
      withFaction: majorityCode === null ? null : resultCode === majorityCode,
    });
  };

  /** ההצבעה האחרונה שנשמרה לכל צמד חוק+ח"כ, כדי לנטרל הסתייגויות */
  const latestPerBillMk = new Map<string, { voteId: number; date: string; resultCode: number; majorityCode: number | null }>();
  const standalone: Array<{ mkId: number; voteId: number; resultCode: number; majorityCode: number | null }> = [];

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
        standalone.push({ mkId: r.mkId, voteId: r.voteId, resultCode: r.resultCode, majorityCode: r.majorityCode });
        continue;
      }

      const key = `${billId}|${r.mkId}`;
      const date = dateByVote.get(r.voteId) ?? '';
      const prev = latestPerBillMk.get(key);
      if (!prev || date > prev.date || (date === prev.date && r.voteId > prev.voteId)) {
        latestPerBillMk.set(key, { voteId: r.voteId, date, resultCode: r.resultCode, majorityCode: r.majorityCode });
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
      record(t, v.voteId, v.resultCode, true, v.majorityCode);
    } else if (isOpposing(v.resultCode, stanceByVote.get(v.voteId) ?? null)) {
      t.opposingVotes += 1;
      record(t, v.voteId, v.resultCode, false, v.majorityCode);
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
      record(t, s.voteId, s.resultCode, true, s.majorityCode);
    } else if (isOpposing(s.resultCode, stanceByVote.get(s.voteId) ?? null)) {
      t.opposingVotes += 1;
      record(t, s.voteId, s.resultCode, false, s.majorityCode);
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
  /** סיים את כהונתו לפני תום הכנסת ה-25 */
  isFormer: boolean;
  /** התאריך האחרון שבו כיהן, YYYY-MM-DD. null אצל מכהנים. */
  tenureEnd: string | null;
  /** סך ימי הכהונה, לנרמול היוזמה */
  tenureDays: number;
  tenure: ReturnType<typeof parseTenure>;
}

/** סך הימים בכל מקטעי הכהונה */
function tenureDays(segments: ReturnType<typeof parseTenure>): number {
  let days = 0;
  for (const s of segments) {
    if (!s.startDate || !s.endDate) continue;
    const from = Date.parse(s.startDate);
    const to = Date.parse(s.endDate);
    if (Number.isNaN(from) || Number.isNaN(to) || to <= from) continue;
    days += (to - from) / 86_400_000;
  }
  return Math.round(days);
}

/**
 * כל ח"כי הכנסת ה-25, כולל 27 שסיימו את כהונתם.
 *
 * הסינון הקודם ל-is_current = 1 השמיט אותם לגמרי, ולכן גדי איזנקוט —
 * שכיהן שנתיים ושמונה חודשים, יזם חמש הצעות חוק שכולן מסווגות והשתתף
 * ב-2,769 הצבעות — לא הופיע כלל. האתר הוא כלי שקיפות על הכנסת ה-25
 * ולא רשימת המכהנים היום, ולכן מי שפעל בה שייך לתמונה.
 *
 * הם מסומנים isFormer עם תאריך הסיום, כדי שהתצוגה תאמר "כיהן עד
 * 7.2025" ולא תיצור רושם שאפשר לפנות אליהם היום.
 */
function loadCurrentMks(db: Database.Database): Map<number, MkMeta> {
  const rows = db
    .prepare(
      `SELECT person_id AS mkId, first_name AS firstName, last_name AS lastName,
              faction_name AS faction, slug, is_coalition AS isCoalition,
              is_current AS isCurrent, segments
       FROM mk_person`,
    )
    .all() as Array<{
      mkId: number; firstName: string; lastName: string;
      faction: string | null; slug: string | null; isCoalition: number;
      isCurrent: number; segments: string | null;
    }>;

  const ministers = loadMinisters(db);

  /**
   * תאריך סיום הכהונה, מ-mk_position ולא מ-segments.
   *
   * segments.endDate מתמלא בתאריך הסנכרון האחרון אצל כולם, ולכן כל 27
   * הפורשים הוצגו כאילו סיימו באותו יום. mk_position.finish_date נושא
   * את התאריך האמיתי: איזנקוט 4.7.2025, דנון 30.6.2024.
   */
  const endDates = new Map<number, string>(
    (
      db
        .prepare(
          `SELECT mk_id AS mkId, MAX(finish_date) AS finishDate
           FROM mk_position
           WHERE finish_date IS NOT NULL
           GROUP BY mk_id`,
        )
        .all() as Array<{ mkId: number; finishDate: string }>
    ).map(r => [r.mkId, r.finishDate.slice(0, 10)]),
  );

  return new Map(
    rows.map(r => {
      const tenure = parseTenure(r.segments);
      const isFormer = r.isCurrent !== 1;
      const lastDate = endDates.get(r.mkId) ?? null;

      /**
       * חיתוך מקטעי הכהונה בתאריך הפרישה האמיתי.
       *
       * segments.endDate מתמלא בתאריך הסנכרון, ולכן countVotesDuringTenure
       * זקף לאיזנקוט הזדמנויות הצבעה משמונה חודשים אחרי שפרש — והוריד
       * את שיעור התמיכה שלו על הצבעות שלא היה יכול להשתתף בהן.
       */
      const effective =
        isFormer && lastDate
          ? tenure
              .filter(s => !s.startDate || s.startDate <= lastDate)
              .map(s => ({
                ...s,
                endDate: s.endDate && s.endDate > lastDate ? lastDate : s.endDate,
              }))
          : tenure;

      return [
        r.mkId,
        {
          mkId: r.mkId,
          name: `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim(),
          faction: r.faction,
          slug: r.slug,
          isCoalition: r.isCoalition === 1,
          isMinister: ministers.has(r.mkId),
          isFormer,
          tenureEnd: isFormer ? lastDate : null,
          tenureDays: tenureDays(effective),
          tenure: effective,
        },
      ];
    }),
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

      /**
       * האם ידוע לאיזה כיוון כל חוק דוחף. בלי זה אפשר למדוד פעילות
       * בנושא, אבל אי אפשר לומר "עובד למענך" — כי חוק בעד וחוק נגד
       * יושבים באותה אג'נדה ונראים זהים.
       */
      const stanceAware = bills.some(b => b.matchesStance !== null);

      const initiatorsByBill = tallyBills(
        db, bills, tallies, opts.countOnlyAdvancedBills === true, stanceAware,
      );
      tallyVotes(db, votes, tallies, initiatorsByBill);

      /**
       * רק הצבעות שכיוון החוק שלהן ידוע נכנסות למכנה. הצבעה שאי אפשר
       * לדעת אם היא בעד או נגד האג'נדה אינה הזדמנות שהוחמצה — היא פער
       * בנתונים, ואסור שתיזקף לחובת הח"כ.
       */
      const stanceKnownDates = votes.filter(v => v.matchesStance !== null).map(v => v.date);

      /** בלי אף הצבעה מסווגת אין רכיב הצבעות כלל, והציון נשען על החקיקה בלבד */
      const votingAvailable = stanceKnownDates.length > 0;

      // קבוצת הדירוג: רק מי שעשה משהו באג'נדה. ראו מלכודת 1 בראש הקובץ
      const active = [...tallies.entries()].filter(
        ([, t]) => t.billsInitiated > 0 || t.supportingVotes > 0,
      );

      /**
       * היוזמה מנורמלת לקצב ולא נספרת במוחלט.
       *
       * רכיב ההצבעות כבר היה מנורמל — supportingVotes חלקי ההזדמנויות
       * שהיו בזמן הכהונה. היוזמה לא הייתה, ולכן מי שכיהן שנתיים התחרה
       * במי שכיהן ארבע על ספירה גולמית ונענש על הפרישה ולא על חוסר
       * פעילות. איזנקוט, עם חמש הצעות מסווגות, דורג במקום 114 מ-138.
       *
       * הרצפה של 90 יום מונעת התפוצצות: מי שכיהן שבועיים ויזם הצעה אחת
       * היה מקבל קצב אסטרונומי ומדלג לראש הדירוג.
       */
      const initiativeRate = (mkId: number, bills: number) =>
        bills / Math.max(mks.get(mkId)!.tenureDays, MIN_TENURE_DAYS);

      const billValues = active.map(([mkId, t]) => initiativeRate(mkId, t.billsInitiated));
      const rateValues = active.map(([mkId, t]) => {
        const opportunities = countVotesDuringTenure(stanceKnownDates, mks.get(mkId)!.tenure);
        return opportunities > 0 ? t.supportingVotes / opportunities : 0;
      });

      for (const [mkId, tally] of active) {
        const meta = mks.get(mkId)!;
        const opportunities = countVotesDuringTenure(stanceKnownDates, meta.tenure);
        const rate = opportunities > 0 ? tally.supportingVotes / opportunities : 0;

        const pInitiative = percentileAmongActive(
          billValues,
          initiativeRate(mkId, tally.billsInitiated),
        );
        const pVoting = votingAvailable ? percentileAmongActive(rateValues, rate) : 0;

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
          votingAvailable,
          stanceAware,
          /**
           * כשאין הצבעות מסווגות, רכיב ההצבעות אינו קיים — לא אפס.
           * שקלול ב-0.6 היה מוריד לכולם 40 נקודות ומשדר "פעילות נמוכה"
           * במקום "אין נתונים", לכן החקיקה נושאת את מלוא המשקל.
           */
          score: round1(
            votingAvailable
              ? WEIGHT_INITIATIVE * pInitiative + WEIGHT_VOTING * pVoting
              : pInitiative,
          ),
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
        votesWithStance: stanceKnownDates.length,
        stanceAware,
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

      /**
       * נספרות פעולות שהח"כ עשה בפועל, ולא הזדמנויות שעמדו בפניו.
       *
       * הניסיון הראשון חיבר voteOpportunities, שהוא מספר ההצבעות
       * שהתקיימו בזמן כהונתו — 60 עד 95 לכל ח"כ, וכתוצאה מכך הביטחון
       * הראה 100% אצל כולם ולא הבחין בין כלום.
       *
       * יוזמה והצבעה תומכת נספרות שווה: שתיהן אירוע מתועד אחד. זה שונה
       * ממשקלן בציון (60/40), ובכוונה — המשקל שואל כמה כל אות מלמד,
       * המניין שואל כמה חומר עמד מאחורי החישוב.
       */
      const evidenceCount = perAgenda.reduce(
        (s, a) => s + a.billsInitiated + a.supportingVotes,
        0,
      );

      rows.push({
        mkId,
        name: meta.name,
        faction: meta.faction,
        slug: meta.slug,
        isCoalition: meta.isCoalition,
        isMinister: meta.isMinister,
        isFormer: meta.isFormer,
        tenureEnd: meta.tenureEnd,
        overallScore: round1(sum / selections.length),
        evidenceCount,
        confidencePercent: confidenceFromEvidence(evidenceCount),
        perAgenda: perAgenda.sort((a, b) => b.score - a.score),
      });
    }

    rows.sort((a, b) => b.overallScore - a.overallScore);

    return { rows, coverage, generatedAt: Date.now() };
  } finally {
    db.close();
  }
}

/**
 * מי היה יו"ר הוועדה בתאריך נתון. בלי תאריך: היו"ר האחרון של הוועדה
 * (9 מ-18 הצעות הוועדה בכנסת הזאת הן בלי תאריך פרסום במאגר).
 */
function committeeChairAt(db: Database.Database, committeeName: string, date: string | null): number | null {
  const base = `SELECT mk_id AS mkId FROM mk_position WHERE committee = ? AND duty_desc LIKE 'יו"ר%'`;
  if (date) {
    const row = db
      .prepare(`${base} AND start_date <= ? AND (finish_date IS NULL OR finish_date >= ?) ORDER BY start_date DESC LIMIT 1`)
      .get(committeeName, date, date) as { mkId: number } | undefined;
    if (row) return row.mkId;
  }
  const last = db.prepare(`${base} ORDER BY start_date DESC LIMIT 1`).get(committeeName) as { mkId: number } | undefined;
  return last?.mkId ?? null;
}

/**
 * ספירת הצעות החוק לכל ח"כ, ומיפוי היוזמים לכל חוק לצורך דגל הסתירה.
 *
 * מי מקבל קרדיט: היוזמים החתומים (bill_initiator), ולהצעת ועדה גם יו"ר
 * הוועדה שהגישה אותה, כי אין לה יוזם חתום. להצעה ממשלתית אין קרדיט יוזמה
 * לאף אחד: במאגר אין מי במשרד יזם אותה (היא נספרת בהצבעות ובסך ההיגד).
 */
function tallyBills(
  db: Database.Database,
  bills: AgendaBill[],
  tallies: Map<number, MkTally>,
  onlyAdvanced: boolean,
  stanceAware: boolean,
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

  const credits: Array<{ billId: number; mkId: number; viaChair: boolean }> = [];
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    const rows = db
      .prepare(
        `SELECT bill_id AS billId, mk_id AS mkId FROM bill_initiator
         WHERE bill_id IN (${slice.map(() => '?').join(',')})`,
      )
      .all(...slice) as Array<{ billId: number; mkId: number }>;
    for (const r of rows) credits.push({ ...r, viaChair: false });
  }
  const chairCache = new Map<string, number | null>();
  for (const bill of bills) {
    if (bill.subtype !== SUBTYPE_COMMITTEE || !bill.committeeName) continue;
    const key = `${bill.committeeName}|${bill.publicationDate ?? ''}`;
    if (!chairCache.has(key)) chairCache.set(key, committeeChairAt(db, bill.committeeName, bill.publicationDate));
    const chair = chairCache.get(key);
    if (chair !== null && chair !== undefined) credits.push({ billId: bill.billId, mkId: chair, viaChair: true });
  }

  for (const r of credits) {
    let set = initiatorsByBill.get(r.billId);
    if (!set) initiatorsByBill.set(r.billId, (set = new Set()));
    set.add(r.mkId);

    const tally = tallies.get(r.mkId);
    const bill = byId.get(r.billId);
    if (!tally || !bill) continue;

    const ref = (advanced: boolean): AgendaBillRef => ({
      billId: bill.billId,
      title: bill.title,
      statusId: bill.statusId,
      advanced,
      passed: bill.statusId === STATUS_BECAME_LAW,
      ...(billKind(bill.subtype) ? { kind: billKind(bill.subtype) } : {}),
      ...(r.viaChair ? { viaChair: true } : {}),
    });

    /**
     * כשיש נתוני עמדה, נספרות רק הצעות שדוחפות לכיוון שהמשתמש בחר.
     * ח"כ שיזם עשרה חוקים להרחבת הפטור מגיוס אינו "עובד למען" משתמש
     * שתומך בגיוס, גם אם שני הדברים יושבים באותה אג'נדה.
     *
     * היוזם נרשם ב-initiatorsByBill עוד לפני הסינון, כי דגל הסתירה
     * צריך לזהות הצבעה נגד חוק שהח"כ יזם, בלי קשר לכיוונו.
     */
    if (stanceAware && bill.matchesStance !== true) {
      /**
       * הצעה לצד השני נספרת בנפרד ולא נזרקת. הצעה שכיוונה לא ידוע
       * (null) לא נספרת לאף צד.
       */
      if (bill.matchesStance === false) {
        tally.billsAgainst += 1;
        tally.billsAgainstRefs.push(ref(billAdvanced(bill.statusId, reachedPlenary.has(r.billId))));
      }
      continue;
    }

    const advanced = billAdvanced(bill.statusId, reachedPlenary.has(r.billId));
    if (advanced) tally.billsAdvanced += 1;
    if (!onlyAdvanced || advanced) {
      tally.billsInitiated += 1;
      tally.bills.push(ref(advanced));
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

/**
 * עקומת ביטחון: 15 ראיות ≈ 63%, 30 ≈ 86%, 45 ≈ 95%.
 *
 * היעד הוא 15 ולא 30 משום שהטקסונומיה גדלה מ-12 סוגיות רחבות ל-166
 * צירים צרים. שאלה צרה מייצרת פחות ראיות לכל ח"כ, ועם היעד הישן כמעט
 * כל תוצאה הייתה נקראת "לא בטוחה" — קריאה מטעה של דירוג שנשען על
 * ראיות מוצקות.
 */
function confidenceFromEvidence(evidenceCount: number): number {
  if (evidenceCount <= 0) return 0;
  return Math.round((1 - Math.exp(-evidenceCount / 15)) * 100);
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  מודל "לכל היגד": מי דחף הכי הרבה בכיוון שבחרת, בלי ממוצע בין היגדים
 *
 *  ראו PROPOSAL-STATEMENT-SCORE.md. לכל ח"כ בהיגד סופרים דחיפה בעד ודחיפה
 *  נגד, בנקודות:
 *    הצעת חוק שיזם: הוגשה 1, עברה טרומית 2, הפכה לחוק 4
 *    הצבעה: עם רוב הסיעה 0.25, נגד רוב הסיעה 1
 *  כל פריט נספר לצד שאליו הוא דוחף בפועל (הצבעה נגד הצעה לכיוון השני
 *  היא דחיפה בעד). ציון = 100 · נטו ÷ נטו של המוביל בהיגד. עקביות =
 *  בעד ÷ (בעד + נגד). אין ממוצע, אין אחוזון, אין "ביטחון".
 * ═══════════════════════════════════════════════════════════════════════════ */

export const PUSH_WEIGHTS = {
  billFiled: 1,
  billAdvanced: 2,
  billLaw: 4,
  voteWithFaction: 0.25,
  voteAgainstFaction: 1,
} as const;

export interface StatementLeader {
  mkId: number;
  name: string;
  faction: string | null;
  slug: string | null;
  isCoalition: boolean;
  isMinister: boolean;
  isFormer: boolean;
  tenureEnd: string | null;
  /** מקום בהיגד, 1 = המוביל */
  rank: number;
  /** 0 עד 100, ביחס למוביל בהיגד */
  score: number;
  /** 0 עד 100, בעד ÷ (בעד + נגד) */
  consistency: number;
  pushFor: number;
  pushAgainst: number;
  /** ספירות, להסבר במילים */
  billsFor: { filed: number; advanced: number; law: number };
  billsAgainst: { filed: number; advanced: number; law: number };
  votesFor: { withFaction: number; againstFaction: number };
  votesAgainst: { withFaction: number; againstFaction: number };
  bills: AgendaBillRef[];
  billsAgainstRefs: AgendaBillRef[];
  votes: AgendaVoteRef[];
}

export interface StatementResult {
  issueId: string;
  label: string;
  /** נוסח שני הצדדים, מהקטלוג: הצד שנבחר והצד השני */
  yourSide: string | null;
  otherSide: string | null;
  billCount: number;
  /** מתוך billCount: כמה הצעות בכיוון שנבחר וכמה לכיוון השני (השאר בלי כיוון ידוע) */
  billsYourSide: number;
  billsOtherSide: number;
  /** מתוך הנ"ל: כמה הצעות ממשלתיות, וכמה מהן הפכו לחוק. נספרות בסך ובהצבעות, לא ביוזמה */
  govYourSide: { bills: number; laws: number };
  govOtherSide: { bills: number; laws: number };
  voteCount: number;
  /** כמה ח"כים דחפו נטו בכיוון שנבחר */
  activeMks: number;
  /** הנטו של המוביל, הבסיס ל-100 */
  leaderNet: number;
  /** עשרת הראשונים, ועוד חמישה ראשונים מכל מחנה אם אינם שם כבר */
  leaders: StatementLeader[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function billStageWeight(b: AgendaBillRef): number {
  if (b.passed) return PUSH_WEIGHTS.billLaw;
  if (b.advanced) return PUSH_WEIGHTS.billAdvanced;
  return PUSH_WEIGHTS.billFiled;
}

function voteWeight(v: AgendaVoteRef): number {
  return v.withFaction === false ? PUSH_WEIGHTS.voteAgainstFaction : PUSH_WEIGHTS.voteWithFaction;
}

function stageCounts(bills: AgendaBillRef[]) {
  return {
    filed: bills.filter(b => !b.advanced && !b.passed).length,
    advanced: bills.filter(b => b.advanced && !b.passed).length,
    law: bills.filter(b => b.passed).length,
  };
}

function factionCounts(votes: AgendaVoteRef[]) {
  return {
    withFaction: votes.filter(v => v.withFaction !== false).length,
    againstFaction: votes.filter(v => v.withFaction === false).length,
  };
}

/** כמה מהמדורגים נשלחים לכרטיס ההיגד. המסך מציג שלושה; השאר רזרבה לשינויי תצוגה */
const DISPLAY_LEADERS = 10;

/**
 * מי מוצג בכרטיס ההיגד: הראשונים לפי מקום. הקלט ממוין לפי מקום. משמש גם
 * את ה-API כשהוא מחשב עם הרשימה המלאה ואז מצמצם לתצוגה.
 */
export function pickDisplayLeaders<T extends { rank: number }>(ranked: T[]): T[] {
  return ranked.slice(0, DISPLAY_LEADERS);
}

/** שורה בסיכום לאורך ההיגדים: ח"כ, הציון בכל היגד, והמספרים שקובעים את הסדר */
export interface CrossStatementRow {
  mkId: number;
  name: string;
  faction: string | null;
  slug: string | null;
  isCoalition: boolean;
  isMinister: boolean;
  isFormer: boolean;
  tenureEnd: string | null;
  /** הציון (0 עד 100, כמו בכרטיס) לכל היגד לפי issueId; היגד שלא מופיע = 0 */
  cells: Record<string, number>;
  /** בכמה מההיגדים הנספרים יש פעילות בכיוון שנבחר */
  active: number;
  /** חציון הציונים על כל ההיגדים הנספרים */
  median: number;
  /** סך נקודות הנטו על כל ההיגדים, לשבירת שוויון */
  total: number;
  /** מקום בסיכום, 1 = הראשון */
  rank: number;
}

export interface CrossStatementSummary {
  /** כמה היגדים נספרים: אלה שיש בהם לפחות פעילות אחת בכיוון שנבחר */
  statementCount: number;
  /** כמה היגדים עם פעילות צריך כדי להיכנס: חצי, מעוגל למעלה */
  minActive: number;
  /** העשירייה הראשונה בסיכום (1 עד 3 הם הפודיום) */
  rows: CrossStatementRow[];
}

function medianOf(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * סיכום לאורך ההיגדים: מי פעל בכיוון שנבחר כמעט בכל מקום.
 *
 * למה לא ממוצע ולא סכום: 100 בהיגד קטן שווה הצעה אחת, ו-100 בהיגד גדול
 * שווה עשרות נקודות. ממוצע של ציונים יחסיים נותן להיגדים הקטנים לשלוט,
 * וסכום נקודות גולמי נותן להיגד הגדול לשלוט (סיעה שלמה שחותמת זו לזו).
 * לכן: סף נוכחות (פעילות בלפחות חצי מההיגדים), ואז חציון, שהיגד חריג
 * אחד לא מרים ולא מפיל. שובר שוויון: סך הנקודות.
 *
 * דורש תוצאות עם הרשימה המלאה (computeStatementLeaders עם limit: Infinity),
 * אחרת מי שמחוץ לעשירייה בהיגד ייחשב כמי שלא פעל בו.
 */
export function summarizeAcrossStatements(results: StatementResult[], limit = 10): CrossStatementSummary {
  const counted = results.filter(st => st.leaderNet > 0);
  const S = counted.length;
  const minActive = Math.ceil(S / 2);
  const rows = new Map<number, CrossStatementRow>();
  for (const st of counted) {
    for (const l of st.leaders) {
      let r = rows.get(l.mkId);
      if (!r) {
        r = { mkId: l.mkId, name: l.name, faction: l.faction, slug: l.slug, isCoalition: l.isCoalition, isMinister: l.isMinister, isFormer: l.isFormer, tenureEnd: l.tenureEnd, cells: {}, active: 0, median: 0, total: 0, rank: 0 };
        rows.set(l.mkId, r);
      }
      // ברשימה נמצאים רק מי שדחפו נטו בכיוון שנבחר, ולכן נוכחות = פעילות
      r.cells[st.issueId] = l.score;
      r.active += 1;
      r.total += Math.max(0, l.pushFor - l.pushAgainst);
    }
  }
  const ranked = [...rows.values()]
    .filter(r => S >= 2 && r.active >= minActive)
    .map(r => ({ ...r, median: round2(medianOf(counted.map(st => r.cells[st.issueId] ?? 0))), total: round2(r.total) }))
    .sort((a, b) => b.median - a.median || b.total - a.total || a.name.localeCompare(b.name, 'he'))
    .map((r, i) => ({ ...r, rank: i + 1 }));
  return { statementCount: S, minActive, rows: ranked.slice(0, limit) };
}

/**
 * opts.limit: כמה מהמדורגים להחזיר לכל היגד. בלי זה: 10 הראשונים ועוד 5
 * הראשונים בכל מחנה (מה שהמסך מציג). Infinity מחזיר את כולם, לניסויים
 * של צבירה בין היגדים (scripts, לא ה-API).
 */
export function computeStatementLeaders(selections: AgendaSelection[], opts: { limit?: number } = {}): StatementResult[] {
  if (selections.length === 0 || !fs.existsSync(DB_PATH)) return [];
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const useClassification = hasClassification(db);
    const mks = loadCurrentMks(db);
    const out: StatementResult[] = [];

    for (const selection of selections) {
      const issue = POLITICAL_ISSUES.find(i => i.id === selection.issueId);
      if (!issue) continue;
      const bills = loadAgendaBills(db, selection, useClassification);
      const votes = loadAgendaVotes(db, selection, bills);
      const tallies = new Map<number, MkTally>();
      for (const mkId of mks.keys()) tallies.set(mkId, emptyTally());
      const stanceAware = bills.some(b => b.matchesStance !== null);
      const initiatorsByBill = tallyBills(db, bills, tallies, false, stanceAware);
      tallyVotes(db, votes, tallies, initiatorsByBill);

      const statusByBill = new Map(bills.map(b => [b.billId, b.statusId]));
      const govBills = new Set(bills.filter(b => b.subtype === SUBTYPE_GOVERNMENT).map(b => b.billId));
      const govCount = (side: boolean) => {
        const g = bills.filter(b => b.matchesStance === side && govBills.has(b.billId));
        return { bills: g.length, laws: g.filter(b => b.statusId === STATUS_BECAME_LAW).length };
      };
      const scored = [...tallies.entries()]
        .map(([mkId, t]) => {
          const votesFor = t.votes.filter(v => v.supportive);
          const votesAgainst = t.votes.filter(v => !v.supportive);
          const pushFor = t.bills.reduce((s, b) => s + billStageWeight(b), 0) + votesFor.reduce((s, v) => s + voteWeight(v), 0);
          const pushAgainst = t.billsAgainstRefs.reduce((s, b) => s + billStageWeight(b), 0) + votesAgainst.reduce((s, v) => s + voteWeight(v), 0);
          return { mkId, t, pushFor, pushAgainst, net: Math.max(0, pushFor - pushAgainst), votesFor, votesAgainst };
        })
        /**
         * לרשימה נכנס רק מי שדחף נטו בכיוון שנבחר. מי שפעל רק לכיוון השני
         * אינו "אחרי המוביל", והוא היה ממלא את "עוד X" באנשים עם ציון 0.
         */
        .filter(x => x.net > 0)
        .sort((a, b) => b.net - a.net || b.pushFor - a.pushFor);

      const leaderNet = scored[0]?.net ?? 0;
      const ranked = scored.map((x, i) => ({ ...x, rank: i + 1 }));
      const shown = opts.limit !== undefined ? ranked.slice(0, opts.limit) : pickDisplayLeaders(ranked);

      const sortRefs = (refs: AgendaBillRef[]) =>
        [...refs].sort((x, y) => Number(y.passed) - Number(x.passed) || Number(y.advanced) - Number(x.advanced)).slice(0, MAX_BILL_REFS);

      const leaders: StatementLeader[] = [...shown]
        .sort((a, b) => a.rank - b.rank)
        .map(x => {
          const m = mks.get(x.mkId)!;
          return {
            mkId: x.mkId,
            name: m.name,
            faction: m.faction,
            slug: m.slug,
            isCoalition: m.isCoalition,
            isMinister: m.isMinister,
            isFormer: m.isFormer,
            tenureEnd: m.tenureEnd,
            rank: x.rank,
            score: leaderNet > 0 ? Math.round((100 * x.net) / leaderNet) : 0,
            consistency: Math.round((100 * x.pushFor) / (x.pushFor + x.pushAgainst)),
            // שתי ספרות ולא אחת: התצוגה מראה את החיבור (1 + 1.75), והוא חייב לצאת מדויק
            pushFor: round2(x.pushFor),
            pushAgainst: round2(x.pushAgainst),
            billsFor: stageCounts(x.t.bills),
            billsAgainst: stageCounts(x.t.billsAgainstRefs),
            votesFor: factionCounts(x.votesFor),
            votesAgainst: factionCounts(x.votesAgainst),
            bills: sortRefs(x.t.bills),
            billsAgainstRefs: sortRefs(x.t.billsAgainstRefs),
            votes: [...x.t.votes]
              .map(v => ({
                ...v,
                statusId: v.billId !== null ? statusByBill.get(v.billId) ?? null : null,
                ...(v.billId !== null && govBills.has(v.billId) ? { government: true } : {}),
              }))
              .sort((a, b) => b.date.localeCompare(a.date))
              .slice(0, MAX_BILL_REFS),
          };
        });

      const chosen = issue.stances.find(st => st.id === selection.stanceId) ?? null;
      const other = issue.stances.find(st => st.id !== selection.stanceId) ?? null;
      out.push({
        issueId: issue.id,
        label: issue.label,
        yourSide: chosen?.label ?? null,
        otherSide: other?.label ?? null,
        billCount: bills.length,
        billsYourSide: bills.filter(b => b.matchesStance === true).length,
        billsOtherSide: bills.filter(b => b.matchesStance === false).length,
        govYourSide: govCount(true),
        govOtherSide: govCount(false),
        voteCount: votes.length,
        activeMks: scored.filter(x => x.net > 0).length,
        leaderNet: round2(leaderNet),
        leaders,
      });
    }
    return out;
  } finally {
    db.close();
  }
}
