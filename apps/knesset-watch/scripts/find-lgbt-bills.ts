/**
 * איתור הצעות חוק בתחום זכויות להט"ב.
 *
 * ── מלכודת שעלתה פעמיים ──────────────────────────────────────────────
 *
 * חיפוש תת-מחרוזת בעברית מסוכן, כי תחיליות נדבקות למילה:
 *
 *   %להט%   תופס את "להטיל"   — "להטיל עיצומים כספיים"
 *   %להטב%  תופס את "להטבות"  — "הרחבת זכאות להטבות"
 *
 * לכן כל מונח כאן נבדק בנפרד ומדווח כמה מצא, וכמה מזה רעש. מונח
 * שמחזיר רעש נפסל ולא נשאר ברשימה בשקט.
 *
 * ── גרשיים ───────────────────────────────────────────────────────────
 *
 * בעברית שני תווי גרשיים: " של ASCII ו-״ של יוניקוד (U+05F4). הנתונים
 * מערבבים ביניהם, ולכן כל מונח שמכיל גרשיים נבדק בשתי הצורות.
 *
 *   npx tsx scripts/find-lgbt-bills.ts            דוח
 *   npx tsx scripts/find-lgbt-bills.ts --csv      גם קובץ לסקירה
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { CLUSTERS } from '../src/lib/axis-clusters';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const OUT = path.join(process.cwd(), 'lgbt-bills.csv');
const asCsv = process.argv.includes('--csv');

/** כל מונח נבדק לבדו. ״ ו-" מטופלים יחד. */
const TERMS = [
  'להט"ב', 'להטב"ית', 'הלהט"בית', 'להט"בים', 'להט"בי',
  'הקהילה הגאה', 'קהילה גאה', 'הגאווה',
  'נטייה מינית', 'נטיה מינית', 'נטיות מיניות',
  'זהות מגדרית', 'זהויות מגדריות',
  'טרנסג\'נדר', 'טרנסג׳נדר', 'טרנסית', 'טרנסי',
  'הומוסקסואל', 'הומואים', 'לסביות', 'ביסקסואל',
  'בני זוג מאותו המין', 'בני זוג מאותו מין', 'זוג חד-מיני', 'זוגיות חד-מינית',
  'טיפולי המרה', 'טיפול המרה',
  /*
    ״מגדר״ לבדו נפסל. הוא תפס 194 הצעות, מהן 154 רק בגללו, ורובן
    על שוויון מגדרי לנשים ולא על להט״ב — ייצוג הולם בוועדות, חלופת
    מאסר לאמהות, קצבת שאירים לאלמנים. אלה שני תחומים שונים, וערבובם
    היה מנפח את התחום פי ארבעה בנתונים שאינם שייכים לו.

    ״זהות מגדרית״ נשאר: 25 הצעות, כולן בתחום.
  */
];

/** שתי צורות הגרשיים */
function variants(term: string): string[] {
  const out = new Set([term]);
  if (term.includes('"')) out.add(term.replace(/"/g, '״'));
  if (term.includes('״')) out.add(term.replace(/״/g, '"'));
  if (term.includes("'")) out.add(term.replace(/'/g, '׳'));
  if (term.includes('׳')) out.add(term.replace(/׳/g, "'"));
  return [...out];
}

function main(): void {
  const db = new Database(DB_PATH, { readonly: true });
  const axes = new Map(CLUSTERS.flatMap(c => c.questions.map(q => [q.issueId, q.question])));

  interface Hit { billId: number; title: string; issue: string; terms: Set<string> }
  const hits = new Map<number, Hit>();

  console.log('═══ כל מונח בנפרד ═══');
  console.log(`  ${'מונח'.padEnd(24)} ${'הצעות'.padStart(6)}`);

  for (const term of TERMS) {
    const forms = variants(term);
    const where = forms.map(() =>
      `(i.issue_candidate LIKE ? OR i.policy_change LIKE ? OR i.pro_stance LIKE ? OR i.con_stance LIKE ? OR b.title LIKE ?)`,
    ).join(' OR ');
    const args = forms.flatMap(f => Array(5).fill(`%${f}%`));

    const rows = db.prepare(`
      SELECT DISTINCT b.id AS billId, b.title AS title, i.issue_candidate AS issue
      FROM bill_policy_issue i JOIN bill b ON b.id = i.bill_id
      WHERE ${where}`).all(...args) as Array<Record<string, string | number>>;

    console.log(`  ${term.padEnd(24)} ${String(rows.length).padStart(6)}`);
    for (const r of rows) {
      const id = Number(r.billId);
      if (!hits.has(id)) hits.set(id, { billId: id, title: String(r.title), issue: String(r.issue), terms: new Set() });
      hits.get(id)!.terms.add(term);
    }
  }

  const all = [...hits.values()];
  console.log(`\n═══ סה"כ הצעות ייחודיות: ${all.length} ═══`);

  /*
    "מגדר" לבדו רחב. הצעה שנתפסה רק בגללו מסומנת בנפרד, כדי שאפשר
    יהיה לראות אם הוא מביא ערך או רעש.
  */
  const classified = (id: number) =>
    (db.prepare('SELECT issue_id AS id FROM bill_political_classification WHERE bill_id = ?').all(id) as Array<{ id: string }>)
      .map(c => axes.get(c.id) ?? c.id);

  const unclassified = all.filter(h => classified(h.billId).length === 0);
  console.log(`\n  מסווגות   : ${all.length - unclassified.length}`);
  console.log(`  לא מסווגות: ${unclassified.length}`);

  console.log('\n═══ הלא מסווגות ═══');
  for (const h of unclassified) {
    console.log(`\n  ${h.title.slice(0, 60)}`);
    console.log(`    ${h.issue.slice(0, 62)}`);
    console.log(`    נתפסה ב: ${[...h.terms].join(', ')}`);
  }

  if (asCsv) {
    const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
    const lines = [['bill_id', 'כותרת', 'סוגיה', 'מונחים שתפסו', 'הציר הנוכחי'].map(esc).join(',')];
    for (const h of all) {
      lines.push([String(h.billId), h.title, h.issue, [...h.terms].join(' · '),
        classified(h.billId).join(' | ') || '(לא מסווגת)'].map(esc).join(','));
    }
    fs.writeFileSync(OUT, '﻿' + lines.join('\n') + '\n');
    console.log(`\nנכתב: ${path.basename(OUT)}  (${all.length} שורות)`);
  }
  db.close();
}

main();
