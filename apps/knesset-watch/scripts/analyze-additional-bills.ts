import fs from "fs";
import path from "path";
import zlib from "zlib";

import {
  ANALYSIS_VERSION,
  MAX_TEXT_CHARS,
  buildPrompt,
  type BillForAnalysis,
} from "./lib/policy-analysis-prompt";

import {
  validateAnalysis,
  evidenceGroundingRate,
  isUsableBillText,
} from "./lib/policy-analysis-schema";

import { repairIfReversed } from "./lib/rtl-repair";

const INPUT_PATH = path.join(
  process.cwd(),
  "data",
  "bill-texts",
  "additional-bill-texts.jsonl.gz",
);

const OUTPUT_PATH = path.join(
  process.cwd(),
  "data",
  "policy-analysis",
  "issues.additional-194.jsonl",
);

const MODEL = "gemini-3.5-flash-lite";

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const MAX_ATTEMPTS = 3;
const DELAY_MS = 250;

interface InputBill {
  id: number;
  title: string;
  summary: string | null;
  committee_name: string | null;
  doc_url: string | null;
  text_content: string;
  is_gazette?: boolean;
}

interface Args {
  limit: number | null;
  billId: number | null;
  force: boolean;
  dryRun: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);

  const num = (flag: string): number | null => {
    const value = argv.find((arg) => arg.startsWith(`${flag}=`));

    if (!value) return null;

    const parsed = Number(value.split("=")[1]);

    return Number.isFinite(parsed) ? parsed : null;
  };

  return {
    limit: num("--limit"),
    billId: num("--bill-id"),
    force: argv.includes("--force"),
    dryRun: argv.includes("--dry-run"),
  };
}

function loadEnvLocal(): void {
  const envPath = path.join(process.cwd(), ".env.local");

  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");

    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

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

function readInputBills(): InputBill[] {
  if (!fs.existsSync(INPUT_PATH)) {
    throw new Error(`Input file not found: ${INPUT_PATH}`);
  }

  const compressed = fs.readFileSync(INPUT_PATH);
  const content = zlib.gunzipSync(compressed).toString("utf8");

  return content
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as InputBill);
}

