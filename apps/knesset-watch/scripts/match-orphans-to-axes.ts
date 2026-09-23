/**
 * התאמת הצעות יתומות לצירים הקיימים, בלי ליצור אף ציר חדש.
 *
 * ── למה זה שונה מההצלה הקודמת ─────────────────────────────────────────
 *
 * ההצלה הקודמת התאימה לפי דמיון הטמעות בסף 0.65. זה החמיץ הצעות
 * שהקשר שלהן לציר מושגי ולא לשוני. דוגמה שנמצאה בבדיקה ידנית:
 * "ברית זוגיות למנועי חיתון" ו"ביטול סמכות שר הפנים על חוקי עזר
 * לפתיחת עסקים בשבת" — שתיהן דת ומדינה מובהקות, לשתיהן יש ציר קיים,
 * ואף אחת לא נתפסה.
 *
 * כאן מודל קורא את ההצעה ואת רשימת הצירים ומחליט. הסיכון נמוך מציר
 * חדש: הכול הולך לצירים שכבר קיימים ונסקרו.
 *
 * ── על המדגם ─────────────────────────────────────────────────────────
 *
 * ברירת המחדל היא מדגם של 100 הצעות, כדי למדוד תשואה לפני שמשלמים
 * על כולן. המדגם שיטתי ולא אקראי — כל הצעה ה-n-ית — כדי שיהיה פרוס
 * על כל טווח המזהים וניתן לשחזור בדיוק.
 *
 * הסקריפט אינו כותב למסד. הפלט הוא JSONL ו-CSV לסקירה.
 *
 *   npx tsx scripts/match-orphans-to-axes.ts            מדגם של 100
 *   npx tsx scripts/match-orphans-to-axes.ts --all      כל היתומות
 *   npx tsx scripts/match-orphans-to-axes.ts --dry-run  מראה את הפרומפט
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { geminiFetch, geminiUrl, DailyQuotaError } from '../src/lib/gemini-fetch';
import { CLUSTERS } from '../src/lib/axis-clusters';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const OUT = path.join(process.cwd(), 'orphan-matches.jsonl');
const CSV = path.join(process.cwd(), 'orphan-matches.csv');

const all = process.argv.includes('--all');
const dryRun = process.argv.includes('--dry-run');
const SAMPLE = 100;
/** כמה הצעות בבקשה אחת. רשימת הצירים נשלחת פעם אחת לכל בקשה. */
const BATCH = 10;

interface Orphan { billId: number; title: string; change: string; domain: string }
interface Match {
  billId: number;
  issueId: string | null;
  side: string | null;
  /** high | medium | low — נשמר כדי שאפשר יהיה לסנן לפיו בשלב ההחלה */
  confidence?: string;
  why?: string;
}

const AXES = CLUSTERS.flatMap(c =>
  c.questions.map(q => ({ id: q.issueId, q: q.question, cluster: c.label })));

function apiKey(): string {
  for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
    if (line.startsWith('GEMINI_API_KEY=')) return line.slice('GEMINI_API_KEY='.length).trim();
  }
  throw new Error('אין GEMINI_API_KEY ב-.env.local');
}

function loadOrphans(db: Database.Database): Orphan[] {
  return db.prepare(`
    SELECT i.bill_id AS billId, b.title AS title,
           COALESCE(i.policy_change,'') AS change,
           COALESCE(NULLIF(TRIM(i.domain_candidate),''),'') AS domain
    FROM bill_policy_issue i JOIN bill b ON b.id = i.bill_id
    WHERE NOT EXISTS (SELECT 1 FROM bill_political_classification c WHERE c.bill_id = i.bill_id)
      AND EXISTS (SELECT 1 FROM bill_initiator bi WHERE bi.bill_id = i.bill_id)
      AND LENGTH(TRIM(COALESCE(i.policy_change,''))) > 20
    GROUP BY i.bill_id ORDER BY i.bill_id`).all() as Orphan[];
}

