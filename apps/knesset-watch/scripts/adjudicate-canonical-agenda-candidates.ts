import fs from "fs";
import path from "path";

const INPUT_PATH = "/tmp/canonical-agenda-candidates.jsonl";
const OUTPUT_PATH = "/tmp/canonical-agenda-adjudications.jsonl";

const ENV_PATH = path.join(process.cwd(), ".env.local");

const MODEL = "gemini-3.5-flash-lite";
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const DEFAULT_LIMIT = 50;
const BATCH_SIZE = 5;

type Decision =
  | "SAME_ISSUE"
  | "RELATED_BUT_DISTINCT"
  | "DIFFERENT";

type Example = {
  bill_id?: number;
  domain?: string;
  policy_change?: string;
  pro_stance?: string;
  con_stance?: string;
};

type Candidate = {
  key_a: string;
  key_b: string;

  issue_a: string;
  issue_b: string;

  token_similarity: number;
  char_similarity: number;

  count_a: number;
  count_b: number;

  domains_a: string[];
  domains_b: string[];

  examples_a?: Example[];
  examples_b?: Example[];

  example_a?: Example;
  example_b?: Example;
};

type Adjudication = {
  pair_id: string;
  decision: Decision;
  confidence: number;
  reason: string;
  canonical_name?: string | null;
};

function loadEnvLocal() {
  if (!fs.existsSync(ENV_PATH)) {
    throw new Error(`.env.local was not found at: ${ENV_PATH}`);
  }

  const content = fs.readFileSync(ENV_PATH, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");

    if (equalsIndex === -1) continue;

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

function parseJsonl<T>(filename: string): T[] {
  if (!fs.existsSync(filename)) return [];

  return fs
    .readFileSync(filename, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pairId(candidate: Candidate): string {
  return [candidate.key_a, candidate.key_b]
    .sort()
    .join("|||");
}

loadEnvLocal();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  throw new Error(`GEMINI_API_KEY is missing from ${ENV_PATH}`);
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
              parts: [{ text: prompt }],
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

      const text =
        data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        throw new Error("Gemini returned an empty response");
      }

      return text;
    }

    if ([400, 401, 403, 404].includes(response.status)) {
      throw new Error(
        `Gemini API ${response.status}: ${responseText}`,
      );
    }

    if (attempt === maxAttempts) {
      throw new Error(
        `Gemini API ${response.status}: ${responseText}`,
      );
    }

    let delay = attempt * 5000;

    if (response.status === 429) {
      delay = attempt * 15000;
    }

    console.warn(
      `Gemini request failed: ${response.status}. ` +
      `Retrying in ${Math.ceil(delay / 1000)}s...`,
    );

    await sleep(delay);
  }

  throw new Error("Gemini request failed");
}

