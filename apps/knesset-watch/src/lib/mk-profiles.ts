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
import backgroundData from './mk-backgrounds.json';

/**
 * רקע מוויקיפדיה העברית, שנשלף על ידי scripts/fetch-mk-backgrounds.ts.
 *
 * Wikidata לא מחזיקה את המידע הזה: P512 ו-P812 ריקים לח"כים ישראלים,
 * ולכן רק 6 מתוך 120 שורות השכלה כללו תואר בפועל ו-35 ח"כים היו בלי
 * עיסוק כלל. ויקיפדיה מחזיקה אותו, אך רק כפרוזה בגוף הערך.
 *
 * הוא גובר על Wikidata כשהשניים מתנגשים. ההשוואה מכריעה: לליברמן
 * Wikidata נותנת "שר · מנהל כללי", וויקיפדיה נותנת "מנכ״ל משרד ראש
 * הממשלה · מוציא לאור · איש עסקים".
 */
interface MkBackground {
  personId: number;
  occupations: string[];
  degrees: string[];
  priorRole: string | null;
  confidence: number;
}

const BACKGROUND_BY_ID = new Map<number, MkBackground>(
  (backgroundData as MkBackground[]).map(b => [b.personId, b]),
);

/** תפקידים בכירים, שראויים להופיע לפני תחנות מוקדמות בקריירה */
const SENIOR_PREFIX = /^(מנכ|סמנכ|יו|ראש|אלוף|תא"ל|שגריר|נשיא|משנה|מפקד|רב |עורך דין|רופא|פרופ)/;

/**
 * דירוג התפקידים מוויקיפדיה לפי משמעות.
 *
 * הערך כרונולוגי, ולכן חיתוך פשוט של שלושת הראשונים נתן לליברמן
 * "מזכיר הסניף הירושלמי של הסתדרות העובדים הלאומית" והשאיר את
 * "מנכ״ל משרד ראש הממשלה" ו"איש עסקים" בחוץ.
 *
 * שני סימנים: תואר בכיר בתחילת המחרוזת, ואורך — תיאור קצר הוא בדרך
 * כלל זהות מקצועית ("איש עסקים"), וארוך הוא תחנה היסטורית ספציפית.
 */
function occupationRank(entry: string): number {
  const senior = SENIOR_PREFIX.test(entry) ? 0 : 1;
  const lengthBand = entry.length <= 14 ? 0 : entry.length <= 28 ? 1 : 2;
  return senior * 3 + lengthBand;
}

/**
 * "מוסמך אוניברסיטת חיפה במדע המדינה, אוניברסיטת חיפה" — שם המוסד
 * מופיע פעמיים, כי החילוץ שתל אותו גם בתיאור התואר וגם אחרי הפסיק.
 */
function dedupeInstitution(degree: string): string {
  const comma = degree.lastIndexOf(', ');
  if (comma === -1) return degree;

  const head = degree.slice(0, comma);
  const institution = degree.slice(comma + 2).trim();

  return institution && head.includes(institution) ? head : degree;
}

export interface MkProfile {
  personId: number;
  name: string;
  /** תמונה ממוזערת מ-Wikimedia Commons, ברישיון חופשי */
  photo: string | null;
  education: string[];
  occupations: string[];
  /** השנה שבה נכנס לכנסת לראשונה, מכל קדנציה שהיא */
  sinceYear: number | null;
  /** תפקידים שמילא (P39 ב-Wikidata) */
  positions: string[];
  /** תפקיד בכיר נוכחי מ-mk_position, כתחליף לעיסוק חסר */
  role: string | null;
  qid: string;
}

/**
 * תפקידים פרלמנטריים פנימיים — אינם רקע תעסוקתי.
 *
 * ההבחנה: תפקיד שממלאים *בתוך* הכנסת נובע מעצם היותם חברי כנסת ואינו
 * מעיד על הכשרה או ניסיון קודם. תפקיד *מחוץ* לכנסת — ראש עיר, מנכ"ל
 * ארגון, ראש המטה הכללי, שגריר — הוא ניסיון ניהולי ממשי ולכן כן נכלל.
 */
const PARLIAMENTARY_ROLE = /^(חבר|חברת) הכנסת$|^(יושב ראש|יו"ר|סגן יושב ראש|סגנית יושבת ראש) הכנסת|^ראש האופוזיציה|^(יו"ר|יושב ראש) (ועדת|הוועדה|סיעת|הסיעה)|^מ"מ |^משקיף|^חבר פרלמנט/;

/**
 * תוויות עיסוק כלליות מדי מכדי לומר משהו. "שר" בלי ציון המשרד, או
 * "מנהל" בלי ציון של מה. הן נשמרות רק אם אין שום דבר טוב יותר.
 *
 * "מנהל כללי" מגיע מ-Wikidata כתווית ערומה, בלי הארגון שבראשו עמדו
 * (P108 ריק אצל כולם). היא הופיעה אצל ארבעה ח"כים ולא אמרה על אף
 * אחד מהם דבר.
 */
const VAGUE_OCCUPATIONS = new Set(['שר', 'מנהל', 'מנהל כללי', 'סמנכ״ל', 'סמנכ"ל', 'משנה למנכ״ל', 'משנה למנכ"ל', 'עובד ציבור', 'איש ציבור']);

/**
 * תפקידי ממשלה. פוליטיים באופיים ולכן אינם רקע תעסוקתי, אבל אצל
 * פוליטיקאי בקריירה הם המידע המשמעותי היחיד — ולכן משמשים מוצא אחרון
 * בלבד, ולעולם לא דוחקים עיסוק אמיתי.
 */
const GOVERNMENT_ROLE = /^(שר|שרה|השר|השרה|סגן שר|סגנית שר|ראש הממשלה|ראש ממשלת|סגן ראש ממשלת|המשנה לראש)/;

/**
 * תפקיד חיצוני לכנסת — ניסיון ניהולי שנחשב רקע תעסוקתי.
 *
 * תווית מעורפלת נפסלת גם כאן ולא רק במסלול העיסוקים: "מנהל כללי" בלי
 * שם הארגון אינו ניסיון ניהולי שאפשר להציג, מאיזה שדה שלא יגיע.
 */
function isBackgroundPosition(position: string): boolean {
  return (
    !PARLIAMENTARY_ROLE.test(position) &&
    !GOVERNMENT_ROLE.test(position) &&
    !VAGUE_OCCUPATIONS.has(position)
  );
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
  'מבואות הנגב',
  'תיכון דתי יבנה',
  'תיכון בית ירח',
  'כפר הנוער ע"ש ב.צ. מוסינזון',
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

  // רם בן ברק. Wikidata מתייג אותו "מרגל" — תיוג שאינו ראוי לתצוגה
  // ואינו מדויק. לפי ויקיפדיה העברית: "איש מערכת הביטחון, כיהן
  // כמשנה לראש המוסד".
  30691: { occupations: ['איש ביטחון', 'משנה לראש המוסד'] },

  // שניים שהיו ריקים או כמעט ריקים ב-Wikidata. המקור לשניהם הוא
  // פתיח הערך בוויקיפדיה העברית.
  //
  // מישל בוסקילה (30799) הוסר מכאן: הערך שהוזן היה "סגן שר החוץ", וזה
  // תפקיד ממשלתי ולא רקע תעסוקתי. לוויקיפדיה אין עליו מידע מקצועי אחר,
  // ולכן הוא נשאר בלי שורת עיסוק עד שיימצא מקור.
  30693: { occupations: ['עורך דין'] },                 // איתן גינזבורג — "עורך דין בהכשרתו"
  30765: { occupations: ['סגן ראש עיריית פתח תקווה'] }, // אוריאל בוסו

  // "מנכ"ל" ו"מנהל כללי" בלי ציון הארגון אינם אומרים דבר, ו-Wikidata
  // לא מחזיק את המעסיק (P108 ריק אצל כולם). הפירוט מפתיח הערך בוויקיפדיה.
  30804: { occupations: ['מנכ"ל רשת מעיין החינוך', 'מנכ"ל מוסדות מגדל אור'] }, // חיים ביטון
  30846: { occupations: ['ראש סיעת יהדות התורה'] },                            // יצחק גולדקנופ
  23639: { occupations: ['יו"ר התאחדות הסטודנטים בישראל'] },                   // בועז טופורובסקי

  // כך מוסיפים עוד:
  //   <person_id>: { occupations: [...] }   דריסת עיסוק
  //   <person_id>: { education: [] }        הסתרת השכלה
  //
  // ה-person_id מופיע ב-mk-profiles.json ליד כל שם.
};

/**
 * תוויות עיסוק מ-Wikidata שאינן ראויות לתצוגה או שאינן מדויקות בעברית.
 * נחסמות גלובלית, כדי שלא יחזרו בהרצה מחדש של הסקריפט אצל ח"כ אחר.
 */
const BLOCKED_OCCUPATIONS = new Set(['מרגל']);

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

/**
 * ותק בכנסת כטקסט, למשל "מכהן מאז 1988 · 38 שנים".
 *
 * השנה מגיעה מהקדנציה המוקדמת ביותר, לא מהנוכחית, כך שהיא משקפת ותק
 * ולא את תחילת הכנסת ה-25. הכהונה אינה בהכרח רציפה — ח"כ יכול היה
 * לצאת ולחזור — ולכן הניסוח הוא "מאז" ולא "ברציפות".
 */
export function tenureLabel(profile: MkProfile | null, now = new Date()): string | null {
  if (!profile?.sinceYear) return null;

  const years = now.getFullYear() - profile.sinceYear;
  if (years < 1) return `נכנס לכנסת ב-${profile.sinceYear}`;

  const suffix = years === 1 ? 'שנה' : 'שנים';
  return `מכהן מאז ${profile.sinceYear} · ${years} ${suffix}`;
}

/**
 * ההשכלה, מוגבלת לשני פריטים כדי שהשורה תישאר קריאה.
 *
 * פריט שכולל תואר ("דוקטור לפילוסופיה, אוניברסיטת בן-גוריון") מוצג
 * ראשון. בלי זה שלמה קרעי היה מוצג כשתי ישיבות והדוקטורט שלו היה
 * נחתך, רק משום שסדר הפריטים ב-Wikidata שרירותי.
 */
export function educationLine(profile: MkProfile | null): string | null {
  if (!profile) return null;

  /**
   * תואר מוויקיפדיה קודם לשם מוסד מ-Wikidata. הוא נושא גם את התואר וגם
   * את התחום — "תואר ראשון בכלכלה ובמנהל עסקים, אוניברסיטת חיפה" מול
   * "אוניברסיטת חיפה" בלבד. 101 ח"כים מקבלים כך תואר שלא היה להם.
   */
  const degrees = BACKGROUND_BY_ID.get(profile.personId)?.degrees ?? [];
  if (degrees.length > 0) return degrees.slice(0, 2).map(dedupeInstitution).join(' · ');

  if (profile.education.length === 0) return null;

  const hasDegree = (entry: string) => entry.includes(', ');
  const ordered = [
    ...profile.education.filter(hasDegree),
    ...profile.education.filter(e => !hasDegree(e)),
  ];

  return ordered.slice(0, 2).join(' · ');
}

/**
 * העיסוק, בלי "פוליטיקאי" שנכון לכל ח"כ ולכן אינו מוסיף מידע.
 *
 * למי שאין עיסוק אחר — רובם פוליטיקאים בקריירה בלי מקצוע קודם מתועד
 * ב-Wikidata — מוצג במקומו התפקיד הבכיר הנוכחי מ-mk_position, למשל
 * "שר האוצר". זה המידע האמיתי שכן קיים עליהם, והוא מהמאגר שלנו.
 */
export function occupationLine(profile: MkProfile | null): string | null {
  if (!profile) return null;

  // תיקון ידני גובר על הכל — הוא נכתב בדיוק כדי לתקן את מה שהמקורות מפספסים
  if (OVERRIDES[profile.personId]?.occupations) {
    const manual = OVERRIDES[profile.personId].occupations!;
    return manual.length > 0 ? manual.slice(0, 3).join(' · ') : null;
  }

  /**
   * ויקיפדיה גוברת על Wikidata. היא מחזירה עד שמונה תפקידים, ולכן
   * נחתכת לשלושה — הראשונים הם המשמעותיים, כי החילוץ התבקש להתחיל
   * במה שאדם היה מציג כרקע שלו היום.
   */
  /**
   * אותו סינון מעורפלות שחל על Wikidata חל גם כאן. החילוץ מוויקיפדיה
   * מייצר את אותה תקלה בצורה חדשה: "סמנכ״ל" ו"משנה למנכ״ל" בלי שם
   * הארגון אינם אומרים דבר, בדיוק כמו "מנהל כללי" שהוסר קודם.
   */
  const background = BACKGROUND_BY_ID.get(profile.personId);
  if (background) {
    const usable = background.occupations.filter(
      o => !VAGUE_OCCUPATIONS.has(o) && !BLOCKED_OCCUPATIONS.has(o),
    );
    if (usable.length > 0) {
      return usable
        .sort((a, b) => occupationRank(a) - occupationRank(b))
        .slice(0, 3)
        .join(' · ');
    }
  }

  const positions = profile.positions ?? [];

  /**
   * תפקיד חיצוני שמפרט תיאור גנרי מחליף אותו: "ראש עירייה" הופך
   * ל"ראש עיריית ירושלים", "מנהל כללי" ל"ראש המטה הכללי".
   */
  const specific = positions.filter(isBackgroundPosition);

  /**
   * תיאור גנרי שהתפקיד הספציפי כבר מכסה נזרק — "ראש עירייה" מיותר
   * לצד "ראש עיריית ירושלים".
   *
   * ההשוואה על שתי המילים הראשונות אחרי הסרת נטיית סמיכות (עירייה
   * ועיריית מתלכדות). מילה אחת אינה מספיקה: "איש עסקים" ו"איש צבא"
   * היו מתלכדות בטעות ואחת מהן הייתה נעלמת.
   */
  const stem = (s: string) =>
    s
      .split(' ')
      .slice(0, 2)
      .map(w => w.replace(/[הת]$/, ''))
      .join(' ');
  const covered = new Set(specific.map(stem));

  const occupations = profile.occupations.filter(
    o =>
      o !== 'פוליטיקאי' &&
      !BLOCKED_OCCUPATIONS.has(o) &&
      !VAGUE_OCCUPATIONS.has(o) &&
      !covered.has(stem(o)),
  );

  const combined = [...specific, ...occupations].slice(0, 3);
  if (combined.length > 0) return combined.join(' · ');

  // מוצא אחרון: תפקיד ממשלתי, לפוליטיקאים בקריירה שאין להם רקע אחר
  const government = positions.find(p => GOVERNMENT_ROLE.test(p));
  if (government) return government;

  return profile.role && !PARLIAMENTARY_ROLE.test(profile.role) ? profile.role : null;
}
