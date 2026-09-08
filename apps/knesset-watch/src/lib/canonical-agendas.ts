/**
 * הטקסונומיה החדשה לשאלון: 8 נושאי-על, 64 תתי-נושאים, 201 צירי מחלוקת.
 *
 * מודול נפרד ולא עריכה של agendas.ts, משתי סיבות: agendas.ts משרת גם
 * את /agendas ו-/api/agenda-votes הקיימים ואסור לשבור אותם, והוא קובץ
 * שזויה וארבל נוגעות בו — מודול נפרד מונע התנגשות מיזוג.
 *
 * המקור הוא axis-catalog.json, שנבנה על ידי scripts/build-bill-classification.ts
 * מתוך הטקסונומיה הקנונית של זויה וחילוץ הצירים. אין קריאת רשת ואין
 * גישה ל-DB בזמן ריצה — הקובץ נארז לתוך ה-bundle.
 *
 * למה ציר ולא תת-נושא הוא "השאלה": תת-נושא אינו מחלוקת אחת. "בתי ספר
 * וגיל הרך" מאגד 139 סוגיות שנחלקות למחלוקות נפרדות — תקצוב, אוטונומיה,
 * תנאי העסקה. שאלה אחת כיסתה 51% מהן, חמישה צירים כיסו 79%.
 */

import catalogData from '../../data/policy-analysis/axis-catalog.json';

export interface CanonicalStance {
  id: string;
  label: string;
}

export interface CanonicalIssue {
  /** מזהה הציר, יציב בין הרצות — נגזר מ-hash ולא ממונה רץ */
  id: string;
  topicId: string;
  topic: string;
  subtopic: string;
  question: string;
  stances: CanonicalStance[];
  /** כמה חוקים מסווגים לציר. משמש לסינון צירים דלילים. */
  billCount: number;
}

export interface CanonicalTopic {
  id: string;
  label: string;
  subtopics: string[];
  issueCount: number;
  billCount: number;
}

interface CatalogRow {
  issueId: string;
  topic: string;
  subtopic: string;
  axisIndex: number;
  question: string;
  stances: CanonicalStance[];
  billCount: number;
}

/**
 * מתחת לזה הציר נשען על מעט מדי חוקים מכדי לדרג בו. נמדד: 24 צירים
 * מתוך 201 נופלים מתחת לסף.
 */
const MIN_BILLS_PER_ISSUE = 5;

/** מזהה יציב לנושא-על, כדי שלא יהיה תלוי בסדר או בתעתיק עברי */
function topicId(topic: string): string {
  let h = 0;
  for (let i = 0; i < topic.length; i++) {
    h = (h * 31 + topic.charCodeAt(i)) | 0;
  }
  return `tp_${(h >>> 0).toString(16).padStart(8, '0')}`;
}

const RAW = catalogData as CatalogRow[];

export const CANONICAL_ISSUES: CanonicalIssue[] = RAW.filter(
  r => r.billCount >= MIN_BILLS_PER_ISSUE,
)
  .map(r => ({
    id: r.issueId,
    topicId: topicId(r.topic),
    topic: r.topic,
    subtopic: r.subtopic,
    question: r.question,
    stances: r.stances,
    billCount: r.billCount,
  }))
  .sort((a, b) => b.billCount - a.billCount);

export const CANONICAL_TOPICS: CanonicalTopic[] = (() => {
  const byTopic = new Map<string, CanonicalIssue[]>();

  for (const issue of CANONICAL_ISSUES) {
    if (!byTopic.has(issue.topic)) byTopic.set(issue.topic, []);
    byTopic.get(issue.topic)!.push(issue);
  }

  return [...byTopic.entries()]
    .map(([label, issues]) => ({
      id: topicId(label),
      label,
      subtopics: [...new Set(issues.map(i => i.subtopic))].sort(),
      issueCount: issues.length,
      billCount: issues.reduce((sum, i) => sum + i.billCount, 0),
    }))
    .sort((a, b) => b.issueCount - a.issueCount);
})();

const ISSUE_BY_ID = new Map(CANONICAL_ISSUES.map(i => [i.id, i]));

export function getCanonicalIssue(id: string): CanonicalIssue | null {
  return ISSUE_BY_ID.get(id) ?? null;
}

/**
 * הצירים של נושא-על, מקובצים לפי תת-נושא.
 *
 * הקיבוץ נדרש בתצוגה: נושא-על מחזיק 15-40 צירים, ורשימה שטוחה כזו
 * אינה קריאה. תת-הנושא משמש ככותרת ביניים ולא כשאלה בפני עצמה.
 */