function buildPrompt(batch: Candidate[]): string {
  const input = batch.map((candidate, index) => ({
    item_id: `P${index + 1}`,

    issue_a: candidate.issue_a,
    issue_b: candidate.issue_b,

    domains_a: candidate.domains_a,
    domains_b: candidate.domains_b,

    examples_a:
      candidate.examples_a ??
      (candidate.example_a ? [candidate.example_a] : []),

    examples_b:
      candidate.examples_b ??
      (candidate.example_b ? [candidate.example_b] : []),
  }));

  return `
You are consolidating policy issues extracted from Israeli
legislation into a canonical policy taxonomy.

For each pair, decide whether A and B represent the same
underlying policy question.

Use ALL available context:
- issue wording
- domain
- policy_change
- pro_stance
- con_stance

IMPORTANT:
The issue label may be broader, shorter, or less precise than
the actual policy scope.

When the issue wording conflicts with or is less specific than
policy_change, pro_stance, or con_stance, prioritize the
substantive policy context.

Do not classify two issues as distinct merely because one
label sounds broader if the supplied policy context shows that
both actually refer to the same concrete scope, population,
location, institution, or legal change.

Example:
If one label says
"החלת ריבונות ישראלית בשטחים"
but its policy_change explicitly refers only to Ma'ale Adumim,
and the other issue also refers to Ma'ale Adumim,
they should be treated as the same scope.

First identify the concrete policy question represented by
each issue.

Do not infer relatedness merely from shared verbs,
legal mechanisms, wording patterns, or institutional structures.

SAME_ISSUE:
The issues represent the same underlying policy question or
the same policy decision axis.

They may propose different, competing, or even opposite
policy changes. Different proposed solutions do NOT by
themselves make the issues distinct.

Use SAME_ISSUE when a citizen could reasonably express their
position on both under one common neutral policy question.

Example:

"selection of the President of the Supreme Court by the Knesset"
and
"preserving the seniority method for appointing the President
of the Supreme Court"

belong to the SAME_ISSUE:
"שיטת מינוי נשיא בית המשפט העליון"

The policy interventions differ, but the underlying policy
question is the same.

Do NOT use SAME_ISSUE merely because the issues share:
- the same population
- the same institution
- the same legislative mechanism
- the same general domain

They must concern the same concrete decision axis.

A decision axis means that A and B are alternative positions,
rules, or solutions to the same concrete policy decision.

Do NOT use SAME_ISSUE for two parallel or independent
sub-questions merely because they occur in the same law,
procedure, institution, or broader reform.

If changing policy A does not inherently determine policy B,
they are normally RELATED_BUT_DISTINCT.

Example:

"restrictions on requiring parking spaces as a condition
for a building reinforcement permit"

and

"restrictions on requiring protected rooms as a condition
for a building reinforcement permit"

are RELATED_BUT_DISTINCT.

They concern the same planning procedure, but regulate
different independent requirements.

A broader issue and a narrow special case are normally
RELATED_BUT_DISTINCT unless the supplied policy context shows
that both actually refer to the same scope.

RELATED_BUT_DISTINCT:
The issues belong to the same concrete policy controversy,
target population, regulated activity, or governmental decision,
but represent meaningfully different policy choices or interventions.

A citizen could reasonably discuss both as separate
sub-questions of the same policy debate.

DIFFERENT:
The issues concern different policy questions.

Classify as DIFFERENT when the similarity is only in the
legislative mechanism or wording pattern, such as:
- establishing a national center
- creating a database
- imposing a reporting duty
- providing an exemption
- increasing a penalty

if the subject matter, affected population, policy objective,
or regulated activity is different.

Example:

"establishing a national research center for forensic medicine"

and

"establishing a national research center for poverty"

are DIFFERENT, not RELATED_BUT_DISTINCT.

Be conservative about SAME_ISSUE.

When uncertain between SAME_ISSUE and
RELATED_BUT_DISTINCT, prefer RELATED_BUT_DISTINCT.

When two issues merely use the same legislative mechanism
for unrelated subject matter, choose DIFFERENT.

For SAME_ISSUE only, propose a concise neutral Hebrew
canonical_name that accurately covers both versions.

Return ONLY valid JSON:

{
  "results": [
    {
      "item_id": "P1",
      "decision": "SAME_ISSUE | RELATED_BUT_DISTINCT | DIFFERENT",
      "confidence": 0.0,
      "reason": "short explanation",
      "canonical_name": "Hebrew name or null"
    }
  ]
}

Return exactly one result for every input item.
Preserve item_id exactly.
Do not create, modify, translate, or infer item_id values.

INPUT:
${JSON.stringify(input, null, 2)}
`.trim();
}

function validateResult(
  result: any,
  expectedIds: Set<string>,
) {
  const itemId = String(result?.item_id ?? "");

  if (!expectedIds.has(itemId)) {
    throw new Error(
      `Unexpected item_id: ${itemId}`,
    );
  }

  const validDecisions = new Set<Decision>([
    "SAME_ISSUE",
    "RELATED_BUT_DISTINCT",
    "DIFFERENT",
  ]);

  if (!validDecisions.has(result?.decision)) {
    throw new Error(
      `Invalid decision for ${itemId}`,
    );
  }

  const confidence = Number(result.confidence);

  if (
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    throw new Error(
      `Invalid confidence for ${itemId}`,
    );
  }

  return {
    item_id: itemId,
    decision: result.decision as Decision,
    confidence,
    reason: String(result.reason ?? ""),
    canonical_name:
      result.decision === "SAME_ISSUE"
        ? String(result.canonical_name ?? "")
        : null,
  };
}

