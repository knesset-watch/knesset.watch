/**
 * שלב 1: אשכול ההצעות שאין להן ציר — כמה צירים חדשים בכלל צריך?
 *
 * הסקריפט הזה אינו כותב כלום. הוא מודד, כדי שנדע אם 1,478 ההצעות
 * מתפרקות ל-80 אשכולות סבירים או ל-400 אשכולות של שלוש הצעות. רק
 * לפי התשובה אפשר להחליט אם שלב 2 שווה את המאמץ.
 *
 * ── על מה מאשכלים ────────────────────────────────────────────────────
 *
 * על תוכן העמדות: policy_change + pro_stance + con_stance.
 *
 * זו הנקודה שהכשילה את הניסיון הקודם. שם האשכול רץ על issue_candidate,
 * שהוא ספציפי להפליא — "הסדרת שעות הפעילות של גני ילדים ברשות X".
 * שני טקסטים כאלה כמעט לעולם אינם דומים זה לזה, ולכן כל אשכול יצא
 * בגודל 1 והמסקנה הייתה שאין מה לאשכל.
 *
 * תוכן העמדות לעומת זאת הוא המחלוקת הפוליטית עצמה — "האם להרחיב את
 * מעורבות המדינה במימון X" — וזה חוזר על עצמו בין הצעות שונות לגמרי.
 *
 * ── מה נחשב "יתומה" ──────────────────────────────────────────────────
 *
 * הצעה שנותחה, אין לה שום שיוך לציר, ויש לה יוזם מזוהה. בלי יוזם היא
 * אינה משפיעה על שום דירוג, ולכן אין טעם לשלם על הטמעה שלה.
 *
 *   npx tsx scripts/cluster-orphan-bills.ts
 *   npx tsx scripts/cluster-orphan-bills.ts --csv    גם קובץ לעיון
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const CACHE = path.join(process.cwd(), '.embed-cache.json');
const OUT = path.join(process.cwd(), 'orphan-clusters.csv');
const DIMS = 256;
const asCsv = process.argv.includes('--csv');

/** ספים שנבדקים; הדוח מציג את כולם כדי שהבחירה תהיה על בסיס מספרים */
const THRESHOLDS = [0.60, 0.65, 0.70, 0.75, 0.80];
/** אשכול קטן מזה אינו מצדיק ציר משלו */
const MIN_CLUSTER = 5;

const jinaKey = (() => {
  for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
    if (line.startsWith('JINA_API_KEY=')) return line.slice('JINA_API_KEY='.length).trim();
  }
  throw new Error('אין JINA_API_KEY ב-.env.local');
})();

const cache: Record<string, number[]> = fs.existsSync(CACHE)
  ? JSON.parse(fs.readFileSync(CACHE, 'utf8'))
  : {};

async function embedAll(texts: string[], label: string): Promise<Array<number[] | null>> {
  const need = [...new Set(texts.filter(t => t && !cache[t]))];
  if (!need.length) { console.log(`  ${label}: הכול בקאש`); return texts.map(t => cache[t] ?? null); }

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < need.length; i += 24) {
    /*
      הקיצוץ על העותק הנשלח בלבד, והקאש תחת המפתח המלא. בגרסה קודמת
      נשמר תחת המפתח החתוך, וכל טקסט ארוך מ-700 תווים חזר null ודולג
      בשקט — עשר הצעות אבדו ככה.
    */
    const keys = need.slice(i, i + 24);
    const batch = keys.map(t => t.slice(0, 700));
    let ok = false;
    for (let attempt = 0; attempt < 6 && !ok; attempt++) {
      const res = await fetch('https://api.jina.ai/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jinaKey}` },
        body: JSON.stringify({ model: 'jina-embeddings-v3', input: batch, dimensions: DIMS }),
      });
      if (res.status === 429) {
        const wait = 15_000 * (attempt + 1);
        process.stdout.write(`\r  ${label}: מגבלת קצב, ממתין ${wait / 1000}ש...        `);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`Jina ${res.status}: ${(await res.text()).slice(0, 160)}`);
      const data = await res.json() as { data?: Array<{ embedding?: number[] }> };
      (data.data ?? []).forEach((d, j) => { if (d.embedding) cache[keys[j]] = d.embedding; });
      fs.writeFileSync(CACHE, JSON.stringify(cache));
      ok = true;
    }
    if (!ok) throw new Error(`${label}: מגבלת הקצב לא התפנתה`);
    process.stdout.write(`\r  ${label}: ${Math.min(i + 24, need.length)}/${need.length} חדשים        `);
    await sleep(2_000);
  }
  process.stdout.write('\n');
  return texts.map(t => cache[t] ?? null);
}

interface Row { billId: number; title: string; domain: string; text: string }

function loadOrphans(db: Database.Database): Row[] {
  return db.prepare(`
    SELECT i.bill_id AS billId, b.title AS title,
           COALESCE(NULLIF(TRIM(i.domain_candidate),''),'(ללא תחום)') AS domain,
           TRIM(COALESCE(i.policy_change,'') || ' ' || COALESCE(i.pro_stance,'')
                || ' ' || COALESCE(i.con_stance,'')) AS text
    FROM bill_policy_issue i
    JOIN bill b ON b.id = i.bill_id
    WHERE NOT EXISTS (SELECT 1 FROM bill_political_classification c WHERE c.bill_id = i.bill_id)
      AND EXISTS (SELECT 1 FROM bill_initiator bi WHERE bi.bill_id = i.bill_id)
      AND LENGTH(TRIM(COALESCE(i.policy_change,''))) > 20
    GROUP BY i.bill_id
    ORDER BY i.bill_id`).all() as Row[];
}

