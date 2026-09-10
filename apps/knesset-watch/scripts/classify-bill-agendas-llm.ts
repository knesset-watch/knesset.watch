import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

import { DOMAINS, POLITICAL_ISSUES } from "../src/lib/agendas";

const DB_PATH = path.join(process.cwd(), "knesset.db");
const ENV_PATH = path.join(process.cwd(), ".env.local");
const limitArg = process.argv.find(arg => arg.startsWith("--limit="));

const TEST_LIMIT = limitArg
  ? Number(limitArg.split("=")[1])
  : 9000;

const MAX_TEXT_LENGTH = 8000;
const MODEL = "gemini-3.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

function loadEnvLocal() {
  if (!fs.existsSync(ENV_PATH)) {
    throw new Error(`.env.local was not found at: ${ENV_PATH}`);
  }

  const content = fs.readFileSync(ENV_PATH, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");

    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvLocal();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  throw new Error(`GEMINI_API_KEY is missing from ${ENV_PATH}`);
}

type Bill = {
  id: number;
  title: string;
  summary: string | null;
  committee_name: string | null;
  text_content: string | null;
};

type LlmClassification = {
  domain_id: string | null;
  issue_id: string | null;
  stance_id: string | null;
  confidence: number;
  reason: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function buildDomainDescription(): string {
  return DOMAINS.map((domain) => {
    return [
      `ID: ${domain.id}`,
      `שם: ${domain.label}`,
      `תיאור: ${domain.description}`,
      `מילות מפתח: ${domain.keywords.join(", ")}`,
    ].join("\n");
  }).join("\n\n");
}

function buildIssueDescription(): string {
  return POLITICAL_ISSUES.map((issue) => {
    const stances = issue.stances
      .map((stance) => `- ${stance.id}: ${stance.label}`)
      .join("\n");

    return [
      `ID: ${issue.id}`,
      `Domain: ${issue.domainId}`,
      `שם: ${issue.label}`,
      `תיאור: ${issue.description}`,
      `מילות מפתח: ${issue.keywords.join(", ")}`,
      `עמדות:`,
      stances,
    ].join("\n");
  }).join("\n\n");
}

function buildPrompt(bill: Bill): string {
  const title = cleanText(bill.title);
  const summary = cleanText(bill.summary);
  const committee = cleanText(bill.committee_name);
  const text = cleanText(bill.text_content).slice(0, MAX_TEXT_LENGTH);

  return `
אתה מסווג הצעות חוק של הכנסת.

עליך לבצע שלוש החלטות נפרדות:

1. לזהות את התחום הרחב של החוק.
2. לבדוק האם החוק קשור באופן מהותי לאחת השאלות הפוליטיות המוגדרות.
3. אם כן, לזהות מה העמדה שהחוק מייצג בתוך אותה שאלה.

התחומים האפשריים:

${buildDomainDescription()}

השאלות הפוליטיות והעמדות האפשריות:

${buildIssueDescription()}

כללים:

1. domain_id חייב להיות אחד מה-IDים של התחומים או null.
2. כמעט כל חוק צריך לקבל domain_id אם ניתן לזהות את התחום שלו.
3. issue_id חייב להיות אחד מה-IDים של השאלות הפוליטיות או null.
4. אל תכריח חוק לקבל issue_id.
5. חוק יכול להשתייך לתחום רחב גם אם אינו קשור לאף שאלה פוליטית מוגדרת.
6. אם issue_id הוא null, גם stance_id חייב להיות null.
7. stance_id חייב להיות אחת העמדות שהוגדרו עבור אותו issue_id.
8. אם החוק קשור לשאלה פוליטית אבל לא ניתן להבין את כיוונו באופן אמין, החזר stance_id = null.
9. אל תסווג לפי הופעה מקרית של מילת מפתח.
10. תן עדיפות לכותרת החוק, מטרת החוק והתקציר.
11. הטקסט המלא נועד לתת הקשר בלבד.
12. confidence מייצג את מידת הביטחון בהחלטה כולה.
13. reason צריך להסביר בקצרה בעברית את התחום, ואם רלוונטי גם את השאלה הפוליטית ואת העמדה.
14. אל תסיק עמדה שלא נובעת מהחוק עצמו.
15. החזר JSON תקין בלבד.
16. אל תשתמש במרכאות כפולות בתוך reason. אם צריך ציטוט, השתמש במרכאות יחידות.
17. issue_id יינתן רק כאשר הוראות החוק עצמן עוסקות ישירות בשאלה הפוליטית המוגדרת.
18. אל תסיק issue_id רק משום שהחוק נחקק בזמן מלחמה, מצב חירום או אירוע פוליטי הקשור בעקיפין לשאלה.
19. stance_id יינתן רק כאשר החוק משנה, מרחיב, מצמצם, מאפשר או אוסר באופן ישיר מדיניות הקשורה לאותה שאלה.
20. אם הקשר לשאלה הפוליטית הוא עקיף, הקשרי או פרשני בלבד, החזר issue_id = null ו-stance_id = null.
21. עדיף להחזיר null מאשר להסיק עמדה פוליטית שאינה נובעת ישירות מהוראות החוק.
פרטי החוק:

כותרת:
${title}

ועדה:
${committee || "לא ידוע"}

תקציר:
${summary || "אין תקציר"}

קטע מנוסח החוק:
${text || "אין טקסט"}

החזר אך ורק JSON תקין במבנה:

{
  "domain_id": null,
  "issue_id": null,
  "stance_id": null,
  "confidence": 0.0,
  "reason": "הסבר קצר בעברית"
}
`.trim();
}

function parseJsonResponse(content: string): LlmClassification {
  let cleaned = content.trim();

  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  const parsed = JSON.parse(cleaned);

  let domainId: string | null = parsed.domain_id ?? null;
  let issueId: string | null = parsed.issue_id ?? null;
  let stanceId: string | null = parsed.stance_id ?? null;

  const domain = domainId
    ? DOMAINS.find((item) => item.id === domainId)
    : undefined;

  if (!domain) {
    domainId = null;
  }

  const issue = issueId
    ? POLITICAL_ISSUES.find((item) => item.id === issueId)
    : undefined;

  if (!issue) {
    issueId = null;
    stanceId = null;
  } else {
    domainId = issue.domainId;

    if (stanceId && !issue.stances.some((stance) => stance.id === stanceId)) {
      stanceId = null;
    }
  }

  let confidence = Number(parsed.confidence);

  if (!Number.isFinite(confidence)) {
    confidence = 0;
  }

  confidence = Math.max(0, Math.min(1, confidence));

  return {
    domain_id: domainId,
    issue_id: issueId,
    stance_id: stanceId,
    confidence,
    reason: String(parsed.reason ?? ""),
  };
}

async function callGemini(prompt: string): Promise<string> {
  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(
      `${GEMINI_URL}?key=${encodeURIComponent(GEMINI_API_KEY!)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
          },
        }),
        signal: AbortSignal.timeout(60000),
      },
    );

    const responseText = await response.text();

    if (response.ok) {
      const data = JSON.parse(responseText);

      const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!content) {
        throw new Error("Gemini returned an empty response");
      }

      return content;
    }

    if (
      response.status === 400 ||
      response.status === 401 ||
      response.status === 403 ||
      response.status === 404
    ) {
      throw new Error(`Gemini API ${response.status}: ${responseText}`);
    }

    if (attempt === maxAttempts) {
      throw new Error(`Gemini API ${response.status}: ${responseText}`);
    }

    let delay = attempt * 5000;

    if (response.status === 429) {
      delay = attempt * 15000;
    }

    console.warn(`Gemini request failed: ${response.status}`);
    console.warn(`Retrying in ${Math.ceil(delay / 1000)}s...`);

    await sleep(delay);
  }

  throw new Error("Gemini request failed");
}

async function classifyBill(bill: Bill): Promise<LlmClassification> {
  const prompt = buildPrompt(bill);
  const maxJsonAttempts = 3;

  for (let attempt = 1; attempt <= maxJsonAttempts; attempt++) {
    const content = await callGemini(prompt);

    try {
      return parseJsonResponse(content);
    } catch (err) {
      if (attempt === maxJsonAttempts) {
        throw err;
      }

      console.warn(
        `Invalid JSON returned by Gemini. Retrying classification (${attempt}/${maxJsonAttempts})...`,
      );

      await sleep(2000);
    }
  }

  throw new Error("Could not parse Gemini JSON response");
}

async function main() {
  console.log("Gemini Bill Domain + Issue + Stance Classification");
  console.log(`Environment: ${ENV_PATH}`);
  console.log(`Model: ${MODEL}`);

  const db = new Database(DB_PATH);

  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS bill_political_classification (
      bill_id INTEGER PRIMARY KEY,
      domain_id TEXT,
      domain_label TEXT,
      issue_id TEXT,
      issue_label TEXT,
      stance_id TEXT,
      stance_label TEXT,
      confidence REAL,
      reason TEXT,
      classified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const bills = db
    .prepare(
      `
      SELECT
        b.id,
        MAX(b.title) AS title,
        MAX(b.summary) AS summary,
        MAX(b.committee_name) AS committee_name,
        MAX(b.text_content) AS text_content
      FROM bill b
      LEFT JOIN bill_political_classification c
        ON c.bill_id = b.id
      WHERE b.text_content IS NOT NULL
        AND b.text_content != ''
        AND c.bill_id IS NULL
      GROUP BY b.id
      ORDER BY b.id
      LIMIT ?
    `,
    )
    .all(TEST_LIMIT) as Bill[];

  console.log(`Bills selected for test: ${bills.length}`);

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO bill_political_classification
    (
      bill_id,
      domain_id,
      domain_label,
      issue_id,
      issue_label,
      stance_id,
      stance_label,
      confidence,
      reason,
      classified_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  let withDomain = 0;
  let noDomain = 0;
  let withIssue = 0;
  let withStance = 0;
  let errors = 0;

  for (let i = 0; i < bills.length; i++) {
    const bill = bills[i];

    console.log("");
    console.log(`[${i + 1}/${bills.length}] Bill ${bill.id}`);
    console.log(bill.title);

    try {
      const result = await classifyBill(bill);

      const domain = result.domain_id
        ? DOMAINS.find((item) => item.id === result.domain_id)
        : undefined;

      const issue = result.issue_id
        ? POLITICAL_ISSUES.find((item) => item.id === result.issue_id)
        : undefined;

      const stance =
        issue && result.stance_id
          ? issue.stances.find((item) => item.id === result.stance_id)
          : undefined;

      upsert.run(
        bill.id,
        domain?.id ?? null,
        domain?.label ?? null,
        issue?.id ?? null,
        issue?.label ?? null,
        stance?.id ?? null,
        stance?.label ?? null,
        result.confidence,
        result.reason,
      );

      if (domain) {
        withDomain++;
      } else {
        noDomain++;
      }

      if (issue) {
        withIssue++;
      }

      if (stance) {
        withStance++;
      }

      console.log(`Domain: ${domain?.label ?? "none"}`);
      console.log(`Issue: ${issue?.label ?? "none"}`);
      console.log(`Stance: ${stance?.label ?? "none"}`);
      console.log(`Confidence: ${result.confidence}`);
      console.log(`Reason: ${result.reason}`);
    } catch (err: any) {
      errors++;
      console.error(`ERROR: ${err.message}`);
    }

    await sleep(2000);
  }

  console.log("");
  console.log("Results:");
  console.log(`Bills checked : ${bills.length}`);
  console.log(`With domain   : ${withDomain}`);
  console.log(`No domain     : ${noDomain}`);
  console.log(`With issue    : ${withIssue}`);
  console.log(`With stance   : ${withStance}`);
  console.log(`Errors        : ${errors}`);

  const sample = db
    .prepare(
      `
      SELECT DISTINCT
        b.id,
        b.title,
        c.domain_label,
        c.issue_label,
        c.stance_label,
        c.confidence,
        c.reason
      FROM bill_political_classification c
      JOIN bill b
        ON b.id = c.bill_id
      ORDER BY c.classified_at DESC
      LIMIT 20
    `,
    )
    .all();

  console.log("");
  console.table(sample);

  db.close();
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
