/**
 * Creates and seeds faction_coalition_history table.
 *
 * This table records when factions changed coalition/opposition status,
 * so vote displays can show accurate historical coalition breakdowns.
 *
 * Without this, votes from e.g. July 2023 wrongly show "הימין הממלכתי"
 * (Sa'ar, faction 1108) as coalition — they only joined after Oct 7 2023.
 *
 * Run: npx tsx scripts/add-faction-coalition-history.ts
 */
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS faction_coalition_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    faction_id  INTEGER NOT NULL,
    is_coalition INTEGER NOT NULL,  -- 1=coalition, 0=opposition
    from_date   TEXT NOT NULL,      -- ISO date YYYY-MM-DD, inclusive
    to_date     TEXT                -- ISO date YYYY-MM-DD, exclusive; NULL = still active
  );
  CREATE INDEX IF NOT EXISTS idx_fch_faction ON faction_coalition_history(faction_id, from_date);
`);

// Clear and re-seed so this script is idempotent
db.prepare('DELETE FROM faction_coalition_history').run();

const insert = db.prepare(
  'INSERT INTO faction_coalition_history (faction_id, is_coalition, from_date, to_date) VALUES (?, ?, ?, ?)'
);

const seed = db.transaction(() => {
  // ── Knesset 25 (formed Dec 29, 2022) ────────────────────────────────────────
  // Original coalition: Likud, Shas, UTJ, Religious Zionism, Otzma, Noam
  const K25_START = '2022-12-29';
  const PERMANENT_COALITION: number[] = [
    1096, // הליכוד
    1095, // שס
    1101, // יהדות התורה
    1105, // הציונות הדתית
    1106, // עוצמה יהודית
    1107, // נעם
  ];
  for (const fid of PERMANENT_COALITION) {
    insert.run(fid, 1, K25_START, null);
  }

  // Permanent K25 opposition
  const PERMANENT_OPPOSITION: number[] = [
    1102, // יש עתיד
    1099, // רע"מ
    1100, // העבודה
    1103, // חד"ש-תע"ל
    1104, // ישראל ביתנו
    1109, // עידן רול (individual)
  ];
  for (const fid of PERMANENT_OPPOSITION) {
    insert.run(fid, 0, K25_START, null);
  }

  // ── Emergency government (Oct 12, 2023 – ) ──────────────────────────────────
  // הימין הממלכתי (Sa'ar) joined Oct 12 2023; still in coalition today
  insert.run(1108, 0, K25_START,    '2023-10-12'); // opposition before
  insert.run(1108, 1, '2023-10-12', null);          // coalition after

  // כחול לבן - המחנה הממלכתי (Gantz) joined Oct 12 2023; left Jun 17 2024
  insert.run(1110, 0, K25_START,    '2023-10-12');
  insert.run(1110, 1, '2023-10-12', '2024-06-17');
  insert.run(1110, 0, '2024-06-17', null);

  // המחנה הממלכתי sub-faction (Eisenkot/Kahana) — same trajectory as Gantz
  insert.run(1098, 0, K25_START,    '2023-10-12');
  insert.run(1098, 1, '2023-10-12', '2024-06-17');
  insert.run(1098, 0, '2024-06-17', null);
});

seed();

const count = (db.prepare('SELECT COUNT(*) as cnt FROM faction_coalition_history').get() as { cnt: number }).cnt;
console.log(`faction_coalition_history seeded: ${count} rows`);

db.close();
