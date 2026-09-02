/**
 * Fetch MK photos and background from Wikidata.
 *
 *   npx tsx scripts/fetch-mk-profiles.ts
 *
 * למה Wikidata ולא הכנסת: ל-OData של הכנסת אין תמונות ואין ביוגרפיה —
 * KNS_Person מחזיק שם, מגדר ואימייל בלבד, ואף אחת מ-48 הישויות לא
 * מכילה תמונה או השכלה. אתר הכנסת הציבורי כן מציג תמונות, אבל הוא
 * מוגן ב-WAF שדורש הרצת JavaScript (מחזיר HTTP 247), כלומר אינו
 * מקור לשליפה אוטומטית.
 *
 * Wikidata מכסה 146 מחברי הכנסת ה-25, מהם 145 עם תמונה, 139 עם עיסוק
 * ו-124 עם השכלה. התמונות ב-Wikimedia Commons ברישיון חופשי.
 *
 * הפלט הוא קובץ JSON סטטי שנכנס ל-git. אין קריאה ל-Wikidata בזמן ריצה.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const OUT_PATH = path.join(process.cwd(), 'src', 'lib', 'mk-profiles.json');

const ENDPOINT = 'https://query.wikidata.org/sparql';
const KNESSET_MEMBER = 'wd:Q4047513';
const KNESSET_25 = 'wd:Q114948813';

/** רוחב התמונה שמבקשים מ-Commons. מספיק לאווטאר, קל לטעינה */
const THUMB_WIDTH = 200;

/**
 * ח"כים שהשם שלהם ב-Wikidata שונה מספיק כדי שההתאמה האוטומטית תפספס,
 * או שאינם מופיעים שם כלל. מפתח: person_id במאגר שלנו.
 */
const MANUAL_QID: Record<number, string> = {
  // נותרו ללא התאמה אוטומטית — אפשר להשלים ידנית בהמשך:
  // אכרם חסון, איתן גינזבורג, מיכל שיר סגמן, אפרת רייטן מרום,
  // דבי ביטון, חנוך דב מלביצקי, יצחק גולדקנופ
};

/**
 * ?firstTerm הוא המוקדם מבין תחילות הכהונה כחבר כנסת — לא רק הכנסת
 * ה-25. כך "מכהן מאז 1988" משקף ותק אמיתי ולא את תחילת הקדנציה הנוכחית.
 * mk_person.segments מחזיק רק את חלון הכנסת ה-25 ולכן אינו מספיק.
 */
const QUERY = `
SELECT ?mk ?mkLabel ?image (MIN(?start) AS ?firstTerm)
       (GROUP_CONCAT(DISTINCT ?educLabel; separator="|") AS ?educ)
       (GROUP_CONCAT(DISTINCT ?occLabel;  separator="|") AS ?occ) WHERE {
  ?mk p:P39 ?st .
  ?st ps:P39 ${KNESSET_MEMBER} ; pq:P2937 ${KNESSET_25} .
  OPTIONAL { ?mk p:P39 ?any . ?any ps:P39 ${KNESSET_MEMBER} ; pq:P580 ?start . }
  OPTIONAL { ?mk wdt:P18 ?image . }
  OPTIONAL { ?mk wdt:P69 ?e . ?e rdfs:label ?educLabel . FILTER(lang(?educLabel) = "he") }
  OPTIONAL { ?mk wdt:P106 ?o . ?o rdfs:label ?occLabel . FILTER(lang(?occLabel) = "he") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "he". }
} GROUP BY ?mk ?mkLabel ?image
`;

interface WikidataRow {
  mk: { value: string };
  mkLabel: { value: string };
  image?: { value: string };
  firstTerm?: { value: string };
  educ?: { value: string };
  occ?: { value: string };
}

