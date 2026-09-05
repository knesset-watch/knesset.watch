/**
 * המבנה שעליו בנוי השאלון: נושא-על ← אשכול ← שאלות.
 *
 * שלוש גרסאות קדמו לזה וכל אחת נכשלה אחרת. הצגת כל השאלות בנושא נתנה
 * 62 עד 82 שאלות. צמצום לחמש שהמערכת בוחרת הסתיר את "לימודי ליבה" —
 * ומשתמשת שענתה על מה שכן הוצג קיבלה עמדה שאולי אינה שלה. ענן שטוח של
 * 166 תגיות הציף באותה מידה.
 *
 * מה שהיה חסר: התגיות עצמן הכפילו זו את זו. הן נגזרו כל אחת בנפרד,
 * ולכן אותו רעיון נכתב בכמה נוסחים — "קצבאות נכות", "אנשים עם מוגבלות",
 * "הנגשה ותמיכה לנכים" ו"ועדות רפואיות" הן נושא אחד. אחרי איחוד נשארו
 * 52 אשכולות, 5 עד 8 לכל נושא-על.
 *
 * כך אף שאלה אינה מוסתרת ואף מסך אינו מציף: המשתמשת בוחרת נושא, רואה
 * 5-8 אשכולות, בוחרת מהם, ועונה רק על השאלות שמתחת לבחירתה.
 */

import clusterData from '../../data/policy-analysis/axis-clusters.json';
import { getCanonicalIssue } from './canonical-agendas';

export interface ClusterQuestion {
  issueId: string;
  /** התגית לפני האיחוד — מוצגת ככותרת משנה לשאלה */
  keyword: string;
  question: string;
  subtopic: string;
  billCount: number;
  stances: Array<{ id: string; label: string }>;
}

export interface Cluster {
  clusterId: string;
  topic: string;
  label: string;
  questions: ClusterQuestion[];
  billCount: number;
}

export interface ClusterTopic {
  id: string;
  label: string;
  clusters: Cluster[];
  billCount: number;
  questionCount: number;
}

interface RawMember {
  issueId: string;
  originalKeyword: string;
  subtopic: string;
  question: string;
  billCount: number;
}

interface RawCluster {
  clusterId: string;
  topic: string;
  label: string;
  members: RawMember[];
  billCount: number;
}

/** מזהה יציב לנושא-על, שאינו תלוי בסדר או בתעתיק עברי */
function topicId(topic: string): string {
  let h = 0;
  for (let i = 0; i < topic.length; i++) h = (h * 31 + topic.charCodeAt(i)) | 0;
  return `tp_${(h >>> 0).toString(16).padStart(8, '0')}`;
}

const RAW = clusterData as RawCluster[];

export const CLUSTERS: Cluster[] = RAW.map(c => ({
  clusterId: c.clusterId,
  topic: c.topic,
  label: c.label,
  billCount: c.billCount,
  questions: c.members
    .map(m => {
      /**
       * העמדות חיות בקטלוג ולא בקובץ האשכולות. אשכול שאיבד את הציר שלו
       * מדולג ולא מוצג ריק — זה יכול לקרות אם חילוץ הצירים ירוץ מחדש
       * והמזהים ישתנו.
       */
      const issue = getCanonicalIssue(m.issueId);
      if (!issue) return null;
      return {
        issueId: m.issueId,
        keyword: m.originalKeyword,
        question: m.question,
        subtopic: m.subtopic,
        billCount: m.billCount,
        stances: issue.stances,
      } satisfies ClusterQuestion;
    })
    .filter((q): q is ClusterQuestion => q !== null)
    .sort((a, b) => b.billCount - a.billCount),
}))
  .filter(c => c.questions.length > 0)
  .sort((a, b) => b.billCount - a.billCount);

export const CLUSTER_TOPICS: ClusterTopic[] = (() => {
  const byTopic = new Map<string, Cluster[]>();

  for (const c of CLUSTERS) {
    if (!byTopic.has(c.topic)) byTopic.set(c.topic, []);
    byTopic.get(c.topic)!.push(c);
  }

  return [...byTopic.entries()]
    .map(([label, clusters]) => ({
      id: topicId(label),
      label,
      clusters,
      billCount: clusters.reduce((s, c) => s + c.billCount, 0),
      questionCount: clusters.reduce((s, c) => s + c.questions.length, 0),
    }))
    .sort((a, b) => b.billCount - a.billCount);
})();

const CLUSTER_BY_ID = new Map(CLUSTERS.map(c => [c.clusterId, c]));

export function getCluster(clusterId: string): Cluster | null {
  return CLUSTER_BY_ID.get(clusterId) ?? null;
}

export function clustersOfTopic(id: string): Cluster[] {
  return CLUSTER_TOPICS.find(t => t.id === id)?.clusters ?? [];
}

export const CLUSTER_STATS = {
  topics: CLUSTER_TOPICS.length,
  clusters: CLUSTERS.length,
  questions: CLUSTERS.reduce((s, c) => s + c.questions.length, 0),
};
