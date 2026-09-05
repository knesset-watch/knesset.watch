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
