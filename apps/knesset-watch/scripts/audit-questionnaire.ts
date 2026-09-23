/**
 * בדיקת מהימנות לשאלון.
 *
 * הדירוג נשען על שרשרת: השאלה → העמדה שנבחרה → הצעות החוק שסווגו
 * לאותה סוגיה → מי יזם אותן. כל חוליה יכולה להישבר בנפרד, ודגימה של
 * תוצאה סופית אינה מגלה איזו מהן נשברה. לכן הסקריפט בודק כל חוליה
 * בנפרד ומחזיר מספרים, לא התרשמות.
 *
 * שלוש בדיקות:
 *
 *   היפוך    אותה סוגיה, שתי העמדות ההפוכות. אם אותם ח"כים עולים
 *            בשתיהן, הציר אינו מבדיל, והדירוג מודד "מי עסק בנושא"
 *            ולא "מי מסכים איתך". זו הבדיקה החשובה ביותר: היא זו
 *            שיכולה להפוך את כל הפיצ'ר לחסר משמעות בלי שייראה שבור.
 *
 *   ייחודיות  שמונת נושאי-העל, כל אחד בנפרד. אם אותם שמות עולים בכל
 *            נושא, הדירוג מודד פעילות כללית ולא התאמה נושאית.
 *
 *   כיסוי    כמה סוגיות בכלל מסוגלות לדרג לפי עמדה. סוגיה ללא
 *            stanceAware מחזירה את אותה תוצאה לשתי העמדות מעצם
 *            הבנייה, ואין טעם לספור אותה ככישלון של הציר.
 *
 * הרצה:
 *   npx tsx scripts/audit-questionnaire.ts            דוח מלא
 *   npx tsx scripts/audit-questionnaire.ts --top 10   עומק אחר
 *   npx tsx scripts/audit-questionnaire.ts --json     פלט לקובץ
 */

import fs from 'fs';
import path from 'path';
import { CLUSTERS, CLUSTER_TOPICS } from '../src/lib/axis-clusters';
import { computeAgendaActivity, type AgendaSelection } from '../src/lib/agenda-activity';

const TOP = (() => {
  const i = process.argv.indexOf('--top');
  return i > 0 ? Number(process.argv[i + 1]) || 5 : 5;
})();
const AS_JSON = process.argv.includes('--json');

const pct = (n: number, of: number) => (of === 0 ? '—' : `${Math.round((n / of) * 100)}%`);

interface IssueResult {
  issueId: string;
  question: string;
  topic: string;
  stanceAware: boolean;
  belowThreshold: boolean;
  activeMks: number;
  proTop: string[];
  conTop: string[];
  /** כמה מהחמישייה משותפים לשתי העמדות */
  overlap: number;
}

function topNames(selections: AgendaSelection[]): { names: string[]; stanceAware: boolean; belowThreshold: boolean; activeMks: number } {
  const r = computeAgendaActivity(selections);
  const cov = r.coverage[0];
  return {
    names: r.rows.slice(0, TOP).map(row => row.name),
    stanceAware: cov?.stanceAware ?? false,
    belowThreshold: cov?.belowThreshold ?? true,
    activeMks: cov?.activeMks ?? 0,
  };
}

// ── בדיקה 1: היפוך ─────────────────────────────────────────────────────
function inversionTest(): IssueResult[] {
  const out: IssueResult[] = [];
  for (const cluster of CLUSTERS) {
    for (const q of cluster.questions) {
      if (q.stances.length < 2) continue;
      const pro = topNames([{ issueId: q.issueId, stanceId: q.stances[0].id }]);
      const con = topNames([{ issueId: q.issueId, stanceId: q.stances[1].id }]);
      const shared = pro.names.filter(n => con.names.includes(n));
      out.push({
        issueId: q.issueId,
        question: q.question,
        topic: cluster.topic,
        stanceAware: pro.stanceAware,
        belowThreshold: pro.belowThreshold,
        activeMks: pro.activeMks,
        proTop: pro.names,
        conTop: con.names,
        overlap: shared.length,
      });
    }
  }
  return out;
}

// ── בדיקה 2: ייחודיות בין נושאים ───────────────────────────────────────
function distinctnessTest(): Array<{ topic: string; top: string[] }> {
  return CLUSTER_TOPICS.map(t => {
    const selections: AgendaSelection[] = t.clusters
      .flatMap(c => c.questions)
      .map(q => ({ issueId: q.issueId, stanceId: q.stances[0]?.id }));
    const r = computeAgendaActivity(selections);
    return { topic: t.label, top: r.rows.slice(0, TOP).map(row => row.name) };
  });
}

