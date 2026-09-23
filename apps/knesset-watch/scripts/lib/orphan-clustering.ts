/**
 * האשכול של ההצעות היתומות, משותף לשלב 1 (מדידה) ולשלב 2 (ניסוח צירים).
 *
 * שני השלבים חייבים לראות בדיוק את אותם אשכולות. אילו כל אחד היה
 * מחשב לעצמו, שינוי קטן בסף או בשאילתה היה מייצר אשכולות שונים ושלב 2
 * היה מנסח צירים לקבוצות שמעולם לא נמדדו.
 */

import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const CACHE_FILE = path.join(process.cwd(), '.embed-cache.json');
const DIMS = 256;

/** הסף שנבחר אחרי המדידה: 72 אשכולות בגודל 5+, הגדול 78 */
export const THRESHOLD = 0.70;
/** אשכול קטן מזה אינו מצדיק ציר משלו */
export const MIN_CLUSTER = 5;

export interface OrphanRow {
  billId: number;
  title: string;
  domain: string;
  /** תוכן העמדה — זה מה שמאשכלים עליו, לא issue_candidate */
  text: string;
}

const cache: Record<string, number[]> = fs.existsSync(CACHE_FILE)
  ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
  : {};

function jinaKey(): string {
  for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
    if (line.startsWith('JINA_API_KEY=')) return line.slice('JINA_API_KEY='.length).trim();
  }
  throw new Error('אין JINA_API_KEY ב-.env.local');
}

export async function embedAll(texts: string[], label: string): Promise<Array<number[] | null>> {
  const need = [...new Set(texts.filter(t => t && !cache[t]))];
  if (!need.length) { console.log(`  ${label}: הכול בקאש`); return texts.map(t => cache[t] ?? null); }

  const key = jinaKey();
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < need.length; i += 24) {
    /*
      הקיצוץ על העותק הנשלח בלבד, והקאש תחת המפתח המלא. בגרסה קודמת
      נשמר תחת המפתח החתוך, וכל טקסט ארוך מ-700 תווים חזר null ודולג
      בשקט — עשר הצעות אבדו ככה, והתגלה רק כי המאזן לא הסתדר.
    */
    const keys = need.slice(i, i + 24);
    const batch = keys.map(t => t.slice(0, 700));
    let ok = false;
    for (let attempt = 0; attempt < 6 && !ok; attempt++) {
      const res = await fetch('https://api.jina.ai/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
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
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
      ok = true;
    }
    if (!ok) throw new Error(`${label}: מגבלת הקצב לא התפנתה`);
    process.stdout.write(`\r  ${label}: ${Math.min(i + 24, need.length)}/${need.length} חדשים        `);
    await sleep(2_000);
  }
  process.stdout.write('\n');
  return texts.map(t => cache[t] ?? null);
}

/**
 * הצעה שנותחה, אין לה שום שיוך לציר, ויש לה יוזם מזוהה. בלי יוזם היא
 * אינה משפיעה על שום דירוג ואין טעם לשלם על הטמעה שלה.
 */
export function loadOrphans(db: Database.Database): OrphanRow[] {
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
    ORDER BY i.bill_id`).all() as OrphanRow[];
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/**
 * אשכול מנהיג: הפריט הצפוף ביותר שטרם שויך פותח אשכול, וכל מי שדומה
 * לו מעל הסף מצטרף.
 *
 * לא רכיבי קשירות — שם שרשרת של דמיונות בינוניים מחברת שני נושאים
 * רחוקים דרך חוליה אחת, והתוצאה אשכול ענק חסר משמעות.
 */
export function cluster(vecs: number[][], threshold: number): number[][] {
  const n = vecs.length;
  const density = vecs.map((v, i) => {
    let s = 0;
    for (let j = 0; j < n; j++) if (i !== j && cosine(v, vecs[j]) > threshold) s++;
    return { i, s };
  }).sort((a, b) => b.s - a.s || a.i - b.i);

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

/** האשכולות בסף שנבחר, ממוינים מהגדול לקטן, עם הדילוגים מדווחים */
export async function buildClusters(db: Database.Database): Promise<{
  kept: OrphanRow[]; groups: number[][]; skipped: OrphanRow[];
}> {
  const rows = loadOrphans(db);
  const raw = await embedAll(rows.map(r => r.text), 'עמדות');
  const kept: OrphanRow[] = [], vecs: number[][] = [], skipped: OrphanRow[] = [];
  rows.forEach((r, i) => {
    const v = raw[i];
    if (v) { kept.push(r); vecs.push(v); } else skipped.push(r);
  });
  const groups = cluster(vecs, THRESHOLD).sort((a, b) => b.length - a.length);
  return { kept, groups, skipped };
}
