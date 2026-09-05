/**
 * Build bill_political_classification from the canonical layer.
 *
 *   npx tsx scripts/build-bill-classification.ts --dry-run
 *   npx tsx scripts/build-bill-classification.ts
 *
 * הטבלה שחסמה את הפיצ'ר. computeMatch שולף ממנה את החוקים הרלוונטיים
 * לכל שאלה, והיא מעולם לא הגיעה אלינו — היא נבנתה אצל ארבל על גבי 12
 * הסוגיות הישנות, ו-knesset.db הוא gitignored.
 *
 * כאן היא נגזרת מחדש מהשכבות שכבר קיימות, בלי AI ובלי עלות:
 *
 *   bill_id + issue_index  →  canonical_issue_id   (המיפוי של זויה)
 *   canonical_issue_id     →  ציר + צד             (חילוץ הצירים)
 *   →  שורה בטבלה
 *
 * הירושה היא ברמת הסוגיה הקנונית ולא ברמת החוק, ולכן שני חוקים באותו
 * אשכול לא יכולים לקבל צדדים סותרים.
 *
 * issue_id הוא מזהה הציר ולא תת-הנושא: הציר הוא השאלה שהמשתמש עונה
 * עליה. תת-נושא אחד יכול להוליד עד חמישה צירים נפרדים.
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const DATA_DIR = path.join(process.cwd(), 'data', 'policy-analysis');
const AXES_PATH = path.join(DATA_DIR, 'subtopic-axes.json');
const ORIENTATION_PATH = path.join(DATA_DIR, 'canonical-orientation.jsonl');
const MAPPING_PATH = path.join(DATA_DIR, 'canonical', 'bill-issue-mapping.jsonl');
const CATALOG_PATH = path.join(DATA_DIR, 'axis-catalog.json');

interface Axis {
  topic: string;
  subtopic: string;
  axisIndex: number;
  question: string;
  proLabel: string;
  conLabel: string;
  covered: number;
  poolSize: number;
}

interface OrientationRow {
  canonical_issue_id: string;
  topic: string;
  subtopic: string;
  axis_index: number;
  side: 'PRO' | 'CON';
}

interface MappingRow {
  bill_id: number;
  issue_index: number;
  canonical_issue_id: string;
  review_required: boolean;
}

export interface CatalogAxis {
  issueId: string;
  topic: string;
  subtopic: string;
  axisIndex: number;
  question: string;
  stances: Array<{ id: string; label: string }>;
  billCount: number;
}

function readJsonl<T>(file: string): T[] {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T);
}

/**
 * מזהה יציב לציר. נגזר מהתוכן ולא ממונה רץ, כדי שהרצה חוזרת של חילוץ
 * הצירים לא תזיז את המזהים של צירים שלא השתנו — אחרת כל תשובה שמשתמש
 * שמר הייתה מצביעה על שאלה אחרת.
 */
function axisId(topic: string, subtopic: string, axisIndex: number): string {
  const h = crypto.createHash('sha1').update(`${topic}|${subtopic}|${axisIndex}`).digest('hex');
  return `ax_${h.slice(0, 10)}`;
}