async function adjudicateBatch(
  batch: Candidate[],
): Promise<Adjudication[]> {
  const itemMap = new Map(
    batch.map((candidate, index) => [
      `P${index + 1}`,
      candidate,
    ]),
  );

  const expectedIds = new Set(itemMap.keys());

  const maxJsonAttempts = 3;

  for (
    let attempt = 1;
    attempt <= maxJsonAttempts;
    attempt++
  ) {
    const content = await callGemini(buildPrompt(batch));

    try {
      const parsed = JSON.parse(content);

      if (!Array.isArray(parsed.results)) {
        throw new Error("results is not an array");
      }

      const validated = parsed.results.map(
        (result: any) =>
          validateResult(result, expectedIds),
      );

      if (validated.length !== batch.length) {
        throw new Error(
          `Expected ${batch.length} results, got ` +
          `${validated.length}`,
        );
      }

      const returnedIds = new Set(
        validated.map((result) => result.item_id),
      );

      if (returnedIds.size !== batch.length) {
        throw new Error(
          "Duplicate item_id returned by Gemini",
        );
      }

      for (const expectedId of expectedIds) {
        if (!returnedIds.has(expectedId)) {
          throw new Error(
            `Missing result for ${expectedId}`,
          );
        }
      }

      return validated.map((result) => {
        const candidate = itemMap.get(result.item_id)!;

        return {
          pair_id: pairId(candidate),
          decision: result.decision,
          confidence: result.confidence,
          reason: result.reason,
          canonical_name: result.canonical_name,
        };
      });
    } catch (error) {
      if (attempt === maxJsonAttempts) {
        throw error;
      }

      console.warn(
        `Invalid Gemini JSON/result. Retrying ` +
        `(${attempt}/${maxJsonAttempts})...`,
      );
    }
  }

  throw new Error("Could not adjudicate batch");
}

async function main() {
  const candidates =
    parseJsonl<Candidate>(INPUT_PATH);

  const existing =
    parseJsonl<Adjudication>(OUTPUT_PATH);

  const completed = new Set(
    existing.map((row) => row.pair_id),
  );

  const limitArg = process.argv.find((arg) =>
    arg.startsWith("--limit="),
  );

  const limit = limitArg
    ? Number(limitArg.split("=")[1])
    : DEFAULT_LIMIT;

  const offsetArg = process.argv.find((arg) =>
    arg.startsWith("--offset="),
  );

  const offset = offsetArg
    ? Number(offsetArg.split("=")[1])
    : 0;

  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(
      "--offset must be a non-negative integer",
    );
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(
      "--limit must be a positive integer",
    );
  }

  const pending = candidates
    .slice(offset)
    .filter(
      (candidate) =>
        !completed.has(pairId(candidate)),
    )
    .slice(0, limit);

  console.log("=== SEMANTIC ADJUDICATION ===");
  console.log("candidate pairs:", candidates.length);
  console.log("already completed:", completed.size);
  console.log("running now:", pending.length);
  console.log("batch size:", BATCH_SIZE);

  if (pending.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  for (
    let batchOffset = 0;
    batchOffset < pending.length;
    batchOffset += BATCH_SIZE
  ) {
    const batch = pending.slice(
      batchOffset,
      batchOffset + BATCH_SIZE,
    );

    console.log(
      `\nBatch ${batchOffset + 1}-${batchOffset + batch.length}`,
    );

    const results = await adjudicateBatch(batch);

    fs.appendFileSync(
      OUTPUT_PATH,
      results
        .map((row) => JSON.stringify(row))
        .join("\n") + "\n",
    );

    for (const row of results) {
      const candidate = batch.find(
        (candidate) =>
          pairId(candidate) === row.pair_id,
      );

      console.log(
        "\n----------------------------------------",
      );
      console.log("A:", candidate?.issue_a);
      console.log("B:", candidate?.issue_b);
      console.log("DECISION:", row.decision);
      console.log(
        "CONFIDENCE:",
        row.confidence.toFixed(2),
      );
      console.log(
        "CANONICAL:",
        row.canonical_name ?? "",
      );
      console.log("REASON:", row.reason);
    }

    await sleep(1000);
  }

  console.log("\nSaved to:", OUTPUT_PATH);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});