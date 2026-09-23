/**
 * ייצוא כל השינויים שהצינור מציע, לפני שנכתב משהו למסד.
 *
 * ── מה יש בקובץ ──────────────────────────────────────────────────────
 *
 * גיליון "מעברים"  — 867 שיוכים שיעברו לציר אחר, עם הצד המאומת.
 * גיליון "מחיקות"  — 1,102 שיוכים שיימחקו, עם הסיבה לכל אחד.
 * גיליון "צירים שייעלמו" — 14 צירים שירדו מתחת לסף ויעלמו מהשאלון.
 * גיליון "זוכו"    — 153 שהביקורת פסלה ושלב 2 החזיר.
 *
 * כל גיליון מסומן בעמודת החלטה עם רשימה נפתחת: לאשר / לדחות. אפשר
 * לעבור רק על מה שרוצים ולהשאיר את השאר ריק — ריק נחשב "לאשר".
 *
 *   npx tsx scripts/export-changes-xlsx.ts
 */

import Database from 'better-sqlite3';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { CLUSTERS } from '../src/lib/axis-clusters';
import { MIN_BILLS_PER_ISSUE } from '../src/lib/canonical-agendas';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const REHOME = path.join(process.cwd(), 'rehome-suggestions.jsonl');
const SIDES = path.join(process.cwd(), 'orphan-sides.jsonl');
const OUT = path.join(process.cwd(), 'שינויים-מוצעים.xlsx');

const NAVY = 'FF0E2140';
const WASH = 'FFFBF4E1';

interface Rehome { billId: number; oldIssueId: string; newIssueId: string | null; confidence?: string; why?: string }

