/**
 * Bottom-up policy analysis of bills, one Gemini call per bill.
 *
 *   npx tsx scripts/analyze-bill-policies.ts --progress
 *   npx tsx scripts/analyze-bill-policies.ts --sample=20
 *   npx tsx scripts/analyze-bill-policies.ts --limit=200
 *   npx tsx scripts/analyze-bill-policies.ts --bill-id=2196203
 *   npx tsx scripts/analyze-bill-policies.ts --retry-failed
 *   npx tsx scripts/analyze-bill-policies.ts --force --bill-id=...
 *
 * כל חוק נשמר מיד אחרי שהתשובה אומתה, ולכן עצירה באמצע לא מאבדת דבר
 * וההרצה הבאה ממשיכה מהחוק הבא. תשובה שלא עברה ולידציה נרשמת כ-failed
 * ולא כמושלמת, אחרת resume היה מדלג עליה לנצח.
 *
 * --sample=20 אינו עשרים הראשונים אלא מדגם מרובד: קצרים, בינוניים,
 * ארוכים, ארוכים מאוד וחוברות רשומות. עשרים הראשונים לפי מזהה הם
 * במקרה כולם גיליונות ממשלתיים, וזה היה נותן תמונה מטעה על האיכות.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import {
  ANALYSIS_VERSION,
  MAX_TEXT_CHARS,
  buildPrompt,
  type BillForAnalysis,
} from './lib/policy-analysis-prompt';
import {
  ensureAnalysisTables,
  validateAnalysis,
  evidenceGroundingRate,
  saveAnalysis,
  recordFailure,
  isUsableBillText,
} from './lib/policy-analysis-schema';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const MODEL = 'gemini-3.5-flash-lite';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/** ניסיונות לכל חוק. מעבר לזה זו כנראה בעיה בחוק ולא תקלה רגעית */
const MAX_ATTEMPTS = 3;

/** השהיה בין חוקים, כדי לא להיחסם על קצב */
const DELAY_MS = 250;

interface Args {
  limit: number | null;
  sample: number | null;
  billId: number | null;
  retryFailed: boolean;
  force: boolean;
  progress: boolean;
  version: string;
  dryRun: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const num = (flag: string) => {
    const a = argv.find(x => x.startsWith(`${flag}=`));
    return a ? Number(a.split('=')[1]) || null : null;
  };
  const str = (flag: string, fallback: string) => {
    const a = argv.find(x => x.startsWith(`${flag}=`));
    return a ? a.split('=')[1] : fallback;
  };
  return {
    limit: num('--limit'),
    sample: num('--sample'),
    billId: num('--bill-id'),
    retryFailed: argv.includes('--retry-failed'),
    force: argv.includes('--force'),
    progress: argv.includes('--progress'),
    version: str('--analysis-version', ANALYSIS_VERSION),
    dryRun: argv.includes('--dry-run'),
  };
}

/** הסקריפט של ארבל טוען כך את .env.local, ונשמרת אותה מוסכמה */
function loadEnvLocal(): void {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface CallResult {
  text: string | null;
  transient: boolean;
  error?: string;
}

async function callGemini(prompt: string, apiKey: string): Promise<CallResult> {
  try {
    const res = await fetch(`${ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      // 429 ו-5xx חולפים; 400 ו-403 לא ייעלמו בניסיון נוסף
      const transient = res.status === 429 || res.status >= 500;
      return { text: null, transient, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` };
    }

    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string' || text.trim().length === 0) {
      const reason = json?.candidates?.[0]?.finishReason ?? 'unknown';
      return { text: null, transient: false, error: `empty response (finishReason=${reason})` };
    }
    return { text, transient: false };
  } catch (err) {
    return {
      text: null,
      transient: true,
      error: err instanceof Error ? err.message : 'network error',
    };
  }
}

interface BillRow extends BillForAnalysis {
  text_len: number;
}

/**
 * מדגם מרובד: מכסה את טווח האורכים ואת החוברות, כדי שהבדיקה תגלה
 * בעיות שדגימת "עשרים הראשונים" הייתה מסתירה.
 */