export function issuesByTopic(id: string): Array<{ subtopic: string; issues: CanonicalIssue[] }> {
  const issues = CANONICAL_ISSUES.filter(i => i.topicId === id);
  const bySubtopic = new Map<string, CanonicalIssue[]>();

  for (const issue of issues) {
    if (!bySubtopic.has(issue.subtopic)) bySubtopic.set(issue.subtopic, []);
    bySubtopic.get(issue.subtopic)!.push(issue);
  }

  return [...bySubtopic.entries()]
    .map(([subtopic, list]) => ({ subtopic, issues: list }))
    .sort((a, b) => b.issues.length - a.issues.length);
}

/**
 * כמה שאלות מוצגות לכל נושא-על בשאלון.
 *
 * בלי התקרה הזו משתמש שבוחר שלושה נושאים מקבל 62 עד 82 שאלות, וזה
 * נטוש בפועל. חמש לנושא נותנות 15 לשלושה נושאים — אורך שאפשר לסיים.
 */
const QUESTIONS_PER_TOPIC = 5;

/** לכל היותר שאלה אחת מתת-נושא, עד שנגמרים תתי-הנושאים */
const MAX_PER_SUBTOPIC_FIRST_PASS = 1;

/**
 * השאלות שיוצגו בשאלון עבור נושא-על, מפוזרות על תתי-נושאים.
 *
 * הבחירה אינה פשוט "החמש עם הכי הרבה חוקים": חמש השאלות הגדולות
 * בנושא נוטות להגיע מאותו תת-נושא, וכולן נשמעות כמו וריאציות זו של זו
 * גם כשהנושא שונה. סבב ראשון לוקח שאלה אחת מכל תת-נושא לפי סדר עוצמה,
 * וסבבים נוספים משלימים רק אם נותר מקום.
 */
export function questionnaireIssues(
  topicId: string,
  limit = QUESTIONS_PER_TOPIC,
): CanonicalIssue[] {
  const groups = issuesByTopic(topicId).map(g => ({
    subtopic: g.subtopic,
    issues: [...g.issues].sort((a, b) => b.billCount - a.billCount),
  }));

  const picked: CanonicalIssue[] = [];
  let round = 0;

  while (picked.length < limit && round < 10) {
    let addedThisRound = false;

    for (const g of groups) {
      if (picked.length >= limit) break;
      const perSubtopic = round + MAX_PER_SUBTOPIC_FIRST_PASS;
      const taken = picked.filter(p => p.subtopic === g.subtopic).length;
      if (taken >= perSubtopic) continue;

      const next = g.issues[taken];
      if (!next) continue;

      picked.push(next);
      addedThisRound = true;
    }

    if (!addedThisRound) break;
    round++;
  }

  return picked.sort((a, b) => b.billCount - a.billCount);
}

export const CANONICAL_STATS = {
  topics: CANONICAL_TOPICS.length,
  issues: CANONICAL_ISSUES.length,
  issuesBeforeFilter: RAW.length,
  subtopics: new Set(CANONICAL_ISSUES.map(i => i.subtopic)).size,
};

/* ------------------------------------------------------------------ *
 * שכבת תאימות
 *
 * agenda-activity.ts, ה-route שלו ושני רכיבי התצוגה מצפים למבנה של
 * Domain ו-PoliticalIssue מ-agendas.ts. היצוא כאן נושא את אותם שמות
 * ואת אותה צורה, ולכן המעבר לטקסונומיה החדשה הוא החלפת שורת import
 * אחת בכל קובץ — בלי לגעת בלוגיקה ובלי לשבור את /agendas הקיים,
 * שממשיך לקרוא מ-agendas.ts.
 * ------------------------------------------------------------------ */

export interface Domain {
  id: string;
  label: string;
  description: string;
  keywords: string[];
}

export interface IssueStance {
  id: string;
  label: string;
}

export interface PoliticalIssue {
  id: string;
  domainId: string;
  label: string;
  description: string;
  keywords: string[];
  stances: IssueStance[];
}

export const DOMAINS: Domain[] = CANONICAL_TOPICS.map(t => ({
  id: t.id,
  label: t.label,
  description: `${t.issueCount} שאלות · ${t.billCount.toLocaleString()} הצעות חוק`,
  keywords: [],
}));

/**
 * keywords ריק בכוונה. הוא שימש כנפילה כשהסיווג היה חסר, ומזהה נושא
 * בלי כיוון — כלומר מחזיר מדד השתתפות במקום מדד עמדה. כל 166 הצירים
 * מכוסים ב-bill_political_classification, ולכן הנפילה מיותרת וגרועה
 * מאי-הצגה.
 */
export const POLITICAL_ISSUES: PoliticalIssue[] = CANONICAL_ISSUES.map(i => ({
  id: i.id,
  domainId: i.topicId,
  label: i.question,
  description: `${i.topic} ▸ ${i.subtopic}`,
  keywords: [],
  stances: i.stances,
}));