function getExistingBillIds(): Set<number> {
  if (!fs.existsSync(OUTPUT_PATH)) {
    return new Set();
  }

  const ids = new Set<number>();

  for (const line of fs.readFileSync(OUTPUT_PATH, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;

    try {
      const row = JSON.parse(line) as { bill_id?: number };

      if (typeof row.bill_id === "number") {
        ids.add(row.bill_id);
      }
    } catch {
      continue;
    }
  }

  return ids;
}

function sqlDateNow(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface CallResult {
  text: string | null;
  transient: boolean;
  error?: string;
}

async function callGemini(prompt: string, apiKey: string): Promise<CallResult> {
  try {
    const response = await fetch(`${ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
        },
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const transient = response.status === 429 || response.status >= 500;

      const body = await response.text();

      return {
        text: null,
        transient,
        error: `HTTP ${response.status}: ${body.slice(0, 300)}`,
      };
    }

    const json = await response.json();

    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (typeof text !== "string" || text.trim().length === 0) {
      const reason = json?.candidates?.[0]?.finishReason ?? "unknown";

      return {
        text: null,
        transient: false,
        error: `empty response (finishReason=${reason})`,
      };
    }

    return {
      text,
      transient: false,
    };
  } catch (error) {
    return {
      text: null,
      transient: true,
      error: error instanceof Error ? error.message : "network error",
    };
  }
}

async function repairJson(
  brokenJson: string,
  apiKey: string,
): Promise<string | null> {
  const prompt = `
The following response is intended to be valid JSON but contains JSON syntax errors.

Fix ONLY the JSON syntax.
Do not change, summarize, translate, add, or remove any substantive content.
Return valid JSON only, without markdown or explanation.

BROKEN JSON:
${brokenJson}
`;

  const result = await callGemini(prompt, apiKey);

  return result.text;
}

async function main(): Promise<void> {
  loadEnvLocal();

  const args = parseArgs();

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set. Expected in .env.local");
  }

  const inputBills = readInputBills();

  console.log(`Input bills: ${inputBills.length}`);

  if (inputBills.length !== 194) {
    console.warn(
      `Warning: expected 194 input bills, found ${inputBills.length}`,
    );
  }

  const existingIds = args.force ? new Set<number>() : getExistingBillIds();

  let bills = inputBills.filter((bill) => {
    if (args.billId !== null && bill.id !== args.billId) {
      return false;
    }

    if (!args.force && existingIds.has(bill.id)) {
      return false;
    }

    return true;
  });

  if (args.limit !== null) {
    bills = bills.slice(0, args.limit);
  }

  console.log(`Model: ${MODEL}`);
  console.log(`Analysis version: ${ANALYSIS_VERSION}`);
  console.log(`Bills to analyse: ${bills.length}`);

  if (args.dryRun) {
    for (const bill of bills) {
      console.log(
        `${bill.id} | ${bill.text_content.length} chars | ${bill.title}`,
      );
    }

    return;
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), {
    recursive: true,
  });

  if (args.force && args.billId === null) {
    fs.writeFileSync(OUTPUT_PATH, "", "utf8");
  }

  let ok = 0;
  let failed = 0;
  let repairedCount = 0;

  for (const [index, inputBill] of bills.entries()) {
    const repaired = repairIfReversed(inputBill.text_content);

    if (repaired.repaired) {
      repairedCount++;
    }

    const bill: BillForAnalysis = {
      id: inputBill.id,
      title: inputBill.title,
      committee_name: inputBill.committee_name,
      text_content: repaired.text,
      is_gazette: inputBill.is_gazette === true,
    };

    if (!isUsableBillText(bill.text_content)) {
      console.log(`SKIP ${bill.id}: unusable bill text`);

      failed++;
      continue;
    }

    const prompt = buildPrompt(bill);

    const sourceText = bill.text_content.slice(0, MAX_TEXT_CHARS);

    let saved = false;
    let lastError = "unknown";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !saved; attempt++) {
      const result = await callGemini(prompt, apiKey);

      if (!result.text) {
        lastError = result.error ?? "no response";

        if (!result.transient) {
          break;
        }

        await sleep(attempt * 3000);

        continue;
      }
      let validated = validateAnalysis(result.text, bill.id);

      if (!validated.ok) {
        console.log(`Invalid JSON for ${bill.id}, trying JSON repair...`);

        const repairedJson = await repairJson(result.text, apiKey);

        if (repairedJson) {
          validated = validateAnalysis(repairedJson, bill.id);
        }
      }

      if (!validated.ok) {
        lastError = validated.error;

        if (attempt < MAX_ATTEMPTS) {
          await sleep(1000);
        }

        continue;
      }

      const analysis = validated.value;

      const grounding = evidenceGroundingRate(analysis, sourceText);

      const confidence =
        analysis.issues.length > 0
          ? analysis.issues.reduce((sum, issue) => sum + issue.confidence, 0) /
            analysis.issues.length
          : 0;

      const outputRow = {
        bill_id: bill.id,
        title: bill.title,
        summary: analysis.summary,
        confidence,
        needs_review: analysis.needs_review,
        evidence_grounding: grounding,
        text_chars: bill.text_content.length,
        analyzed_at: sqlDateNow(),
        issues: analysis.issues.map((issue) => ({
          domain: issue.domain_candidate,
          issue: issue.issue_candidate,
          policy_change: issue.policy_change,
          pro_stance: issue.pro_stance,
          con_stance: issue.con_stance,
          explanation: issue.explanation,
          confidence: issue.confidence,
          is_primary: issue.is_primary,
          evidence: issue.evidence,
        })),
      };

      fs.appendFileSync(OUTPUT_PATH, `${JSON.stringify(outputRow)}\n`, "utf8");

      saved = true;
      ok++;

      const flags = [
        analysis.needs_review ? "review" : null,
        repaired.repaired ? "rtl-repaired" : null,
        grounding < 0.5 ? `grounding ${(grounding * 100).toFixed(0)}%` : null,
      ]
        .filter(Boolean)
        .join(" ");

      console.log(
        `OK ${bill.id} | ${analysis.issues.length} issue(s) | ${flags}`,
      );
    }

    if (!saved) {
      failed++;

      console.log(`FAILED ${bill.id}: ${lastError.slice(0, 150)}`);
    }

    console.log(`${index + 1}/${bills.length} | ok=${ok} failed=${failed}`);

    await sleep(DELAY_MS);
  }

  console.log("");
  console.log("Done");
  console.log(`OK: ${ok}`);
  console.log(`Failed: ${failed}`);
  console.log(`RTL repaired: ${repairedCount}`);
  console.log(`Output: ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
