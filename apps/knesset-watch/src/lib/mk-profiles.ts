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

const PROFILES: MkProfile[] = profilesData as MkProfile[];

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