/**
 * שאילתה שנייה: תואר ותחום לימוד, שיושבים כמאפיינים על רשומת הלימודים
 * (P512 ו-P812) ולא על האדם.
 *
 * הכיסוי דל — 9 מתוך 208 רשומות השכלה מחזיקות תואר, ו-5 מחזיקות תחום.
 * לכן זו תוספת ולא החלפה: מי שיש לו תואר יוצג כ"בוגר במשפטים,
 * האוניברסיטה העברית", וכל השאר יישארו עם שם המוסד בלבד.
 */
const DEGREE_QUERY = `
SELECT ?mk ?instLabel ?degLabel ?majorLabel WHERE {
  ?mk p:P39 ?st . ?st ps:P39 ${KNESSET_MEMBER} ; pq:P2937 ${KNESSET_25} .
  ?mk p:P69 ?ed . ?ed ps:P69 ?inst .
  OPTIONAL { ?ed pq:P512 ?deg . }
  OPTIONAL { ?ed pq:P812 ?major . }
  FILTER(BOUND(?deg) || BOUND(?major))
  SERVICE wikibase:label { bd:serviceParam wikibase:language "he". }
}
`;

interface DegreeRow {
  mk: { value: string };
  instLabel: { value: string };
  degLabel?: { value: string };
  majorLabel?: { value: string };
}

/**
 * כשלישות ב-Wikidata אין תווית עברית, השירות מחזיר את המזהה הגולמי
 * ("Q5207064"). כזה ערך לא אמור להגיע למסך.
 */
function isUsableLabel(label: string | undefined): label is string {
  return Boolean(label) && !/^Q\d+$/.test(label!.trim());
}

/**
 * מרכיב את התיאור: "בוגר במשפטים, האוניברסיטה העברית".
 * כשיש תואר ותחום — התחום מחליף את סיומת התואר הגנרית.
 */
function composeDegree(inst: string, degree?: string, major?: string): string {
  const deg = isUsableLabel(degree) ? degree : undefined;
  const maj = isUsableLabel(major) ? major : undefined;

  if (deg && maj) return `${deg} ב${maj}, ${inst}`;
  if (deg) return `${deg}, ${inst}`;
  if (maj) return `${maj}, ${inst}`;
  return inst;
}

export interface MkProfile {
  personId: number;
  name: string;
  /** כתובת תמונה ממוזערת ב-Wikimedia Commons, או null */
  photo: string | null;
  /** מוסדות לימוד */
  education: string[];
  /** עיסוקים לפני או לצד הכהונה */
  occupations: string[];
  /** השנה שבה נכנס לכנסת לראשונה, מכל קדנציה שהיא */
  sinceYear: number | null;
  /** מזהה Wikidata, לצורך בדיקה ידנית */
  qid: string;
}

