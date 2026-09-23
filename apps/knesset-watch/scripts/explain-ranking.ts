/**
 * למה ח"כ א' דורג מעל ח"כ ב'.
 *
 * הכרטיס בתוצאות מציג סכומים — "12 הצעות חוק שיזם · 10 הצבעות תומכות"
 * — אבל הציון אינו מחושב מהם. הוא ממוצע של אחוזונים, אג'נדה אחר
 * אג'נדה, וזה יכול להפוך את הסדר: מי שחזק מאוד באג'נדה אחת ונעדר
 * מאחרת יכול לדורג מתחת למי שבינוני בשתיהן.
 *
 * הסקריפט מפרק את הפער לשני שמות ומראה איפה בדיוק הוא נוצר.
 *
 * הרצה:
 *   npx tsx scripts/explain-ranking.ts "מרב מיכאלי" "אחמד טיבי" --topic "עבודה"
 *   npx tsx scripts/explain-ranking.ts "שם א" "שם ב" --issues ax_1,ax_2
 */

import { CLUSTERS, CLUSTER_TOPICS } from '../src/lib/axis-clusters';
import { computeAgendaActivity, type AgendaSelection } from '../src/lib/agenda-activity';

const args = process.argv.slice(2);
const names = args.filter(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
const topicArg = (() => { const i = args.indexOf('--topic'); return i > 0 ? args[i + 1] : null; })();
const issuesArg = (() => { const i = args.indexOf('--issues'); return i > 0 ? args[i + 1] : null; })();

if (names.length < 2) {
  console.error('צריך שני שמות. דוגמה:');
  console.error('  npx tsx scripts/explain-ranking.ts "מרב מיכאלי" "אחמד טיבי" --topic "עבודה"');
  process.exit(1);
}
const [nameA, nameB] = names;

// ── מה נבחר ───────────────────────────────────────────────────────────
let selections: AgendaSelection[];
let selectionLabel: string;

if (issuesArg) {
  const ids = issuesArg.split(',').map(s => s.trim());
  const all = CLUSTERS.flatMap(c => c.questions);
  selections = ids.map(id => {
    const q = all.find(x => x.issueId === id);
    return { issueId: id, stanceId: q?.stances[0]?.id };
  });
  selectionLabel = `${ids.length} סוגיות שצוינו`;
} else {
  const topic = CLUSTER_TOPICS.find(t => t.label.includes(topicArg ?? '')) ?? CLUSTER_TOPICS[0];
  selections = topic.clusters.flatMap(c => c.questions).map(q => ({
    issueId: q.issueId,
    stanceId: q.stances[0]?.id,
  }));
  selectionLabel = topic.label;
}

console.log(`נושא שנבחר : ${selectionLabel}`);
console.log(`סוגיות      : ${selections.length}`);
console.log(`המחלק בציון : ${selections.length}  (overallScore = סכום ÷ מספר הסוגיות)\n`);

const result = computeAgendaActivity(selections);
const find = (n: string) => result.rows.find(r => r.name.includes(n));
const a = find(nameA), b = find(nameB);

if (!a || !b) {
  console.error(`לא נמצא: ${!a ? nameA : nameB}`);
  console.error('חמשת הראשונים:', result.rows.slice(0, 5).map(r => r.name).join(', '));
  process.exit(1);
}

const rank = (r: typeof a) => result.rows.findIndex(x => x.mkId === r.mkId) + 1;

console.log('═══ הסיכומים שמוצגים בכרטיס ═══');
const sums = (r: typeof a) => ({
  bills: r.perAgenda.reduce((s, x) => s + x.billsInitiated, 0),
  votes: r.perAgenda.reduce((s, x) => s + x.supportingVotes, 0),
});
for (const r of [a, b]) {
  const s = sums(r);
  console.log(`  ${String(rank(r)).padStart(2)}. ${r.name.padEnd(16)} ציון ${String(r.overallScore).padStart(5)} | ${s.bills} הצעות · ${s.votes} הצבעות · ביטחון ${r.confidencePercent}%`);
}

console.log('\n═══ ומה באמת נכנס לציון ═══');
console.log('  הציון לכל סוגיה הוא 0.6 × אחוזון-יוזמה + 0.4 × אחוזון-הצבעות.');
console.log('  היוזמה מנורמלת לימי כהונה, ולכן ספירה גולמית אינה מנבאת אותה.\n');

const ids = [...new Set([...a.perAgenda, ...b.perAgenda].map(x => x.issueId))];
const labelOf = new Map(CLUSTERS.flatMap(c => c.questions).map(q => [q.issueId, q.question]));

console.log(`  ${'סוגיה'.padEnd(44)} ${nameA.padEnd(14)} ${nameB}`);
console.log('  ' + '─'.repeat(78));
let sumA = 0, sumB = 0;
for (const id of ids) {
  const xa = a.perAgenda.find(x => x.issueId === id);
  const xb = b.perAgenda.find(x => x.issueId === id);
  sumA += xa?.score ?? 0;
  sumB += xb?.score ?? 0;
  const cell = (x: typeof xa) =>
    x ? `${String(x.score).padStart(5)} (${x.billsInitiated}ח/${x.supportingVotes}ה)` : '    —  נעדר  ';
  const q = (labelOf.get(id) ?? id).slice(0, 42);
  console.log(`  ${q.padEnd(44)} ${cell(xa).padEnd(15)}${cell(xb)}`);
}
console.log('  ' + '─'.repeat(78));
console.log(`  ${'סכום'.padEnd(44)} ${String(sumA.toFixed(1)).padStart(5)}          ${String(sumB.toFixed(1)).padStart(5)}`);
console.log(`  ${`חלקי ${selections.length}`.padEnd(44)} ${String(a.overallScore).padStart(5)}          ${String(b.overallScore).padStart(5)}`);

// ── איפה נוצר הפער ────────────────────────────────────────────────────
console.log('\n═══ איפה נוצר הפער ═══');
const missA = ids.filter(id => !a.perAgenda.some(x => x.issueId === id)).length;
const missB = ids.filter(id => !b.perAgenda.some(x => x.issueId === id)).length;
console.log(`  סוגיות שבהן ${nameA} נעדר/ת לגמרי : ${missA}  (כל אחת נספרת כאפס)`);
console.log(`  סוגיות שבהן ${nameB} נעדר/ת לגמרי : ${missB}`);

const biggest = ids
  .map(id => ({
    id,
    diff: (b.perAgenda.find(x => x.issueId === id)?.score ?? 0) - (a.perAgenda.find(x => x.issueId === id)?.score ?? 0),
  }))
  .sort((x, y) => y.diff - x.diff)
  .slice(0, 3);
if (biggest[0]?.diff > 0) {
  console.log(`\n  הסוגיות שבהן ${nameB} הרוויח/ה הכי הרבה על ${nameA}:`);
  for (const x of biggest) {
    if (x.diff <= 0) continue;
    console.log(`    +${x.diff.toFixed(1)}  ${(labelOf.get(x.id) ?? x.id).slice(0, 52)}`);
  }
}