function main() {
  const dryRun = process.argv.slice(2).includes('--dry-run');
  if (!fs.existsSync(DB_PATH)) throw new Error(`knesset.db not found at ${DB_PATH}`);

  const axes = JSON.parse(fs.readFileSync(AXES_PATH, 'utf8')) as Axis[];
  const orientation = readJsonl<OrientationRow>(ORIENTATION_PATH);
  const mapping = readJsonl<MappingRow>(MAPPING_PATH);

  /** ציר לפי (תת-נושא, אינדקס) — המפתח שהאוריינטציה מצביעה עליו */
  const axisByKey = new Map<string, Axis>();
  for (const a of axes) axisByKey.set(`${a.subtopic}|${a.axisIndex}`, a);

  /** סוגיה קנונית → הציר והצד שלה */
  const orientationByIssue = new Map<string, OrientationRow>();
  for (const o of orientation) orientationByIssue.set(o.canonical_issue_id, o);

  /**
   * חוק יכול למפות לאותו ציר דרך כמה סוגיות. נשמרת שורה אחת לכל
   * (bill_id, issue_id) — אחרת חוק אחד היה נספר פעמיים באותה שאלה.
   */
  const rows = new Map<string, { bill_id: number; issue_id: string; stance_id: string }>();
  const billsPerAxis = new Map<string, Set<number>>();

  let noOrientation = 0;
  let noAxis = 0;
  let skippedReview = 0;

  for (const m of mapping) {
    if (m.review_required) {
      skippedReview++;
      continue;
    }

    const o = orientationByIssue.get(m.canonical_issue_id);
    if (!o) {
      noOrientation++;
      continue;
    }

    const axis = axisByKey.get(`${o.subtopic}|${o.axis_index}`);
    if (!axis) {
      noAxis++;
      continue;
    }

    const issueId = axisId(axis.topic, axis.subtopic, axis.axisIndex);
    const stanceId = `${issueId}_${o.side === 'PRO' ? 'pro' : 'con'}`;
    const key = `${m.bill_id}|${issueId}`;

    if (!rows.has(key)) rows.set(key, { bill_id: m.bill_id, issue_id: issueId, stance_id: stanceId });
    if (!billsPerAxis.has(issueId)) billsPerAxis.set(issueId, new Set());
    billsPerAxis.get(issueId)!.add(m.bill_id);
  }

  const catalog: CatalogAxis[] = axes.map(a => {
    const issueId = axisId(a.topic, a.subtopic, a.axisIndex);
    return {
      issueId,
      topic: a.topic,
      subtopic: a.subtopic,
      axisIndex: a.axisIndex,
      question: a.question,
      stances: [
        { id: `${issueId}_pro`, label: a.proLabel },
        { id: `${issueId}_con`, label: a.conLabel },
      ],
      billCount: billsPerAxis.get(issueId)?.size ?? 0,
    };
  });

  console.log(`  mapping rows:        ${mapping.length.toLocaleString()}`);
  console.log(`  skipped (review):    ${skippedReview.toLocaleString()}`);
  console.log(`  no orientation:      ${noOrientation.toLocaleString()}  (סוגיות שלא נפלו על אף ציר)`);
  console.log(`  axis not found:      ${noAxis.toLocaleString()}`);
  console.log(`  classification rows: ${rows.size.toLocaleString()}`);
  console.log(`  distinct bills:      ${new Set([...rows.values()].map(r => r.bill_id)).size.toLocaleString()}`);
  console.log(`  axes with bills:     ${catalog.filter(c => c.billCount > 0).length}/${catalog.length}`);

  if (dryRun) {
    console.log('\nDry run — nothing written.');
    return;
  }

  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS bill_political_classification (
      bill_id  INTEGER NOT NULL,
      issue_id TEXT    NOT NULL,
      stance_id TEXT,
      PRIMARY KEY (bill_id, issue_id)
    );
    CREATE INDEX IF NOT EXISTS idx_bpc_issue ON bill_political_classification(issue_id);
  `);

  const insert = db.prepare(
    'INSERT OR REPLACE INTO bill_political_classification (bill_id, issue_id, stance_id) VALUES (?, ?, ?)',
  );
  const replaceAll = db.transaction((list: Array<{ bill_id: number; issue_id: string; stance_id: string }>) => {
    db.prepare('DELETE FROM bill_political_classification').run();
    for (const r of list) insert.run(r.bill_id, r.issue_id, r.stance_id);
  });

  replaceAll([...rows.values()]);

  const stored = db.prepare('SELECT COUNT(*) AS n FROM bill_political_classification').get() as { n: number };
  db.close();

  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf8');

  console.log(`\nDone. ${stored.n.toLocaleString()} rows in bill_political_classification`);
  console.log(`  ${path.relative(process.cwd(), CATALOG_PATH)}`);
}

main();