/** מנרמל שם לצורך השוואה: מסיר גרשיים, ממיר מקפים לרווחים */
function normalizeName(s: string): string {
  return (s || '')
    .replace(/["'׳״]/g, '')
    .replace(/[-־–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Commons מחזיר את התמונה במלוא הרזולוציה, שלעיתים שוקלת מגה-בייטים.
 * Special:FilePath עם width מחזיר גרסה מוקטנת.
 */
function thumbnail(imageUrl: string): string {
  const file = decodeURIComponent(imageUrl.split('/').pop() ?? '');
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${THUMB_WIDTH}`;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split('|').map(s => s.trim()).filter(Boolean))];
}

async function runQuery<T>(query: string): Promise<T[]> {
  const url = `${ENDPOINT}?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/sparql-results+json',
      // Wikidata דורש User-Agent מזהה, אחרת חוסם
      'User-Agent': 'knesset-watch/1.0 (https://knesset.watch)',
    },
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) throw new Error(`Wikidata returned ${res.status}`);
  const json = await res.json();
  return json.results.bindings as T[];
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`knesset.db not found at ${DB_PATH}`);
  }

  console.log('Querying Wikidata...');
  const rows = await runQuery<WikidataRow>(QUERY);
  console.log(`  ${rows.length} profile rows`);

  const degreeRows = await runQuery<DegreeRow>(DEGREE_QUERY);
  console.log(`  ${degreeRows.length} education rows carry a degree or major`);

  /** qid → { מוסד → תיאור מלא עם תואר } */
  const degreeByQid = new Map<string, Map<string, string>>();
  for (const d of degreeRows) {
    const qid = d.mk.value.split('/').pop() ?? '';
    if (!degreeByQid.has(qid)) degreeByQid.set(qid, new Map());
    degreeByQid
      .get(qid)!
      .set(
        d.instLabel.value,
        composeDegree(d.instLabel.value, d.degLabel?.value, d.majorLabel?.value),
      );
  }

  const candidates = rows.map(r => ({ norm: normalizeName(r.mkLabel.value), row: r }));

  const db = new Database(DB_PATH, { readonly: true });
  const mks = db.prepare(
    'SELECT person_id AS personId, first_name AS firstName, last_name AS lastName FROM mk_person',
  ).all() as Array<{ personId: number; firstName: string; lastName: string }>;
  db.close();

  const profiles: MkProfile[] = [];
  const unmatched: string[] = [];

  for (const mk of mks) {
    const first = normalizeName(mk.firstName);
    const last = normalizeName(mk.lastName);
    const firstTokens = first.split(' ');

    const manual = MANUAL_QID[mk.personId];
    let match = manual
      ? candidates.find(c => c.row.mk.value.endsWith(`/${manual}`))
      : undefined;

    if (!match) {
      // שם משפחה זהה, ואחד מחלקי השם הפרטי פותח. מטפל בשמות אמצעיים
      // ("מכלוף מיקי זוהר" ↔ "מיקי זוהר") ובשמות משפחה מורכבים.
      const sameSurname = candidates.filter(
        c => c.norm === `${first} ${last}` || c.norm.endsWith(` ${last}`),
      );
      match =
        sameSurname.find(c => firstTokens.some(t => c.norm.startsWith(`${t} `))) ??
        (sameSurname.length === 1 ? sameSurname[0] : undefined);
    }

    if (!match) {
      unmatched.push(`${first} ${last}`);
      continue;
    }

    const qid = match.row.mk.value.split('/').pop() ?? '';
    const degrees = degreeByQid.get(qid);

    profiles.push({
      personId: mk.personId,
      name: `${mk.firstName} ${mk.lastName}`.trim(),
      photo: match.row.image ? thumbnail(match.row.image.value) : null,
      // כשידוע התואר, שם המוסד מוחלף בתיאור המלא
      education: splitList(match.row.educ?.value).map(inst => degrees?.get(inst) ?? inst),
      occupations: splitList(match.row.occ?.value),
      sinceYear: match.row.firstTerm ? Number(match.row.firstTerm.value.slice(0, 4)) || null : null,
      qid,
    });
  }

  profiles.sort((a, b) => a.personId - b.personId);
  fs.writeFileSync(OUT_PATH, JSON.stringify(profiles, null, 2) + '\n', 'utf8');

  const withPhoto = profiles.filter(p => p.photo).length;
  const withEdu = profiles.filter(p => p.education.length > 0).length;
  const withOcc = profiles.filter(p => p.occupations.length > 0).length;

  console.log(`\nWrote ${profiles.length} profiles to ${path.relative(process.cwd(), OUT_PATH)}`);
  console.log(`  with photo:      ${withPhoto}`);
  console.log(`  with education:  ${withEdu}`);
  console.log(`  with occupation: ${withOcc}`);
  // תיאור שמכיל פסיק הוא כזה שהתואר שולב בו
  const withDegree = profiles.filter(p => p.education.some(e => e.includes(', '))).length;
  console.log(`  with a named degree: ${withDegree}`);
  if (unmatched.length > 0) {
    console.log(`\n  unmatched (${unmatched.length}) — add to MANUAL_QID if needed:`);
    unmatched.forEach(n => console.log(`    · ${n}`));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
