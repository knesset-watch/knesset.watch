import fs from "node:fs";
import zlib from "node:zlib";

const BILL_TEXTS_PATH = "data/bill-texts/bill-texts.jsonl.gz";
const ANALYSIS_PATH = "data/policy-analysis/issues.fulltext-v1.jsonl";
const OUTPUT_PATH = "/tmp/canonical-agenda-input.jsonl";

type BillText = {
  id: number;
  title: string;
  committee?: string;
  is_gazette?: boolean;
  rtl_repaired?: boolean;
  text?: string;
};

type Evidence = {
  section?: string;
  text?: string;
};

type RawIssue = {
  domain?: string;
  issue?: string;
  policy_change?: string;
  pro_stance?: string;
  con_stance?: string;
  explanation?: string;
  confidence?: number;
  is_primary?: boolean;
  evidence?: Evidence[];
};

type BillAnalysis = {
  bill_id: number;
  title?: string;
  summary?: string;
  confidence?: number;
  needs_review?: boolean;
  text_chars?: number;
  issues?: RawIssue[];
};

function parseJsonl<T>(text: string): T[] {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function normalizeText(value: string | undefined): string {
  if (!value) return "";

  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")

    // Invisible / RTL formatting characters
    .replace(
      /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g,
      "",
    )

    // Normalize Hebrew final letters for comparison
    .replace(/ך/g, "כ")
    .replace(/ם/g, "מ")
    .replace(/ן/g, "נ")
    .replace(/ף/g, "פ")
    .replace(/ץ/g, "צ")

    // Treat punctuation as separators
    .replace(/[־‐-‒–—-]/g, " ")
    .replace(/[״"“”׳'‘’]/g, "")

    // Any remaining punctuation → space
    .replace(/[^\p{L}\p{N}]+/gu, " ")

    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("he-IL");
}

const bills = parseJsonl<BillText>(
  zlib
    .gunzipSync(fs.readFileSync(BILL_TEXTS_PATH))
    .toString("utf8"),
);

const analyses = parseJsonl<BillAnalysis>(
  fs.readFileSync(ANALYSIS_PATH, "utf8"),
);

const billById = new Map(
  bills.map((bill) => [String(bill.id), bill]),
);

const gazetteIds = new Set(
  bills
    .filter((bill) => bill.is_gazette === true)
    .map((bill) => String(bill.id)),
);

const cleanAnalyses = analyses.filter(
  (analysis) => !gazetteIds.has(String(analysis.bill_id)),
);

const output: object[] = [];

for (const analysis of cleanAnalyses) {
  const bill = billById.get(String(analysis.bill_id));

  for (const [issueIndex, issue] of (analysis.issues ?? []).entries()) {
    output.push({
      bill_id: analysis.bill_id,
      bill_title: analysis.title ?? bill?.title ?? "",
      issue_index: issueIndex,

      raw_domain: issue.domain ?? "",
      normalized_domain: normalizeText(issue.domain),

      raw_issue: issue.issue ?? "",
      normalized_issue: normalizeText(issue.issue),

      policy_change: issue.policy_change ?? "",
      pro_stance: issue.pro_stance ?? "",
      con_stance: issue.con_stance ?? "",
      explanation: issue.explanation ?? "",

      issue_confidence: issue.confidence ?? null,
      is_primary: issue.is_primary === true,
      evidence: issue.evidence ?? [],

      analysis_confidence: analysis.confidence ?? null,
      needs_review: analysis.needs_review ?? false,
      text_chars: analysis.text_chars ?? bill?.text?.length ?? null,

      rtl_repaired: bill?.rtl_repaired ?? null,
    });
  }
}

fs.writeFileSync(
  OUTPUT_PATH,
  output.map((row) => JSON.stringify(row)).join("\n") + "\n",
);

const uniqueIssues = new Set(
  output.map((row: any) => row.normalized_issue),
);

const uniqueDomains = new Set(
  output.map((row: any) => row.normalized_domain),
);

console.log("=== CANONICAL AGENDA INPUT ===");
console.log("source analyses:", analyses.length);
console.log("gazette analyses removed:", analyses.length - cleanAnalyses.length);
console.log("clean bills:", cleanAnalyses.length);
console.log("issue instances:", output.length);
console.log("unique normalized issues:", uniqueIssues.size);
console.log("unique normalized domains:", uniqueDomains.size);
console.log("output:", OUTPUT_PATH);