function main(): void {
  console.log('בדיקת מהימנות — שאלון ההתאמה');
  console.log(`עומק ההשוואה: ${TOP} ח"כים ראשונים\n`);

  // ── היפוך ──
  const inv = inversionTest();
  const usable = inv.filter(r => r.stanceAware && !r.belowThreshold);
  const identical = usable.filter(r => r.overlap === TOP);
  const majority = usable.filter(r => r.overlap >= Math.ceil(TOP * 0.6));
  const clean = usable.filter(r => r.overlap <= 1);

  console.log('═══ 1. היפוך עמדה ═══');
  console.log(`  סוגיות בסך הכול        : ${inv.length}`);
  console.log(`  מודעות לעמדה ומעל הסף  : ${usable.length}  (${pct(usable.length, inv.length)})`);
  console.log(`  לא מודעות לעמדה        : ${inv.filter(r => !r.stanceAware).length}`);
  console.log(`  מתחת לסף               : ${inv.filter(r => r.belowThreshold).length}`);
  if (usable.length) {
    console.log('');
    console.log(`  זהות לחלוטין (${TOP}/${TOP})    : ${identical.length}  (${pct(identical.length, usable.length)})  ← הציר אינו מבדיל`);
    console.log(`  חפיפת רוב              : ${majority.length}  (${pct(majority.length, usable.length)})`);
    console.log(`  מבדילות היטב (0-1)     : ${clean.length}  (${pct(clean.length, usable.length)})`);

    const avg = usable.reduce((a, r) => a + r.overlap, 0) / usable.length;
    console.log(`  חפיפה ממוצעת           : ${avg.toFixed(2)} מתוך ${TOP}`);

    if (identical.length) {
      console.log('\n  ── דוגמאות שבהן שתי העמדות מחזירות בדיוק אותם שמות ──');
      for (const r of identical.slice(0, 5)) {
        console.log(`\n    ${r.question}`);
        console.log(`      ${r.topic} · ${r.activeMks} ח"כים פעילים`);
        console.log(`      שני הצדדים: ${r.proTop.join(', ')}`);
      }
    }
    if (clean.length) {
      console.log('\n  ── דוגמאות שבהן הציר כן מבדיל ──');
      for (const r of clean.slice(0, 3)) {
        console.log(`\n    ${r.question}`);
        console.log(`      בעד : ${r.proTop.join(', ')}`);
        console.log(`      נגד : ${r.conTop.join(', ')}`);
      }
    }
  }

  // ── ייחודיות ──
  console.log('\n\n═══ 2. ייחודיות בין נושאים ═══');
  const dist = distinctnessTest();
  const seen = new Map<string, number>();
  for (const d of dist) for (const n of d.top) seen.set(n, (seen.get(n) ?? 0) + 1);
  const everywhere = [...seen.entries()].filter(([, n]) => n >= dist.length - 1).sort((a, b) => b[1] - a[1]);

  for (const d of dist) console.log(`  ${d.topic}\n      ${d.top.join(', ')}`);
  console.log('');
  console.log(`  שמות שונים בסך הכול : ${seen.size} (מתוך ${dist.length * TOP} מקומות)`);
  if (everywhere.length) {
    console.log(`  מופיעים כמעט בכל נושא:`);
    for (const [name, n] of everywhere) console.log(`      ${name} — ב-${n} מתוך ${dist.length}`);
    console.log('      ← הדירוג עשוי למדוד פעילות כללית ולא התאמה נושאית');
  } else {
    console.log('  אף שם אינו חוזר כמעט בכל הנושאים ✓');
  }

  // ── מה לעשות עם זה ──
  console.log('\n\n═══ 3. מה המספרים אומרים ═══');
  const badShare = usable.length ? identical.length / usable.length : 0;
  if (usable.length === 0) {
    console.log('  אף סוגיה אינה מדרגת לפי עמדה. השאלון שואל על עמדה ומדרג לפי עיסוק.');
  } else if (badShare > 0.5) {
    console.log(`  ברוב הסוגיות (${pct(identical.length, usable.length)}) העמדה אינה משנה את התוצאה.`);
    console.log('  המשמעות: התוצאה עונה על "מי עוסק בנושא" ולא על "מי מסכים איתי",');
    console.log('  וכך צריך גם להציג אותה למשתמשת.');
  } else if (badShare > 0.2) {
    console.log(`  בחלק מהסוגיות (${pct(identical.length, usable.length)}) העמדה אינה משנה את התוצאה.`);
    console.log('  כדאי לסמן את הסוגיות האלה בתצוגה במקום להציג אותן כהתאמה.');
  } else {
    console.log('  הציר מבדיל ברוב הסוגיות. הדירוג אכן מגיב לעמדה שנבחרה.');
  }

  if (AS_JSON) {
    const out = path.join(process.cwd(), 'audit-questionnaire.json');
    fs.writeFileSync(out, JSON.stringify({ top: TOP, inversion: inv, distinctness: dist }, null, 1));
    console.log(`\nנשמר: ${path.basename(out)}`);
  }
}

main();
