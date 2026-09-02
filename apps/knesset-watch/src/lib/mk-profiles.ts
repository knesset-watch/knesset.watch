/**
 * תמונות ורקע של חברי כנסת.
 *
 * הנתונים מ-Wikidata, נשלפים מראש ל-mk-profiles.json על ידי
 * scripts/fetch-mk-profiles.ts. אין קריאת רשת בזמן ריצה.
 *
 * הכיסוי: 140 מתוך 147 ח"כים, מהם 139 עם תמונה, 133 עם עיסוק ו-119
 * עם השכלה. שבעת החסרים אינם מופיעים ב-Wikidata תחת הכנסת ה-25, או
 * ששמם שם שונה מכדי להתאים אוטומטית. הם פשוט יוצגו בלי תמונה ורקע.
 *
 * למה לא מהכנסת: ל-OData אין תמונות ואין ביוגרפיה באף אחת מ-48
 * הישויות, ואתר הכנסת הציבורי חסום ב-WAF שדורש JavaScript.
 */

import profilesData from './mk-profiles.json';

export interface MkProfile {
  personId: number;
  name: string;
  /** תמונה ממוזערת מ-Wikimedia Commons, ברישיון חופשי */
  photo: string | null;
  education: string[];
  occupations: string[];
  qid: string;
}

/**
 * מוסדות בגיל בית ספר, שאינם אומרים דבר על הרקע המקצועי.
 *
 * הרשימה מפורשת ולא דפוס כללי, כי "בית הספר" מופיע גם במוסדות
 * אקדמיים לגיטימיים ("בית הספר לניהול MIT סלואן"), וישיבות הן רקע
 * מהותי אצל ח"כים חרדים ולכן נשארות.
 */
const SCHOOL_LEVEL = new Set([
  'הגימנסיה העברית "הרצליה"',
  'תיכון צ\'לטנהם',
  'התיכון ליד האוניברסיטה',
  'בית הספר חביב',
  'אולפנת בני עקיבא אמנה',
]);

/**
 * תיקונים ידניים לח"כים ספציפיים, מעל מה שהגיע מ-Wikidata.
 *
 * להוספה: המפתח הוא person_id מ-mk_person. אפשר לדרוס השכלה, עיסוקים
 * או שניהם. מערך ריק מסתיר את השדה לגמרי.
 *
 * הערכים כאן שורדים הרצה מחדש של scripts/fetch-mk-profiles.ts, כי
 * הם חיים בקוד ולא ב-JSON.
 */
const OVERRIDES: Record<number, Partial<Pick<MkProfile, 'education' | 'occupations'>>> = {
  // יאיר לפיד. Wikidata מחזיר "שחקן" ו"סופר" ראשונים, שאינם מתארים
  // אותו. אין לו השכלה אקדמית, ולכן הרקע נשען על העיסוק בלבד.
  23594: { occupations: ['עיתונאי', 'מנחה טלוויזיה'] },

  // כך מוסיפים עוד:
  //   <person_id>: { occupations: [...] }   דריסת עיסוק
  //   <person_id>: { education: [] }        הסתרת השכלה
  //
  // ה-person_id מופיע ב-mk-profiles.json ליד כל שם.
};

const RAW: MkProfile[] = profilesData as MkProfile[];

const PROFILES: MkProfile[] = RAW.map(p => {
  const override = OVERRIDES[p.personId] ?? {};
  return {
    ...p,
    education: override.education ?? p.education.filter(e => !SCHOOL_LEVEL.has(e)),
    occupations: override.occupations ?? p.occupations,
  };
});

const BY_ID = new Map<number, MkProfile>(PROFILES.map(p => [p.personId, p]));

export function getMkProfile(personId: number): MkProfile | null {
  return BY_ID.get(personId) ?? null;
}

/**
 * שורת רקע קצרה לתצוגה לצד השם.
 *
 * "פוליטיקאי" מסונן החוצה — הוא נכון לכל ח"כ ולכן לא מוסיף מידע.
 * העיסוק קודם להשכלה כי הוא מזהה יותר, ומוצג מוסד לימודים אחד בלבד
 * כדי שהשורה תישאר קריאה בכרטיס צר.
 */
export function profileSummary(profile: MkProfile | null): string | null {
  if (!profile) return null;

  const occupations = profile.occupations.filter(o => o !== 'פוליטיקאי').slice(0, 2);
  const education = profile.education.slice(0, 1);

  const parts = [...occupations, ...education];
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function profileCount(): number {
  return PROFILES.length;
}
