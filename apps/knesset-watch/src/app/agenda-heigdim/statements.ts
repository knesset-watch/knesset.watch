import { CLUSTERS } from '@/lib/axis-clusters';

/**
 * 20 ההיגדים של מסך הבדיקה.
 *
 * כאן יושבים רק המזהים. הטקסט עצמו נקרא מ-axis-clusters, שהוא מקור
 * האמת — קודם הוא היה מועתק לכאן, וזה בדיוק סוג ההעתקה ששברה את
 * ax_06d92ed369: השאלה עודכנה במקום אחד והעמדות נשארו במקום אחר.
 *
 * הצירים נבחרו לפי מספר ההצעות המסווגות אליהם, עד שלושה מכל נושא-על,
 * וכולם מעל MIN_BILLS_FOR_RANKING (15) — כלומר כל היגד מחזיר דירוג
 * אמיתי. בודקת שתקבל "אין מספיק נתונים" תדווח על באג ולא על הפורמט.
 */
const IDS = [
  'ax_c42d493519', 'ax_e561318477', 'ax_f45e15cfd2',
  'ax_61328bcf79', 'ax_06d92ed369', 'ax_9fa1f94760',
  'ax_c6c000cb74', 'ax_91aaa85ddc',
  'ax_33b60d006c', 'ax_18cd3cf6b7', 'ax_249e8b5c65',
  'ax_cc00cc9cee', 'ax_f50c7dcbe8', 'ax_fc07729532',
  'ax_c872a26cc2', 'ax_0058b4ed35',
  'ax_0e11f41d36', 'ax_db09a9979a', 'ax_e79797cfaf',
  'ax_0a2ba5871e',
];

export interface Statement {
  issueId: string;
  text: string;
  topic: string;
  billCount: number;
}

/** מסכים → _pro, לא מסכים → _con. אותו מבנה שהמנוע מקבל היום. */
export type Answer = 'pro' | 'con' | 'none';

export function stanceIdFor(issueId: string, answer: Answer): string | null {
  if (answer === 'none') return null;
  return `${issueId}_${answer}`;
}

const FROM_CLUSTERS = new Map<string, Statement>(
  CLUSTERS.flatMap(c =>
    c.questions.map(q => [
      q.issueId,
      { issueId: q.issueId, text: q.question, topic: c.topic, billCount: q.billCount },
    ] as [string, Statement]),
  ),
);

/**
 * ציר שנעלם מהאשכולות מדולג ולא מוצג ריק. זה יכול לקרות אם חילוץ
 * הצירים ירוץ מחדש והמזהים ישתנו — אותה התנהגות כמו ב-axis-clusters.
 */
export const STATEMENTS: Statement[] = IDS.map(id => FROM_CLUSTERS.get(id)).filter(
  (s): s is Statement => Boolean(s),
);

/** סדר הצגה: נושא-על לפי הציר הגדול שבו, כדי שהפתיחה תהיה במה שיש עליו הכי הרבה חומר. */
export const BY_TOPIC: Array<{ topic: string; items: Statement[] }> = (() => {
  const map = new Map<string, Statement[]>();
  for (const s of STATEMENTS) {
    const arr = map.get(s.topic) ?? [];
    arr.push(s);
    map.set(s.topic, arr);
  }
  return [...map.entries()]
    .map(([topic, items]) => ({ topic, items }))
    .sort(
      (a, b) =>
        Math.max(...b.items.map(i => i.billCount)) - Math.max(...a.items.map(i => i.billCount)),
    );
})();