function stratifiedSample(db: Database.Database, version: string, size: number): number[] {
  const pool = db.prepare(
    `SELECT b.id, LENGTH(b.text_content) AS len, COALESCE(b.is_gazette, 0) AS gz
     FROM bill b
     LEFT JOIN bill_policy_analysis a
       ON a.bill_id = b.id AND a.analysis_version = ?
     WHERE b.text_content IS NOT NULL AND b.text_content != ''
       AND (a.bill_id IS NULL OR a.status != 'completed')
     ORDER BY len`,
  ).all(version) as Array<{ id: number; len: number; gz: number }>;

  if (pool.length === 0) return [];

  const short = pool.filter(b => b.len < 2000 && !b.gz);
  const medium = pool.filter(b => b.len >= 2000 && b.len < 6000 && !b.gz);
  const long = pool.filter(b => b.len >= 6000 && b.len < 30000 && !b.gz);
  const veryLong = pool.filter(b => b.len >= 30000 && !b.gz);
  const gazettes = pool.filter(b => b.gz === 1);

  const takeSpread = (arr: Array<{ id: number }>, n: number) => {
    if (arr.length === 0) return [];
    const step = Math.max(1, Math.floor(arr.length / n));
    const out: number[] = [];
    for (let i = 0; i < arr.length && out.length < n; i += step) out.push(arr[i].id);
    return out;
  };

  const picked = [
    ...takeSpread(short, 5),
    ...takeSpread(medium, 5),
    ...takeSpread(long, 5),
    ...takeSpread(veryLong, 3),
    ...takeSpread(gazettes, 2),
  ];

  return [...new Set(picked)].slice(0, size);
}

function selectBills(db: Database.Database, args: Args): BillRow[] {
  const base = `
    SELECT b.id, b.title, b.committee_name, b.text_content,
           COALESCE(b.is_gazette, 0) AS gz, LENGTH(b.text_content) AS text_len
    FROM bill b
    LEFT JOIN bill_policy_analysis a
      ON a.bill_id = b.id AND a.analysis_version = @version
    WHERE b.text_content IS NOT NULL AND b.text_content != ''
  `;

  /**
   * האורך נמדד ב-JS ולא ב-SQL: SQLite עוצר את LENGTH() על null byte,
   * וחילוץ שנכשל מייצר בדיוק כאלה. חוק 2227226 נראה כך באורך 0 בעוד
   * שבפועל היו בו 4,913 תווי זבל.
   *
   * isUsableBillText מסנן את אותם מקרים לפני שהם עולים כסף.
   */
  const map = (rows: unknown[]): BillRow[] =>
    (rows as Array<Record<string, unknown>>)
      .map(r => {
        const text = String(r.text_content ?? '');
        return {
          id: Number(r.id),
          title: String(r.title ?? ''),
          committee_name: (r.committee_name as string | null) ?? null,
          text_content: text,
          is_gazette: Number(r.gz) === 1,
          text_len: text.length,
        };
      })
      .filter(b => isUsableBillText(b.text_content));

  if (args.billId !== null) {
    return map(db.prepare(`${base} AND b.id = @billId`).all({ version: args.version, billId: args.billId }));
  }

  if (args.sample !== null) {
    const ids = stratifiedSample(db, args.version, args.sample);
    if (ids.length === 0) return [];
    return map(
      db.prepare(
        `SELECT b.id, b.title, b.committee_name, b.text_content,
                COALESCE(b.is_gazette, 0) AS gz, LENGTH(b.text_content) AS text_len
         FROM bill b
         WHERE b.id IN (${ids.map(() => '?').join(',')})
         ORDER BY text_len`,
      ).all(...ids),
    );
  }

  const condition = args.force
    ? ''
    : args.retryFailed
      ? `AND a.bill_id IS NOT NULL AND a.status = 'failed' AND a.attempts < ${MAX_ATTEMPTS}`
      : `AND (a.bill_id IS NULL OR a.status != 'completed')`;

  const limit = args.limit ? `LIMIT ${args.limit}` : '';
  return map(db.prepare(`${base} ${condition} ORDER BY b.id ${limit}`).all({ version: args.version }));
}

