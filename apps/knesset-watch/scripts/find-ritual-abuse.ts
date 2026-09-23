/**
 * איתור חקיקה ודיונים בנושא פגיעה מינית טקסית מאורגנת.
 *
 * כל מונח נבדק בנפרד ומדווח כמה מצא, כדי שמונח רועש ייפסל במפורש
 * ולא יישאר ברשימה בשקט. בעברית תת-מחרוזת מטעה: "טקסי" נבלע בתוך
 * "טקסים" ו"טקסית", ולכן הדוח מציג את ההקשר שנמצא ולא רק ספירה.
 *
 * מחפש גם בפרוטוקולי ועדות, לא רק בהצעות חוק. נושא יכול להידון
 * בוועדה שנים לפני שמוגשת עליו הצעת חוק, ואם אין חקיקה זה עדיין
 * המקום היחיד שבו הוא מופיע.
 *
 *   npx tsx scripts/find-ritual-abuse.ts
 */

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

const TERMS = [
  'פגיעה מינית טקסית',
  'פגיעות מיניות טקסיות',
  'פגיעה מינית טקסית מאורגנת',
  'פגיעות מיניות טקסיות מאורגנות',
  'פגיעה טקסית',
  'פגיעות טקסיות',
  'אונס טקסי',
  'אונס טקסי מאורגן',
  'פגיעה מינית מאורגנת',
  'אונס מאורגן',
];

/** מונחים רחבים יותר, לבדיקה אם הנושא מופיע בניסוח אחר */
const BROADER = ['טקסי', 'טקסית', 'כת ', 'כתות', 'פולחן', 'התעללות מאורגנת'];

function main(): void {
  const db = new Database(DB_PATH, { readonly: true });

  const has = (t: string) =>
    !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t);

  console.log('═══ הצעות חוק ═══');
  console.log(`  ${'מונח'.padEnd(32)} ${'נמצא'.padStart(5)}`);
  let billHits = 0;
  for (const t of TERMS) {
    const rows = db.prepare(`
      SELECT DISTINCT b.id, b.title FROM bill b
      LEFT JOIN bill_policy_issue i ON i.bill_id = b.id
      WHERE b.title LIKE ? OR i.issue_candidate LIKE ? OR i.policy_change LIKE ?
         OR i.pro_stance LIKE ? OR i.con_stance LIKE ?`)
      .all(...Array(5).fill(`%${t}%`)) as Array<{ id: number; title: string }>;
    console.log(`  ${t.padEnd(32)} ${String(rows.length).padStart(5)}`);
    billHits += rows.length;
    for (const r of rows) console.log(`      ${r.id}  ${r.title.slice(0, 60)}`);
  }

  if (!billHits) {
    console.log('\n  אין אף הצעת חוק באף אחד מהמונחים.');
    console.log('\n  בדיקה במונחים רחבים יותר:');
    for (const t of BROADER) {
      const n = (db.prepare(`
        SELECT COUNT(DISTINCT b.id) AS n FROM bill b
        LEFT JOIN bill_policy_issue i ON i.bill_id = b.id
        WHERE b.title LIKE ? OR i.issue_candidate LIKE ? OR i.policy_change LIKE ?`)
        .get(...Array(3).fill(`%${t}%`)) as { n: number }).n;
      console.log(`    ${t.padEnd(22)} ${String(n).padStart(4)}`);
    }
  }

  // ── פרוטוקולי ועדות ──
  if (!has('session_protocol')) {
    console.log('\n(אין טבלת פרוטוקולים במסד הזה)');
    db.close();
    return;
  }

  console.log('\n═══ פרוטוקולי ועדות ═══');
  console.log(`  ${'מונח'.padEnd(32)} ${'נמצא'.padStart(5)}`);
  const cols = (db.prepare(`SELECT name FROM pragma_table_info('session_protocol')`).all() as Array<{ name: string }>)
    .map(c => c.name);
  const textCol = ['text', 'content', 'body', 'protocol_text', 'raw_text'].find(c => cols.includes(c));
  if (!textCol) {
    console.log(`  (אין עמודת טקסט; קיימות: ${cols.join(', ')})`);
    db.close();
    return;
  }

  for (const t of [...TERMS, 'טקסית', 'פולחן']) {
    const rows = db.prepare(`
      SELECT session_id, ${textCol} AS txt FROM session_protocol WHERE ${textCol} LIKE ? LIMIT 4`)
      .all(`%${t}%`) as Array<{ session_id: number; txt: string }>;
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM session_protocol WHERE ${textCol} LIKE ?`)
      .get(`%${t}%`) as { n: number }).n;
    console.log(`  ${t.padEnd(32)} ${String(total).padStart(5)}`);
    for (const r of rows) {
      const i = r.txt.indexOf(t);
      console.log(`      ...${r.txt.slice(Math.max(0, i - 70), i + 90).replace(/\s+/g, ' ')}...`);
    }
  }
  db.close();
}

main();
