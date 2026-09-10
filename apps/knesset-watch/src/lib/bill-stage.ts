/**
 * שלב הצעת החוק בהליך, לתצוגה.
 *
 * מודול נפרד מ-knesset-db בכוונה: הוא מייבא better-sqlite3, שהוא
 * מודול צד-שרת, וייבוא שלו לרכיב 'use client' שובר את הבנייה עם
 * "Module not found: Can't resolve 'fs'". כאן אין תלות בכלום.
 *
 * status_desc ריק בכל 7,296 השורות, ולכן הכל נגזר מ-status_id.
 */

/** התקבלה בקריאה שלישית */
const STATUS_BECAME_LAW = 118;

/** עברה לפחות קריאה טרומית */
const STATUS_PASSED_PRELIMINARY = [108, 141, 111, 113, 130, 114, 118, 122];

/** נעצרה. הסטטוס אינו מספר באיזה שלב. */
const STATUS_STOPPED = 177;

export type BillStageTone = 'passed' | 'advanced' | 'stopped' | 'pending';

export interface BillStage {
  label: string;
  tone: BillStageTone;
}

export function billStageLabel(statusId: number | null): BillStage {
  if (statusId === STATUS_BECAME_LAW) return { label: 'עבר בקריאה שלישית', tone: 'passed' };
  if (statusId !== null && STATUS_PASSED_PRELIMINARY.includes(statusId)) {
    return { label: 'עבר קריאה טרומית', tone: 'advanced' };
  }
  if (statusId === STATUS_STOPPED) return { label: 'נעצרה', tone: 'stopped' };
  return { label: 'הוגשה', tone: 'pending' };
}

// ── מסלול החוק, שלב אחר שלב ──────────────────────────────────────────────

export interface BillStep {
  label: string;
  /** האם ההצעה הגיעה לשלב הזה */
  reached: boolean;
  /** השלב שבו ההצעה עומדת כרגע */
  current: boolean;
}

/**
 * ארבעת שלבי החקיקה, נגזרים מ-status_id שמלא בכל 7,296 השורות.
 *
 * קודם עמד בעמוד החוק מסלול בן שלושה שלבים שנגזר מ-committee_name
 * ומ-is_passed בלבד, והשלב האחרון נקרא "עבר" — שם שקרא כהצהרה ולא
 * כשלב. בעיגולים הריקים הופיע מספר הסידור (1, 2, 3), שלא אמר דבר.
 *
 * הצעה שנעצרה (893 במסד) אינה "בדרך לשלב הבא", ולכן היא מסומנת בנפרד
 * ולא כשלב שטרם הושלם.
 */
export function billSteps(statusId: number | null, hasCommittee: boolean): BillStep[] {
  const passedPreliminary =
    statusId !== null && STATUS_PASSED_PRELIMINARY.includes(statusId);
  const becameLaw = statusId === STATUS_BECAME_LAW;

  const reached = [
    true,                                   // הוגשה — כל הצעה שקיימת עברה את זה
    passedPreliminary || becameLaw,         // קריאה טרומית
    hasCommittee || becameLaw,              // דיון בוועדה
    becameLaw,                              // קריאה שלישית
  ];

  const labels = ['הוגשה', 'קריאה טרומית', 'דיון בוועדה', 'קריאה שלישית'];
  const lastReached = reached.lastIndexOf(true);

  return labels.map((label, i) => ({
    label,
    reached: reached[i],
    current: i === lastReached && !becameLaw,
  }));
}

/** האם ההליך נעצר. הסטטוס אינו מספר באיזה שלב זה קרה. */
export function billStopped(statusId: number | null): boolean {
  return statusId === STATUS_STOPPED;
}
