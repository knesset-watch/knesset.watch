/**
 * Budget guard for the Gemini analysis run.
 *
 *   npx tsx scripts/cost-guard.ts --limit-ils=65
 *
 * למה זה קיים: התקרה ב-Google Cloud Billing שולחת התראה בלבד ואינה
 * עוצרת דבר. הסקריפט הזה כן עוצר — הוא מחשב את ההוצאה מתוך ה-DB
 * ומפיל את תהליך הניתוח כשהיא חוצה את הסף.
 *
 * ההערכה מכוונת בכוונה כלפי מעלה: 2 תווים לטוקן הוא הקצה הפסימי
 * לעברית, ולכן העוצר יפעל מוקדם מדי ולא מאוחר מדי. עדיף לעצור ב-60
 * ולגלות ששילמנו 50, מאשר להפך.
 */

import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

/** מחירון gemini-3.5-flash-lite, דולר למיליון טוקנים */
const USD_PER_M_IN = 0.30;
const USD_PER_M_OUT = 2.50;
const USD_TO_ILS = 3.7;

/** הקצה הפסימי לעברית — גורם לעוצר להקדים ולא לאחר */
const CHARS_PER_TOKEN = 2;

/** תווי הפרומפט הקבוע שנשלחים עם כל חוק */
const PROMPT_OVERHEAD = 1800;

/**
 * תחילת הריצה המשולמת, UTC. כל מה שנותח לפני כן רץ במסלול החינמי
 * ולא עלה דבר, ולכן אסור לספור אותו.
 */
const DEFAULT_PAID_START = '2026-09-03 16:02:03';

function arg(flag: string, fallback: string): string {
  const a = process.argv.slice(2).find(x => x.startsWith(`${flag}=`));
  return a ? a.slice(flag.length + 1) : fallback;
}

interface Spend {
  bills: number;
  ils: number;
  inChars: number;
  outChars: number;
}

function spendSince(db: Database.Database, version: string, since: string): Spend {
  const r = db.prepare(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(text_chars), 0) AS ic,
            COALESCE(SUM(LENGTH(raw_response)), 0) AS oc
     FROM bill_policy_analysis
     WHERE analysis_version = ? AND status = 'completed' AND analyzed_at >= ?`,
  ).get(version, since) as { n: number; ic: number; oc: number };

  const inChars = r.ic + r.n * PROMPT_OVERHEAD;
  const usd =
    (inChars / CHARS_PER_TOKEN / 1e6) * USD_PER_M_IN +
    (r.oc / CHARS_PER_TOKEN / 1e6) * USD_PER_M_OUT;

  return { bills: r.n, ils: usd * USD_TO_ILS, inChars, outChars: r.oc };
}

/** מפיל את עץ התהליכים של הריצה. /T כדי לתפוס גם את הצאצאים. */
function stopRun(): string[] {
  const stopped: string[] = [];
  const pidFile = path.join(process.cwd(), 'analysis-run.pid');

  if (fs.existsSync(pidFile)) {
    const pid = fs.readFileSync(pidFile, 'utf8').replace(/\uFEFF/g, '').trim();
    if (/^\d+$/.test(pid)) {
      try {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'pipe' });
        stopped.push(pid);
      } catch {
        // כבר מת — לא שגיאה
      }
    }
  }

  // רשת ביטחון: כל תהליך ניתוח ששרד, גם אם ה-pid file לא עדכני
  try {
    const ps =
      `Get-CimInstance Win32_Process | ` +
      `Where-Object { $_.CommandLine -like '*analyze-bill-policies*' } | ` +
      `ForEach-Object { $_.ProcessId }`;
    const out = execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: 'pipe' }).toString();
    for (const line of out.split('\n')) {
      const pid = line.trim();
      if (!/^\d+$/.test(pid) || stopped.includes(pid)) continue;
      try {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'pipe' });
        stopped.push(pid);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }

  return stopped;
}

async function main() {
  const limit = Number(arg('--limit-ils', '65'));
  const interval = Number(arg('--interval', '20')) * 1000;
  const version = arg('--analysis-version', 'fulltext-v1');
  const since = arg('--paid-start', DEFAULT_PAID_START);

  if (!fs.existsSync(DB_PATH)) throw new Error(`knesset.db not found at ${DB_PATH}`);

  console.log(`cost guard armed — limit ${limit} ILS, checking every ${interval / 1000}s`);
  console.log(`counting completions since ${since} UTC (version ${version})`);
  console.log(`estimate is deliberately pessimistic: ${CHARS_PER_TOKEN} chars/token\n`);

  const db = new Database(DB_PATH, { readonly: true });
  let lastReported = -1;

  for (;;) {
    const s = spendSince(db, version, since);
    const stamp = new Date().toISOString().slice(11, 19);

    if (s.ils >= limit) {
      const stopped = stopRun();
      console.log(
        `${stamp}  LIMIT REACHED — ${s.ils.toFixed(2)} ILS over ${s.bills} bills. ` +
          `stopped: ${stopped.length ? stopped.join(', ') : 'nothing running'}`,
      );
      db.close();
      process.exit(0);
    }

    // מדווח כל שקל שלם, כדי לא להציף
    const whole = Math.floor(s.ils);
    if (whole > lastReported) {
      lastReported = whole;
      console.log(
        `${stamp}  ${s.ils.toFixed(2)} / ${limit} ILS   ${s.bills} bills   ` +
          `(${(s.ils / limit * 100).toFixed(0)}%)`,
      );
    }

    await new Promise(r => setTimeout(r, interval));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
