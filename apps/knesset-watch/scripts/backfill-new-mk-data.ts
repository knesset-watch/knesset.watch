/**
 * Fill in the derived fields for MKs added by sync-new-mks.
 *
 *   npx tsx scripts/backfill-new-mk-data.ts --dry-run
 *   npx tsx scripts/backfill-new-mk-data.ts
 *
 * sync-new-mks הוסיף שלושה ח"כים עם שם וסיעה בלבד. שלושה שדות נגזרים
 * נשארו ריקים, וכל אחד מהם שובר משהו אחר בתצוגה:
 *
 *   is_coalition = 0   שבתאי קטש מהליכוד הוצג כאופוזיציה
 *   segments = []      אין ותק, ו-countVotesDuringTenure מחזיר אפס
 *                      הזדמנויות — כלומר ציון 0 בשאלון
 *   mk_position        אין ועדות, אין תפקידים
 *
 * הסקריפט נוגע רק בח"כים שחסרים להם segments, ולכן הרצה חוזרת אינה
 * משנה דבר אצל 147 הוותיקים.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const API = 'https://knesset.gov.il/OdataV4/ParliamentInfo';
const KNESSET = 25;

/** מזהי הסיעות שבקואליציה, זהה ל-COALITION_FACTION_IDS ב-api/mk-profile */
const COALITION_FACTIONS = new Set([1095, 1096, 1101, 1105, 1106, 1107, 1108]);

/** PositionID 43 = חבר הכנסת, 67 = חבר ועדה */
const POSITION_MK = 43;
const POSITION_COMMITTEE = 67;

interface PositionRow {
  PersonID: number;
  PositionID: number;
  StartDate: string | null;
  FinishDate: string | null;
  CommitteeID: number | null;
  GovMinistryID: number | null;
  DutyDesc: string | null;
}

async function fetchAll<T>(url: string): Promise<T[]> {
  const out: T[] = [];
  let next = url;
  while (next) {
    const res = await fetch(next, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

  /** מי שנוסף בלי נתונים נגזרים */
  const targets = db
    .prepare(
      `SELECT person_id AS id, first_name AS first, last_name AS last, faction_id AS factionId
       FROM mk_person
       WHERE segments IS NULL OR segments = '[]' OR segments = ''`,
    )
    .all() as Array<{ id: number; first: string; last: string; factionId: number | null }>;

  console.log(`  ח"כים ללא נתונים נגזרים: ${targets.length}`);
  if (targets.length === 0) {
    db.close();
    return;
  }

  const positions = await fetchAll<PositionRow>(
    `${API}/KNS_PersonToPosition?` +
      new URLSearchParams({
        $filter: `KnessetNum eq ${KNESSET} and (${targets.map(t => `PersonID eq ${t.id}`).join(' or ')})`,
        $select: 'PersonID,PositionID,StartDate,FinishDate,CommitteeID,GovMinistryID,DutyDesc',
        $top: '400',
      }),
  );

  /** שמות הוועדות, כדי ש-mk_position לא יישאר עם מזהה בלבד */
  const committeeName = new Map<number, string>(
    (
      db.prepare('SELECT id, name FROM committee').all() as Array<{ id: number; name: string }>
    ).map(c => [c.id, c.name]),
  );

  const updatePerson = db.prepare(
    'UPDATE mk_person SET is_coalition = ?, segments = ? WHERE person_id = ?',
  );
  const insertPosition = db.prepare(
    `INSERT OR IGNORE INTO mk_position
       (id, mk_id, duty_desc, committee_id, committee, ministry_id, ministry,
        start_date, finish_date, is_current, role_type)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
  );

  let positionsAdded = 0;

  const apply = db.transaction(() => {
    for (const t of targets) {
      const mine = positions.filter(p => p.PersonID === t.id);
      const asMk = mine.filter(p => p.PositionID === POSITION_MK);
      const isCoalition = t.factionId !== null && COALITION_FACTIONS.has(t.factionId) ? 1 : 0;

      /**
       * segments בפורמט שהתצוגה מצפה לו. startFrac/endFrac הם המיקום
       * היחסי בתוך הכנסת ה-25 — התצוגה משתמשת בהם לסרגל הוותק.
       */
      const TERM_START = Date.parse('2022-11-15');
      const TERM_END = Date.now();
      const span = TERM_END - TERM_START;

      const segments = asMk
        .filter(p => p.StartDate)
        .map(p => {
          const start = Date.parse(p.StartDate!);
          const end = p.FinishDate ? Date.parse(p.FinishDate) : TERM_END;
          return {
            startFrac: Math.max(0, (start - TERM_START) / span),
            endFrac: Math.min(1, (end - TERM_START) / span),
            state: isCoalition ? 'coalition' : 'opposition',
            startDate: p.StartDate!.slice(0, 10),
            endDate: (p.FinishDate ?? new Date(TERM_END).toISOString()).slice(0, 10),
          };
        });

      console.log(
        `    ${`${t.first} ${t.last}`.padEnd(24)} ` +
          `${isCoalition ? 'קואליציה' : 'אופוזיציה'}  ` +
          `${segments.length} מקטעי כהונה  ${mine.length} רשומות תפקיד`,
      );

      if (dryRun) continue;

      updatePerson.run(isCoalition, JSON.stringify(segments), t.id);

      for (const p of mine) {
        /**
         * מזהה מקומי שנגזר מהמפתחות, כי ל-OData אין מזהה שורה יציב
         * לטבלה הזו. INSERT OR IGNORE מונע כפילות בהרצה חוזרת.
         */
        const rowId = Number(`9${t.id}${p.PositionID}${(p.CommitteeID ?? 0)}`.slice(0, 15));
        const isCommittee = p.PositionID === POSITION_COMMITTEE && p.CommitteeID;

        insertPosition.run(
          rowId,
          t.id,
          p.DutyDesc ?? null,
          p.CommitteeID ?? null,
          p.CommitteeID ? (committeeName.get(p.CommitteeID) ?? null) : null,
          p.GovMinistryID ?? null,
          p.StartDate ?? null,
          p.FinishDate ?? null,
          p.FinishDate ? 0 : 1,
          isCommittee ? 'committee' : 'mk',
        );
        positionsAdded++;
      }
    }
  });

  apply();

  if (dryRun) {
    console.log('\nDry run — nothing written.');
    db.close();
    return;
  }

  const stillEmpty = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM mk_person WHERE segments IS NULL OR segments = '[]'`)
      .get() as { n: number }
  ).n;
  db.close();

  console.log(`\nDone. ${positionsAdded} רשומות תפקיד נוספו · ${stillEmpty} ח"כים עדיין ללא segments`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