function showProgress(db: Database.Database, version: string): void {
  const eligible = db.prepare(
    `SELECT COUNT(*) AS n FROM bill WHERE text_content IS NOT NULL AND text_content != ''`,
  ).get() as { n: number };

  const byStatus = db.prepare(
    `SELECT status, COUNT(*) AS n FROM bill_policy_analysis
     WHERE analysis_version = ? GROUP BY status`,
  ).all(version) as Array<{ status: string; n: number }>;

  const completed = byStatus.find(s => s.status === 'completed')?.n ?? 0;
  const failed = byStatus.find(s => s.status === 'failed')?.n ?? 0;

  const issues = db.prepare(
    `SELECT COUNT(*) AS n FROM bill_policy_issue WHERE analysis_version = ?`,
  ).get(version) as { n: number };

  console.log(`analysis version: ${version}`);
  console.log(`  Total eligible: ${eligible.n.toLocaleString()}`);
  console.log(`  Completed:      ${completed.toLocaleString()}`);
  console.log(`  Failed:         ${failed.toLocaleString()}`);
  console.log(`  Remaining:      ${(eligible.n - completed).toLocaleString()}`);
  console.log(`  Issues found:   ${issues.n.toLocaleString()}`);
}

async function main() {
  loadEnvLocal();
  const args = parseArgs();

  if (!fs.existsSync(DB_PATH)) throw new Error(`knesset.db not found at ${DB_PATH}`);
  const db = new Database(DB_PATH);
  ensureAnalysisTables(db);

  if (args.progress) {
    showProgress(db, args.version);
    db.close();
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set (expected in .env.local)');

  const bills = selectBills(db, args);
  console.log(`model: ${MODEL} · version: ${args.version}`);
  console.log(`bills to analyse: ${bills.length.toLocaleString()}\n`);

  if (bills.length === 0) {
    db.close();
    return;
  }
  if (args.dryRun) {
    for (const b of bills) console.log(`  ${b.id}  ${b.text_len.toLocaleString().padStart(9)}  ${b.title.slice(0, 60)}`);
    db.close();
    return;
  }

  let ok = 0;
  let failed = 0;
  const startedAt = Date.now();

  for (const [index, bill] of bills.entries()) {
    const prompt = buildPrompt(bill);
    const sent = bill.text_content.slice(0, MAX_TEXT_CHARS);

    let lastError = 'unknown';
    let lastRaw: string | null = null;
    let saved = false;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !saved; attempt++) {
      const result = await callGemini(prompt, apiKey);

      if (!result.text) {
        lastError = result.error ?? 'no response';
        lastRaw = null;
        if (!result.transient) break;
        await sleep(attempt * 3000);
        continue;
      }

      lastRaw = result.text;
      const validated = validateAnalysis(result.text, bill.id);

      if (!validated.ok) {
        lastError = validated.error;
        // מבנה שגוי אינו תקלה רגעית, אבל ניסיון נוסף לעיתים מחזיר JSON תקין
        if (attempt < MAX_ATTEMPTS) await sleep(1000);
        continue;
      }

      const grounding = evidenceGroundingRate(validated.value, sent);
      saveAnalysis(db, validated.value, {
        version: args.version,
        rawResponse: result.text,
        textChars: bill.text_len,
        grounding,
      });
      saved = true;
      ok++;

      const flags = [
        validated.value.needs_review ? 'review' : null,
        bill.is_gazette ? 'gazette' : null,
        grounding < 0.5 ? `grounding ${(grounding * 100).toFixed(0)}%` : null,
      ].filter(Boolean).join(' ');

      console.log(
        `  ✓ ${String(bill.id).padEnd(8)} ${String(bill.text_len).padStart(7)}ch  ` +
        `${validated.value.issues.length} issue(s)  ${flags}`,
      );
    }

    if (!saved) {
      recordFailure(db, bill.id, args.version, lastError, lastRaw);
      failed++;
      console.log(`  ✗ ${String(bill.id).padEnd(8)} ${lastError.slice(0, 90)}`);
    }

    if ((index + 1) % 25 === 0) {
      const rate = (index + 1) / ((Date.now() - startedAt) / 1000);
      const left = Math.round((bills.length - index - 1) / rate);
      console.log(`    — ${index + 1}/${bills.length}  ok=${ok} failed=${failed}  eta ${Math.floor(left / 60)}m`);
    }

    await sleep(DELAY_MS);
  }

  console.log(`\nDone. ok=${ok} failed=${failed}`);
  showProgress(db, args.version);
  db.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
