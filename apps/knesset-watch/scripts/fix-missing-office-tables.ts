/**
 * Create the three office tables that knesset-db.ts joins against.
 *
 *   npx tsx scripts/fix-missing-office-tables.ts --dry-run
 *   npx tsx scripts/fix-missing-office-tables.ts
 *
 * knesset-db.ts מבצע JOIN על canonical_office_ministry בחמישה מקומות,
 * והטבלה מעולם לא נוצרה במסד המקומי — יחד עם canonical_office
 * ו-gov_ministry. התוצאה: כרטיסיית הסקירה בדף ח"כ נופלת על
 * "no such table", והדף מציג "ח״כ 30749" במקום "משה אבוטבול".
 *
 * הסכימה זהה לזו שב-sync.ts. הסקריפט הזה קיים כדי לא להריץ סנכרון
 * מלא: sync.ts מושך מחדש את כל המסד, וזויה מריצה במקביל את משיכת
 * הוועדות — שתי כתיבות על אותו קובץ הן מתכון לנזק.
 *
 * gov_ministry מתמלאת מ-KNS_GovMinistry, שהיא רשימה קטנה וזולה.
 * canonical_office והגשר נשארים ריקים: מילוי שלהם הוא seed נפרד
 * שדורש בדיקה ידנית. טבלה ריקה מחזירה אפס שורות ב-JOIN — הדף עובד,
 * פשוט בלי שיוך משרדים.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const API = 'https://knesset.gov.il/OdataV4/ParliamentInfo';

interface Ministry {
  Id: number;
  Name: string;
  IsActive: boolean | null;
  LastUpdatedDate: string | null;
}

async function fetchMinistries(): Promise<Ministry[]> {
  const out: Ministry[] = [];
  let url = `${API}/KNS_GovMinistry?$select=Id,Name,IsActive,LastUpdatedDate&$top=200`;

  while (url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    out.push(...(json.value ?? []));
    url = json['@odata.nextLink'] ?? '';
  }
  return out;
}

async function main() {
  const dryRun = process.argv.slice(2).includes('--dry-run');
  if (!fs.existsSync(DB_PATH)) throw new Error(`knesset.db not found at ${DB_PATH}`);

  const db = new Database(DB_PATH);

  const existing = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
      .map(r => r.name),
  );
  const missing = ['gov_ministry', 'canonical_office', 'canonical_office_ministry'].filter(
    t => !existing.has(t),
  );

  console.log(`  טבלאות חסרות: ${missing.length ? missing.join(', ') : 'אין'}`);

  if (dryRun) {
    const ministries = await fetchMinistries();
    console.log(`  KNS_GovMinistry מחזירה: ${ministries.length} משרדים`);
    console.log('\nDry run — nothing written.');
    db.close();
    return;
  }

  /** הסכימה זהה ל-sync.ts. IF NOT EXISTS כדי שהרצה חוזרת לא תזיק. */
  db.exec(`
    CREATE TABLE IF NOT EXISTS gov_ministry (
      id           INTEGER PRIMARY KEY,
      name         TEXT NOT NULL,
      is_active    INTEGER NOT NULL DEFAULT 0,
      last_updated TEXT
    );

    CREATE TABLE IF NOT EXISTS canonical_office (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      slug         TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      short_name   TEXT,
      is_active    INTEGER NOT NULL DEFAULT 1,
      notes        TEXT
    );

    CREATE TABLE IF NOT EXISTS canonical_office_ministry (
      canonical_office_id INTEGER NOT NULL REFERENCES canonical_office(id),
      gov_ministry_id     INTEGER NOT NULL REFERENCES gov_ministry(id),
      PRIMARY KEY (canonical_office_id, gov_ministry_id)
    );
  `);
  console.log('  שלוש הטבלאות נוצרו');

  const ministries = await fetchMinistries();
  const insert = db.prepare(
    `INSERT OR REPLACE INTO gov_ministry (id, name, is_active, last_updated) VALUES (?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const m of ministries) {
      insert.run(m.Id ?? null, m.Name ?? '', m.IsActive ? 1 : 0, m.LastUpdatedDate ?? null);
    }
  })();

  const counts = ['gov_ministry', 'canonical_office', 'canonical_office_ministry'].map(t => {
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    return `${t}=${n}`;
  });
  db.close();

  console.log(`  ${counts.join('  ')}`);
  console.log('\nDone. canonical_office והגשר נשארים ריקים — seed נפרד.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
