/**
 * כמה מהסוגיות היתומות אפשר להחזיר, ובאיזה מחיר.
 *
 * 2,076 הצעות חוק עם יוזם אינן מסווגות לאף סוגיה בשאלון, ולכן כל אחת
 * מהן היא אפס שאולי אינו מוצדק. שתי הסיבות שנמצאו הן למעשה אחת:
 *
 *   review_required   1,615 שורות. כולן classification_confidence=low,
 *                     ואצל 64% מהן canonical_issue_name זהה ל-raw_issue
 *                     ו-cluster_size=1 — כלומר הסוגיה לא התאחדה עם
 *                     כלום ונשארה אשכול של אחד.
 *
 *   no orientation    1,324 שורות ב-856 סוגיות. גם הן ספציפיות מדי
 *                     מכדי שחולץ להן ציר: "גמול לחברי מועצה ברשויות
 *                     מקומיות", "מקומות חניה לנשים בהריון".
 *
 * שתיהן יתומות מאותה סיבה: הן ספציפיות מדי. אבל הן אינן חסרות בית —
 * "החמרת ענישה על תקיפת עורכי דין" שייכת לציר "האם להחמיר ענישה?"
 * שכבר קיים. הסקריפט מודד כמה מהן נופלות קרוב מספיק לציר קיים.
 *
 * הוא אינו כותב דבר. הוא מודד, כדי שאפשר יהיה להחליט אם השיטה עובדת
 * לפני שמשקיעים בה.
 *
 *   npx tsx scripts/measure-orphan-issues.ts            מדגם של 150
 *   npx tsx scripts/measure-orphan-issues.ts --all      הכול (יקר)
 */

import fs from 'fs';
import path from 'path';
import { CLUSTERS } from '../src/lib/axis-clusters';

const DATA = path.join(process.cwd(), 'data/policy-analysis');
const MAPPING = path.join(DATA, 'canonical/bill-issue-mapping.jsonl');
const ORIENT = path.join(DATA, 'canonical-orientation.jsonl');

const DIMS = 256;
const SAMPLE = process.argv.includes('--all') ? Infinity : 150;

const key = (() => {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    if (line.startsWith('JINA_API_KEY=')) return line.slice('JINA_API_KEY='.length).trim();
  }
  throw new Error('אין JINA_API_KEY');
})();

const readJsonl = (p: string) =>
  fs.readFileSync(p, 'utf8').trim().split('\n')
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean) as Array<Record<string, unknown>>;

/** Jina מקבל אצווה. 64 בכל קריאה מספיק ולא חורג מהמגבלות. */
async function embedAll(texts: string[]): Promise<Array<number[] | null>> {
  const out: Array<number[] | null> = [];
  for (let i = 0; i < texts.length; i += 64) {
    const batch = texts.slice(i, i + 64);
    const res = await fetch('https://api.jina.ai/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'jina-embeddings-v3', input: batch, dimensions: DIMS }),
    });
    if (!res.ok) throw new Error(`Jina ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const data = await res.json() as { data?: Array<{ embedding?: number[] }> };
    for (const d of data.data ?? []) out.push(d.embedding ?? null);
    process.stdout.write(`\r  הוטמעו ${Math.min(i + 64, texts.length)}/${texts.length}`);
  }
  process.stdout.write('\n');
  return out;
}

const cos = (a: number[], b: number[]) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
};

async function main() {
  const mapping = readJsonl(MAPPING);
  const orientIds = new Set(readJsonl(ORIENT).map(o => o.canonical_issue_id));

  // היתומות: או סומנו לבדיקה, או שאין לסוגיה שלהן ציר
  const orphans = mapping.filter(m => m.review_required || !orientIds.has(m.canonical_issue_id));
  const uniq = new Map<string, { text: string; bills: Set<number> }>();
  for (const m of orphans) {
    const t = String(m.raw_issue ?? '').trim();
    if (!t) continue;
    if (!uniq.has(t)) uniq.set(t, { text: t, bills: new Set() });
    uniq.get(t)!.bills.add(Number(m.bill_id));
  }

  const all = [...uniq.values()].sort((a, b) => b.bills.size - a.bills.size);
  const chosen = all.slice(0, SAMPLE === Infinity ? all.length : SAMPLE);

  console.log(`סוגיות יתומות ייחודיות : ${all.length.toLocaleString()}`);
  console.log(`הצעות חוק מעורבות      : ${new Set(orphans.map(m => m.bill_id)).size.toLocaleString()}`);
  console.log(`נמדדות כאן             : ${chosen.length.toLocaleString()}\n`);

  const axes = CLUSTERS.flatMap(c => c.questions.map(q => ({ id: q.issueId, q: q.question, kw: q.keyword })));
  console.log(`צירים קיימים: ${axes.length}\n`);

  console.log('מטמיע את הצירים...');
  const axisVecs = await embedAll(axes.map(a => `${a.q} ${a.kw}`));
  console.log('מטמיע את היתומות...');
  const orphanVecs = await embedAll(chosen.map(o => o.text));

  const matches = chosen.map((o, i) => {
    const v = orphanVecs[i];
    if (!v) return null;
    let best = { score: -1, axis: axes[0] };
    for (let j = 0; j < axes.length; j++) {
      const av = axisVecs[j];
      if (!av) continue;
      const s = cos(v, av);
      if (s > best.score) best = { score: s, axis: axes[j] };
    }
    return { orphan: o, ...best };
  }).filter(Boolean) as Array<{ orphan: { text: string; bills: Set<number> }; score: number; axis: { id: string; q: string } }>;

  console.log('\n═══ כמה נופלות קרוב לציר קיים ═══');
  console.log(`  ${'סף'.padStart(5)}  ${'סוגיות'.padStart(7)}  ${'הצעות חוק'.padStart(10)}`);
  for (const t of [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8]) {
    const hit = matches.filter(m => m.score >= t);
    const bills = new Set(hit.flatMap(m => [...m.orphan.bills])).size;
    const bar = '█'.repeat(Math.round((hit.length / matches.length) * 30));
    console.log(`  ${t.toFixed(2).padStart(5)}  ${String(hit.length).padStart(7)}  ${String(bills).padStart(10)}  ${bar}`);
  }

  const sorted = [...matches].sort((a, b) => b.score - a.score);
  console.log('\n═══ ההתאמות הטובות ביותר ═══');
  for (const m of sorted.slice(0, 8)) {
    console.log(`\n  ${m.score.toFixed(3)}  ${m.orphan.text.slice(0, 52)}  (${m.orphan.bills.size} הצעות)`);
    console.log(`         → ${m.axis.q.slice(0, 56)}`);
  }

  console.log('\n═══ סביב הסף 0.6 — כאן ההחלטה ═══');
  const border = sorted.filter(m => m.score >= 0.57 && m.score <= 0.63).slice(0, 6);
  for (const m of border) {
    console.log(`\n  ${m.score.toFixed(3)}  ${m.orphan.text.slice(0, 52)}`);
    console.log(`         → ${m.axis.q.slice(0, 56)}`);
  }

  console.log('\n═══ הגרועות — אלה שאין להן בית ═══');
  for (const m of sorted.slice(-4)) {
    console.log(`\n  ${m.score.toFixed(3)}  ${m.orphan.text.slice(0, 52)}`);
    console.log(`         → ${m.axis.q.slice(0, 56)}`);
  }
}

main();