function buildPrompt(batch: Orphan[]): string {
  const axisList = AXES.map(a => `${a.id} | ${a.q}`).join('\n');
  const billList = batch.map(b =>
    `[${b.billId}] ${b.title}\n     ${b.change.slice(0, 260)}`).join('\n\n');
  return `להלן רשימת צירי מחלוקת פוליטיים הקיימים באתר:

${axisList}

והלן הצעות חוק מהכנסת ה-25 שאינן משויכות לאף ציר:

${billList}

לכל הצעה: האם היא נופלת על אחד הצירים שברשימה?

כללים:
- שייך רק אם ההצעה באמת עוסקת במחלוקת שהציר מתאר. קרבת נושא אינה מספיקה.
- הרבה הצעות הן מנהליות או טכניות ואינן נופלות על שום מחלוקת פוליטית.
  לאלה החזר issueId: null. זו תשובה נכונה ולא כישלון.
- אם שייכת, ציין גם צד: "pro" אם היא מקדמת את עמדה א של הציר, "con" אם את עמדה ב.
- החלט לפי מה שההצעה עושה בפועל, לא לפי מי יזם אותה ולא לפי הכותרת.

שתי שגיאות שכדאי להימנע מהן, שתיהן התאמה לפי מנגנון או תחום במקום
לפי המחלוקת עצמה:

  "הצעת חוק יום לציון המאבק בגזענות" שויכה ל"האם להקים ולממן אירועי
  הנצחה ממלכתיים למורשת קבוצות שונות?" — שתיהן קובעות יום בלוח השנה,
  אבל יום מודעות למאבק בגזענות אינו הנצחת מורשת. התשובה הנכונה: null.

  "המרכז לגביית קנסות (הוספת בתי משפט צבאיים ביו"ש)" שויכה ל"האם
  להרחיב זכויות ופיצויים לנפגעי עבירה?" — ההצעה עוסקת בהרחבת סמכות
  גבייה לאזור, והפיצוי הוא אמצעי ולא הנושא. התשובה הנכונה: null.

לכל התאמה ציין confidence:
  "high"   — המחלוקת שהציר מתאר היא בדיוק מה שההצעה מכריעה בו
  "medium" — שייכת אך לא במרכז הציר
  "low"    — קשר רופף. במקרה כזה עדיף issueId: null

החזר JSON בלבד:
{"matches":[{"billId":123,"issueId":"ax_xxx","side":"pro","confidence":"high","why":"נימוק קצר"},{"billId":124,"issueId":null}]}`;
}

