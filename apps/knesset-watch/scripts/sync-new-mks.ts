/**
 * Add MKs who joined the 25th Knesset after the last full sync.
 *
 *   npx tsx scripts/sync-new-mks.ts --dry-run
 *   npx tsx scripts/sync-new-mks.ts
 *
 * mk_person מכיל 147 ח"כים ואינו כולל שלושה שנכנסו ב-2026: עוז חיים,
 * מוחמד אבו אל היג'א ושבתאי קטש. הם אינם מופיעים בדף הח"כים ולא
 * בשאלון, כלומר פעילותם אינה נמדדת כלל.
 *
 * הסקריפט הזה נוגע רק ב-mk_person ורק בשורות חסרות. sync.ts המלא
 * מושך את כל המסד מחדש, וזויה מריצה במקביל את משיכת הוועדות — שתי
 * כתיבות על אותו קובץ הן מתכון לנזק.
 *
 * שדות נגזרים נשארים ריקים בכוונה: segments נבנה מניתוח כהונה מלא,
 * coalition_pct מהצבעות. הם יתמלאו בסנכרון הבא. בלעדיהם הח"כ מוצג
 * בלי ותק ובלי אחוז קואליציה, וזה עדיף על היעדרו מהרשימה.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const API = 'https://knesset.gov.il/OdataV4/ParliamentInfo';

/** PositionID 43 = חבר הכנסת */
const MK_POSITION_ID = 43;
const KNESSET = 25;

interface PositionRow {
  PersonID: number;
  StartDate: string | null;
  FinishDate: string | null;
  FactionID: number | null;
  FactionName: string | null;
}

interface PersonRow {
  Id: number;
  FirstName: string | null;
  LastName: string | null;
}

async function fetchAll<T>(url: string): Promise<T[]> {
  const out: T[] = [];
  let next: string = url;

  while (next) {
    const res = await fetch(next, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${next.slice(0, 90)}`);
    const json = await res.json();
    out.push(...((json.value ?? []) as T[]));
    next = json['@odata.nextLink'] ?? '';
  }
  return out;
}

async function main() {
  const dryRun = process.argv.slice(2).includes('--dry-run');
  if (!fs.existsSync(DB_PATH)) throw new Error(`knesset.db not found at ${DB_PATH}`);

  const db = new Database(DB_PATH);

  const known = new Set(
    (db.prepare('SELECT person_id AS id FROM mk_person').all() as Array<{ id: number }>).map(r => r.id),
  );

  const positions = await fetchAll<PositionRow>(
    `${API}/KNS_PersonToPosition?` +
      new URLSearchParams({
        $filter: `KnessetNum eq ${KNESSET} and PositionID eq ${MK_POSITION_ID}`,
        $select: 'PersonID,StartDate,FinishDate,FactionID,FactionName',
        $top: '500',
      }),
  );

  const missing = [...new Set(positions.map(p => p.PersonID))].filter(id => !known.has(id));

  console.log(`  ח"כים בכנסת ה-${KNESSET} לפי OData: ${new Set(positions.map(p => p.PersonID)).size}`);
  console.log(`  קיימים במאגר:                ${known.size}`);
  console.log(`  חסרים:                       ${missing.length}`);

  if (missing.length === 0) {
    console.log('\nאין מה להוסיף.');
    db.close();
    return;
  }

  const people = await fetchAll<PersonRow>(
    `${API}/KNS_Person?` +
      new URLSearchParams({
        $filter: missing.map(id => `Id eq ${id}`).join(' or '),
        $select: 'Id,FirstName,LastName',
      }),
  );
  const nameById = new Map(people.map(p => [p.Id, p]));

  /**
   * הסיעה אינה על רשומת "חבר הכנסת" אלא על PositionID 54, ולכן נדרשת
   * שליפה שנייה. בלעדיה שלושת החדשים היו נכנסים בלי סיעה כלל.
   */
  const factionRows = await fetchAll<PositionRow>(
    `${API}/KNS_PersonToPosition?` +
      new URLSearchParams({
        $filter: `KnessetNum eq ${KNESSET} and (${missing.map(id => `PersonID eq ${id}`).join(' or ')})`,
        $select: 'PersonID,StartDate,FinishDate,FactionID,FactionName',
        $top: '200',
      }),
  );

  const factionById = new Map<number, { id: number | null; name: string | null }>();
  for (const r of factionRows) {
    if (!r.FactionName) continue;
    /** המאוחרת גוברת — ח"כ שעבר סיעה מופיע כמה פעמים */
    const prev = factionById.get(r.PersonID);
    if (!prev || (r.StartDate ?? '') >= (prev.name ?? '')) {
      factionById.set(r.PersonID, { id: r.FactionID, name: r.FactionName });
    }
  }

  const rows = missing.map(id => {
    const mine = positions
      .filter(p => p.PersonID === id)
      .sort((a, b) => (a.StartDate ?? '').localeCompare(b.StartDate ?? ''));
    const faction = factionById.get(id);
    const person = nameById.get(id);

    /** FinishDate ריק אצל מי שעדיין מכהן */
    const isCurrent = mine.some(p => !p.FinishDate) ? 1 : 0;

    return {
      person_id: id,
      first_name: person?.FirstName ?? '',
      last_name: person?.LastName ?? '',
      faction_id: faction?.id ?? null,
      faction_name: faction?.name ?? null,
      slug: String(id),
      is_current: isCurrent,
      startDate: mine[0]?.StartDate?.slice(0, 10) ?? null,
    };
  });

  console.log('');
  for (const r of rows) {
    console.log(
      `    ${r.person_id}  ${`${r.first_name} ${r.last_name}`.padEnd(24)} ` +
        `${(r.faction_name ?? '—').slice(0, 26).padEnd(28)} מ-${r.startDate ?? '?'}` +
        `${r.is_current ? '' : '  (סיים)'}`,
    );
  }

  if (dryRun) {
    console.log('\nDry run — nothing written.');
    db.close();
    return;
  }

  /**
   * is_coalition לא נקבע כאן. הוא נגזר מהשתייכות הסיעה לקואליציה, וזו
   * טבלה נפרדת שהסנכרון המלא מתחזק. אפס הוא ברירת מחדל שמרנית — עדיף
   * להציג ח"כ כאופוזיציה בטעות מאשר להשמיט אותו.
   */
  const insert = db.prepare(
    `INSERT OR IGNORE INTO mk_person
       (person_id, first_name, last_name, faction_id, faction_name, slug,
        is_current, is_coalition, coalition_pct, non_mk_pct, segments)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, 0, '[]')`,
  );

  db.transaction(() => {
    for (const r of rows) {
      insert.run(
        r.person_id,
        r.first_name,
        r.last_name,
        r.faction_id,
        r.faction_name,
        r.slug,
        r.is_current,
      );
    }
  })();

  const total = (db.prepare('SELECT COUNT(*) AS n FROM mk_person').get() as { n: number }).n;
  db.close();

  console.log(`\nDone. mk_person: ${total} ח"כים`);
  console.log('  segments ו-coalition_pct ריקים — יתמלאו בסנכרון המלא הבא.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