async function main(): Promise<void> {
  const db = new Database(DB_PATH, { readonly: true });
  const AX = new Map(CLUSTERS.flatMap(c => c.questions.map(q => [q.issueId, { q: q.question, cluster: c.label }] as const)));

  const rehome = fs.readFileSync(REHOME, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Rehome);
  const sides = new Map((fs.readFileSync(SIDES, 'utf8').split('\n').filter(Boolean)
    .map(l => JSON.parse(l) as { billId: number; issueId: string; verified: string | null; original: string }))
    .map(s => [`${s.billId}|${s.issueId}`, s]));

  const meta = db.prepare(`SELECT b.title AS title,
      (SELECT policy_change FROM bill_policy_issue WHERE bill_id = b.id LIMIT 1) AS change
    FROM bill b WHERE b.id = ?`);
  const inits = db.prepare(`SELECT p.first_name||' '||p.last_name AS n
    FROM bill_initiator bi JOIN mk_person p ON p.person_id = bi.mk_id WHERE bi.bill_id = ?`);

  const moves: Rehome[] = [], dels: Array<Rehome & { reason: string }> = [], kept: Rehome[] = [];
  for (const r of rehome) {
    if (r.newIssueId === r.oldIssueId) { kept.push(r); continue; }
    if (r.newIssueId && r.confidence === 'high' && sides.get(`${r.billId}|${r.newIssueId}`)?.verified) {
      moves.push(r); continue;
    }
    dels.push({
      ...r,
      reason: !r.newIssueId ? 'לא נמצא ציר מתאים'
        : r.confidence !== 'high' ? `נמצא ציר אך בביטחון ${r.confidence === 'medium' ? 'בינוני' : 'נמוך'}`
        : 'הצד לא הוכרע',
    });
  }

  const wb = new ExcelJS.Workbook();
  const lists = wb.addWorksheet('עזר');
  ['לאשר', 'לדחות'].forEach((v, i) => { lists.getCell(i + 1, 1).value = v; });

  const head = (ws: ExcelJS.Worksheet, n: number) => {
    const r = ws.getRow(1);
    r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    r.height = 22;
    ws.eachRow((row, i) => { if (i > 1) row.alignment = { vertical: 'top', wrapText: true }; });
    if (n > 1) {
      ws.dataValidations.add(`A2:A${n}`, {
        type: 'list', allowBlank: true, showInputMessage: true,
        promptTitle: 'החלטה', prompt: 'ריק = לאשר. לדחייה יש לבחור "לדחות".',
        formulae: [`'עזר'!$A$1:$A$2`],
      });
      for (let i = 2; i <= n; i++) ws.getCell(`A${i}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WASH } };
    }
  };

  const bill = (id: number) => {
    const m = meta.get(id) as { title: string; change: string | null } | undefined;
    return {
      title: m?.title ?? '',
      change: m?.change ?? '',
      who: (inits.all(id) as Array<{ n: string }>).map(x => x.n).join(', '),
    };
  };

  // ── מעברים ──
  const ws1 = wb.addWorksheet(`מעברים (${moves.length})`, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws1.columns = [
    { header: 'החלטה', key: 'd', width: 12 }, { header: 'מזהה', key: 'id', width: 11 },
    { header: 'כותרת', key: 't', width: 46 }, { header: 'מה ההצעה עושה', key: 'c', width: 58 },
    { header: 'יוזמים', key: 'w', width: 24 },
    { header: 'מהציר', key: 'from', width: 44 }, { header: 'אל הציר', key: 'to', width: 44 },
    { header: 'צד', key: 's', width: 8 }, { header: 'הצד השתנה?', key: 'f', width: 13 },
    { header: 'נימוק', key: 'y', width: 46 },
  ];
  for (const r of moves) {
    const b = bill(r.billId);
    const s = sides.get(`${r.billId}|${r.newIssueId}`)!;
    ws1.addRow({
      d: '', id: r.billId, t: b.title, c: b.change, w: b.who,
      from: AX.get(r.oldIssueId)?.q, to: AX.get(r.newIssueId!)?.q,
      s: s.verified === 'pro' ? 'בעד' : 'נגד',
      f: s.verified !== s.original ? 'כן — התהפך' : '', y: r.why,
    });
  }
  head(ws1, moves.length + 1);

  // ── מחיקות ──
  const ws2 = wb.addWorksheet(`מחיקות (${dels.length})`, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws2.columns = [
    { header: 'החלטה', key: 'd', width: 12 }, { header: 'מזהה', key: 'id', width: 11 },
    { header: 'כותרת', key: 't', width: 46 }, { header: 'מה ההצעה עושה', key: 'c', width: 58 },
    { header: 'יוזמים', key: 'w', width: 24 },
    { header: 'הציר שממנו תוסר', key: 'from', width: 46 },
    { header: 'סיבה', key: 'r', width: 26 },
    { header: 'הציר שנשקל', key: 'cand', width: 40 },
  ];
  for (const r of dels) {
    const b = bill(r.billId);
    ws2.addRow({
      d: '', id: r.billId, t: b.title, c: b.change, w: b.who,
      from: AX.get(r.oldIssueId)?.q, r: r.reason,
      cand: r.newIssueId ? AX.get(r.newIssueId)?.q : '',
    });
  }
  head(ws2, dels.length + 1);

  // ── צירים שייעלמו ──
  const cur = new Map<string, number>();
  for (const r of db.prepare('SELECT issue_id, COUNT(*) AS n FROM bill_political_classification GROUP BY issue_id').all() as Array<{ issue_id: string; n: number }>)
    cur.set(r.issue_id, r.n);
  const after = new Map(cur);
  for (const r of dels) after.set(r.oldIssueId, (after.get(r.oldIssueId) ?? 0) - 1);
  for (const r of moves) {
    after.set(r.oldIssueId, (after.get(r.oldIssueId) ?? 0) - 1);
    after.set(r.newIssueId!, (after.get(r.newIssueId!) ?? 0) + 1);
  }
  const vanish = [...AX].filter(([id]) =>
    (cur.get(id) ?? 0) >= MIN_BILLS_PER_ISSUE && (after.get(id) ?? 0) < MIN_BILLS_PER_ISSUE);

  const ws3 = wb.addWorksheet(`צירים שייעלמו (${vanish.length})`, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws3.columns = [
    { header: 'החלטה', key: 'd', width: 12 }, { header: 'הציר', key: 'q', width: 60 },
    { header: 'אשכול', key: 'cl', width: 26 },
    { header: 'הצעות היום', key: 'a', width: 12 }, { header: 'אחרי', key: 'b', width: 10 },
    { header: 'הסף', key: 'm', width: 8 },
  ];
  for (const [id, a] of vanish.sort((x, y) => (cur.get(y[0]) ?? 0) - (cur.get(x[0]) ?? 0)))
    ws3.addRow({ d: '', q: a.q, cl: a.cluster, a: cur.get(id) ?? 0, b: after.get(id) ?? 0, m: MIN_BILLS_PER_ISSUE });
  head(ws3, vanish.length + 1);

  // ── זוכו ──
  const ws4 = wb.addWorksheet(`זוכו (${kept.length})`, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws4.columns = [
    { header: 'מזהה', key: 'id', width: 11 }, { header: 'כותרת', key: 't', width: 50 },
    { header: 'הציר שנשאר', key: 'q', width: 50 }, { header: 'נימוק', key: 'y', width: 50 },
  ];
  for (const r of kept) ws4.addRow({ id: r.billId, t: bill(r.billId).title, q: AX.get(r.oldIssueId)?.q, y: r.why });
  head(ws4, kept.length + 1);

  let written = OUT;
  try { await wb.xlsx.writeFile(OUT); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EBUSY') throw e;
    written = OUT.replace(/\.xlsx$/, '-חדש.xlsx');
    await wb.xlsx.writeFile(written);
    console.log(`⚠ הקובץ פתוח באקסל. נכתב במקומו: ${path.basename(written)}\n`);
  }
  console.log(`נכתב: ${path.basename(written)}`);
  console.log(`  מעברים        : ${moves.length}`);
  console.log(`  מחיקות        : ${dels.length}`);
  console.log(`  צירים שייעלמו : ${vanish.length}`);
  console.log(`  זוכו          : ${kept.length}`);
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