async function askBatch(batch: Orphan[], key: string, label: string): Promise<Match[] | null> {
  const res = await geminiFetch(
    geminiUrl('generateContent', key),
    {
      contents: [{ parts: [{ text: buildPrompt(batch) }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json', maxOutputTokens: 16384 },
    },
    { retries: 0, timeoutMs: 120_000, label },
  );
  if (!res.ok) { console.log(`    ✗ ${res.status}`); return null; }
  const body = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  };
  const cand = body.candidates?.[0];
  if (cand?.finishReason && cand.finishReason !== 'STOP') { console.log(`    ✗ נקטע: ${cand.finishReason}`); return null; }
  const m = ((cand?.content?.parts ?? []).map(p => p.text ?? '').join('')).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const p = JSON.parse(m[0]) as { matches?: Array<Record<string, unknown>> };
    const valid = new Set(AXES.map(a => a.id));
    const ids = new Set(batch.map(b => b.billId));
    /*
      מזהה ציר שאינו קיים ומזהה הצעה שלא נשלחה — שניהם נפסלים. מודל
      שממציא מזהה הוא תרחיש אמיתי, ושורה כזו הייתה נכתבת למסד בלי
      שאף ציר יציג אותה.
    */
    return (p.matches ?? []).flatMap(r => {
      const billId = Number(r.billId);
      if (!ids.has(billId)) return [];
      const issueId = r.issueId ? String(r.issueId) : null;
      if (issueId && !valid.has(issueId)) return [];
      const side = r.side === 'pro' || r.side === 'con' ? String(r.side) : null;
      const ok = Boolean(issueId && side);
      const conf = ['high', 'medium', 'low'].includes(String(r.confidence)) ? String(r.confidence) : undefined;
      return [{
        billId,
        issueId: ok ? issueId : null,
        side: ok ? side : null,
        confidence: ok ? conf : undefined,
        why: r.why ? String(r.why) : undefined,
      }];
    });
  } catch { return null; }
}

async function main(): Promise<void> {
  const db = new Database(DB_PATH, { readonly: true });
  const orphans = loadOrphans(db);
  console.log(`צירים קיימים: ${AXES.length}`);
  console.log(`הצעות יתומות: ${orphans.length}\n`);

  /* מדגם שיטתי, פרוס על כל טווח המזהים, ניתן לשחזור */
  const step = Math.max(1, Math.floor(orphans.length / SAMPLE));
  const work = all ? orphans : orphans.filter((_, i) => i % step === 0).slice(0, SAMPLE);
  console.log(all ? `מריץ על כל ${work.length}` : `מדגם שיטתי: ${work.length} (כל ה-${step}-ית)`);

  if (dryRun) {
    console.log('\n' + buildPrompt(work.slice(0, 2)).slice(0, 1200));
    console.log(`\n--dry-run — ${Math.ceil(work.length / BATCH)} בקשות היו נשלחות.`);
    db.close();
    return;
  }

  const done = new Map<number, Match>();
  if (fs.existsSync(OUT)) {
    for (const line of fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean)) {
      const m = JSON.parse(line) as Match;
      done.set(m.billId, m);
    }
    if (done.size) console.log(`${done.size} כבר בקובץ\n`);
  }

  const key = apiKey();
  const todo = work.filter(o => !done.has(o.billId));
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    process.stdout.write(`  ${i + batch.length}/${todo.length} ... `);
    let res: Match[] | null = null;
    try { res = await askBatch(batch, key, `batch-${i}`); } catch (e) {
      if (e instanceof DailyQuotaError) { console.log('\nהמכסה נגמרה. מה שנמצא נשמר.'); break; }
      throw e;
    }
    if (!res) { console.log('↻ יידון שוב'); continue; }
    /* הצעה שהמודל השמיט נרשמת כ"ללא ציר", כדי שהמאזן ייסגר */
    for (const b of batch) {
      const m = res.find(x => x.billId === b.billId) ?? { billId: b.billId, issueId: null, side: null };
      fs.appendFileSync(OUT, JSON.stringify(m) + '\n');
      done.set(b.billId, m);
    }
    console.log(`${res.filter(m => m.issueId).length}/${batch.length} הותאמו`);
    await new Promise(r => setTimeout(r, 800));
  }

  const results = work.map(o => done.get(o.billId)).filter((m): m is Match => !!m);
  const matched = results.filter(m => m.issueId);
  console.log(`\n═══ תשואה ═══`);
  console.log(`  נבדקו  : ${results.length}`);
  console.log(`  הותאמו : ${matched.length}  (${Math.round(matched.length / (results.length || 1) * 100)}%)`);
  console.log(`  ללא ציר: ${results.length - matched.length}`);
  if (!all && matched.length) {
    console.log(`\n  בהשלכה ל-${orphans.length} היתומות: כ-${Math.round(matched.length / results.length * orphans.length)} הצעות`);
  }

  const byAxis = new Map<string, number>();
  for (const m of matched) byAxis.set(m.issueId!, (byAxis.get(m.issueId!) ?? 0) + 1);
  console.log(`\n  צירים שקלטו הצעות: ${byAxis.size}`);
  for (const [id, n] of [...byAxis].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`    ${String(n).padStart(3)} · ${AXES.find(a => a.id === id)?.q.slice(0, 56)}`);
  }

  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  const lines = [['bill_id', 'כותרת', 'הציר שנמצא', 'צד', 'ביטחון', 'נימוק'].map(esc).join(',')];
  for (const o of work) {
    const m = done.get(o.billId);
    if (!m) continue;
    lines.push([o.billId, o.title, m.issueId ? AXES.find(a => a.id === m.issueId)?.q ?? m.issueId : '(ללא ציר)',
      m.side ?? '', m.confidence ?? '', m.why ?? ''].map(esc).join(','));
  }
  fs.writeFileSync(CSV, '﻿' + lines.join('\n') + '\n');
  console.log(`\nנכתב: ${path.basename(CSV)} · לא נכתב דבר למסד.`);
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
