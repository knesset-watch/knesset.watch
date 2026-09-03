/**
 * Export the policy analysis out of knesset.db into git-trackable JSON.
 *
 *   npx tsx scripts/export-policy-analysis.ts
 *   npx tsx scripts/export-policy-analysis.ts --out=data/policy-analysis
 *
 * למה זה קיים: knesset.db הוא gitignored ומשקלו 187MB, ולכן 52.9 מיליון
 * התווים המתוקנים וכל הניתוחים ששולמו עליהם קיימים על מחשב אחד בלבד.
 * לארבל ולזויה אין אליהם גישה, ותקלת דיסק אחת מוחקת את הכל.
 *
 * הייצוא מוציא רק את מה שאינו ניתן לשחזור בזול — הסוגיות עצמן. הטקסט
 * המלא נשאר בחוץ: הוא גדול מדי ל-git וניתן לשחזור מהארכיון.
 *
 * הפורמט הוא JSONL ולא JSON יחיד, כי git מבצע diff לפי שורות: הרצה
 * חוזרת שמשנה חוק אחד תיתן שורה אחת שונה ולא קובץ שלם.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

function arg(flag: string, fallback: string): string {
  const a = process.argv.slice(2).find(x => x.startsWith(`${flag}=`));
  return a ? a.slice(flag.length + 1) : fallback;
}

interface IssueRow {
  bill_id: number;
  domain_candidate: string | null;
  issue_candidate: string | null;
  policy_change: string | null;
  pro_stance: string | null;
  con_stance: string | null;
  explanation: string | null;
  confidence: number | null;
  is_primary: number;
  evidence_json: string | null;
}

function main() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`knesset.db not found at ${DB_PATH}`);

  const version = arg('--analysis-version', 'fulltext-v1');
  const outDir = path.join(process.cwd(), arg('--out', 'data/policy-analysis'));
  fs.mkdirSync(outDir, { recursive: true });

  const db = new Database(DB_PATH, { readonly: true });

  /**
   * הכותרת מגיעה מטבלת bill ולא נשמרת בייצוא פעמיים — בלעדיה הקובץ
   * אינו קריא לבן אדם, ואי אפשר לבדוק ניתוח בלי לפתוח את ה-DB.
   */
  const analyses = db.prepare(
    `SELECT a.bill_id, b.title, a.overall_summary, a.confidence,
            a.needs_review, a.evidence_grounding, a.text_chars, a.analyzed_at
     FROM bill_policy_analysis a
     JOIN bill b ON b.id = a.bill_id
     WHERE a.analysis_version = ? AND a.status = 'completed'
     ORDER BY a.bill_id`,
  ).all(version) as Array<Record<string, unknown>>;

  const issues = db.prepare(
    `SELECT bill_id, domain_candidate, issue_candidate, policy_change,
            pro_stance, con_stance, explanation, confidence, is_primary, evidence_json
     FROM bill_policy_issue
     WHERE analysis_version = ?
     ORDER BY bill_id, is_primary DESC, id`,
  ).all(version) as IssueRow[];

  const byBill = new Map<number, IssueRow[]>();
  for (const i of issues) {
    if (!byBill.has(i.bill_id)) byBill.set(i.bill_id, []);
    byBill.get(i.bill_id)!.push(i);
  }

  const issuesPath = path.join(outDir, `issues.${version}.jsonl`);

  /**
   * נצבר בזיכרון ונכתב בבת אחת. createWriteStream נסגר אסינכרונית,
   * וכל מדידה של הקובץ מיד אחריו נופלת על ENOENT. הקובץ בסדר גודל
   * של מגה-בייטים בודדים, ולכן אין סיבה לשלם על מורכבות של זרימה.
   */
  const lines: string[] = [];

  for (const a of analyses) {
    const billId = a.bill_id as number;
    const rows = byBill.get(billId) ?? [];
    lines.push(
      JSON.stringify({
        bill_id: billId,
        title: a.title,
        summary: a.overall_summary,
        confidence: a.confidence,
        needs_review: a.needs_review === 1,
        evidence_grounding: a.evidence_grounding,
        text_chars: a.text_chars,
        analyzed_at: a.analyzed_at,
        issues: rows.map(r => ({
          domain: r.domain_candidate,
          issue: r.issue_candidate,
          policy_change: r.policy_change,
          pro_stance: r.pro_stance,
          con_stance: r.con_stance,
          explanation: r.explanation,
          confidence: r.confidence,
          is_primary: r.is_primary === 1,
          evidence: JSON.parse(r.evidence_json ?? '[]'),
        })),
      }),
    );
  }
  fs.writeFileSync(issuesPath, lines.join('\n') + '\n', 'utf8');

  /**
   * רשימת התחומים ושמות הסוגיות בנפרד. זו נקודת הפתיחה של עבודת
   * הטקסונומיה, ואין סיבה שמי שעובד עליה יצטרך לקרוא 7,000 רשומות.
   */
  const domains = db.prepare(
    `SELECT domain_candidate AS name, COUNT(*) AS n
     FROM bill_policy_issue WHERE analysis_version = ?
     GROUP BY name ORDER BY n DESC, name`,
  ).all(version);

  const issueNames = db.prepare(
    `SELECT issue_candidate AS name, COUNT(*) AS n
     FROM bill_policy_issue WHERE analysis_version = ?
     GROUP BY name ORDER BY n DESC, name`,
  ).all(version);

  const vocabPath = path.join(outDir, `vocabulary.${version}.json`);
  fs.writeFileSync(
    vocabPath,
    JSON.stringify({ version, generated_at: new Date().toISOString(), domains, issues: issueNames }, null, 2),
    'utf8',
  );

  db.close();

  const size = (p: string) => `${(fs.statSync(p).size / 1024 / 1024).toFixed(1)}MB`;
  console.log(`exported analysis version ${version}`);
  console.log(`  bills:   ${analyses.length.toLocaleString()}`);
  console.log(`  issues:  ${issues.length.toLocaleString()}`);
  console.log(`  domains: ${domains.length.toLocaleString()} distinct`);
  console.log(`  names:   ${issueNames.length.toLocaleString()} distinct`);
  console.log('');
  console.log(`  ${path.relative(process.cwd(), issuesPath)}  ${size(issuesPath)}`);
  console.log(`  ${path.relative(process.cwd(), vocabPath)}  ${size(vocabPath)}`);
}

main();