/** קוסינוס על וקטורים שאינם מנורמלים מראש */
function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/**
 * אשכול מנהיג: הפריט הצפוף ביותר שטרם שויך פותח אשכול, וכל מי שדומה
 * לו מעל הסף מצטרף.
 *
 * לא רכיבי קשירות — שם שרשרת של דמיונות בינוניים מחברת שני נושאים
 * רחוקים דרך חוליה אחת, והתוצאה היא אשכול ענק חסר משמעות. כאן כל
 * חבר נמדד מול המנהיג עצמו.
 */
function cluster(vecs: number[][], threshold: number): number[][] {
  const n = vecs.length;
  const density = vecs.map((v, i) => {
    let s = 0;
    for (let j = 0; j < n; j++) if (i !== j) { const c = cosine(v, vecs[j]); if (c > threshold) s++; }
    return { i, s };
  }).sort((a, b) => b.s - a.s);

  const taken = new Array<boolean>(n).fill(false);
  const out: number[][] = [];
  for (const { i } of density) {
    if (taken[i]) continue;
    const members = [i];
    taken[i] = true;
    for (let j = 0; j < n; j++) {
      if (taken[j] || j === i) continue;
      if (cosine(vecs[i], vecs[j]) > threshold) { members.push(j); taken[j] = true; }
    }
    out.push(members);
  }
  return out;
}

async function main(): Promise<void> {
  const db = new Database(DB_PATH, { readonly: true });
  const rows = loadOrphans(db);
  console.log(`הצעות יתומות עם יוזם ועם טקסט עמדה: ${rows.length}\n`);

  const vecsRaw = await embedAll(rows.map(r => r.text), 'עמדות');

  /*
    כל שורה שלא קיבלה וקטור מדווחת. הסקריפט הקודם דילג עליהן בשקט,
    וזה מה שהסתיר את אובדן עשר ההצעות.
  */
  const kept: Row[] = [], vecs: number[][] = [], skipped: Row[] = [];
  rows.forEach((r, i) => {
    const v = vecsRaw[i];
    if (v) { kept.push(r); vecs.push(v); } else skipped.push(r);
  });
  if (skipped.length) {
    console.log(`\n⚠ ${skipped.length} הצעות ללא וקטור ולכן מחוץ לניתוח:`);
    for (const s of skipped.slice(0, 10)) console.log(`    ${s.billId}  ${s.title.slice(0, 54)}`);
  }
  console.log(`\nנכנסו לניתוח: ${kept.length}\n`);

  console.log('═══ כמה אשכולות יוצאים בכל סף ═══');
  console.log(`  ${'סף'.padEnd(6)} ${'אשכולות'.padStart(8)} ${`בגודל ${MIN_CLUSTER}+`.padStart(10)} ` +
              `${'הצעות מכוסות'.padStart(13)} ${'בודדות'.padStart(8)} ${'הגדול'.padStart(7)}`);

  let best: { t: number; groups: number[][] } | null = null;
  for (const t of THRESHOLDS) {
    const groups = cluster(vecs, t);
    const big = groups.filter(g => g.length >= MIN_CLUSTER);
    const covered = big.reduce((s, g) => s + g.length, 0);
    const singles = groups.filter(g => g.length === 1).length;
    const largest = Math.max(...groups.map(g => g.length));
    console.log(`  ${t.toFixed(2).padEnd(6)} ${String(groups.length).padStart(8)} ${String(big.length).padStart(10)} ` +
                `${`${covered} (${Math.round(covered / kept.length * 100)}%)`.padStart(13)} ${String(singles).padStart(8)} ${String(largest).padStart(7)}`);
    if (t === 0.70) best = { t, groups };
  }

  if (!best) { db.close(); return; }

  console.log(`\n═══ האשכולות הגדולים בסף ${best.t} ═══`);
  const big = best.groups.filter(g => g.length >= MIN_CLUSTER).sort((a, b) => b.length - a.length);
  for (const g of big.slice(0, 15)) {
    const domains = new Map<string, number>();
    for (const i of g) domains.set(kept[i].domain, (domains.get(kept[i].domain) ?? 0) + 1);
    const top = [...domains].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d, c]) => `${d}×${c}`).join(', ');
    console.log(`\n  ${g.length} הצעות · ${top}`);
    for (const i of g.slice(0, 3)) console.log(`      ${kept[i].title.slice(0, 60)}`);
  }

  if (asCsv) {
    const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
    const lines = [['cluster', 'גודל', 'bill_id', 'כותרת', 'תחום', 'תוכן העמדה'].map(esc).join(',')];
    best.groups.forEach((g, ci) => {
      for (const i of g) {
        lines.push([String(ci), String(g.length), String(kept[i].billId),
          kept[i].title, kept[i].domain, kept[i].text.slice(0, 300)].map(esc).join(','));
      }
    });
    fs.writeFileSync(OUT, '﻿' + lines.join('\n') + '\n');
    console.log(`\nנכתב: ${path.basename(OUT)}`);
  }

  console.log('\nהסקריפט לא כתב דבר למסד ולא שינה אף ציר.');
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
