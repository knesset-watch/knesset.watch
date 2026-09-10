import fs from "node:fs";
import path from "node:path";

const MODEL = "gemini-3.5-flash-lite";

const REVIEW_PATH =
  "/tmp/canonical-agenda-cluster-review.jsonl";

const INPUT_PATH =
  "/tmp/canonical-agenda-input.jsonl";

const OUTPUT_PATH =
  "/tmp/canonical-agenda-component-partitions.jsonl";

const MAX_EXAMPLES_PER_ISSUE = 2;
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 3;

type ReviewMember = {
  key: string;
  labels: string[];
};

type ReviewComponent = {
  component_id: string;
  member_count: number;
  members: ReviewMember[];
};

type InputRow = {
  bill_id: number;
  bill_title?: string;

  raw_domain?: string;
  raw_issue: string;
  normalized_issue: string;

  policy_change?: string;
  pro_stance?: string;
  con_stance?: string;
  explanation?: string;

  is_primary?: boolean;
};

type IssueContext = {
  bill_id: number;
  bill_title?: string;
  domain?: string;
  policy_change?: string;
  pro_stance?: string;
  con_stance?: string;
  explanation?: string;
};

type ModelCluster = {
  canonical_name: string;
  members: string[];
  reason?: string;
};

type ModelResponse = {
  clusters: ModelCluster[];
};

type SavedCluster = {
  canonical_name: string;
  member_keys: string[];
  reason?: string;
};

type SavedPartition = {
  component_id: string;
  member_count: number;
  cluster_count: number;
  clusters: SavedCluster[];
  adjudicated_at: string;
};

function readJsonl<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }

  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function loadEnvLocal(): void {
  const envPath = path.resolve(".env.local");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs
    .readFileSync(envPath, "utf8")
    .split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    if (
      !trimmed ||
      trimmed.startsWith("#")
    ) {
      continue;
    }

    const equalsIndex =
      trimmed.indexOf("=");

    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed
      .slice(0, equalsIndex)
      .trim();

    let value = trimmed
      .slice(equalsIndex + 1)
      .trim();

    if (
      (value.startsWith('"') &&
        value.endsWith('"')) ||
      (value.startsWith("'") &&
        value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function getArgNumber(
  name: string,
  fallback: number,
): number {
  const prefix = `--${name}=`;

  const arg = process.argv.find(
    (value) =>
      value.startsWith(prefix),
  );

  if (!arg) {
    return fallback;
  }

  const value = Number(
    arg.slice(prefix.length),
  );

  if (!Number.isFinite(value)) {
    throw new Error(
      `Invalid --${name}`,
    );
  }

  return value;
}

function cleanJsonResponse(
  value: string,
): string {
  let cleaned = value.trim();

  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const firstBrace =
    cleaned.indexOf("{");

  const lastBrace =
    cleaned.lastIndexOf("}");

  if (
    firstBrace >= 0 &&
    lastBrace > firstBrace
  ) {
    cleaned = cleaned.slice(
      firstBrace,
      lastBrace + 1,
    );
  }

  return cleaned;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, ms),
  );
}

function buildPrompt(
  component: ReviewComponent,
  contextsByKey: Map<
    string,
    IssueContext[]
  >,
): {
  prompt: string;
  idToKey: Map<string, string>;
} {
  const idToKey =
    new Map<string, string>();

  const issues =
    component.members.map(
      (member, index) => {
        const id = `M${index + 1}`;

        idToKey.set(id, member.key);

        const contexts =
          contextsByKey.get(
            member.key,
          ) ?? [];

        return {
          id,
          labels: member.labels,
          examples: contexts.slice(
            0,
            MAX_EXAMPLES_PER_ISSUE,
          ),
        };
      },
    );

  const prompt = `
You are consolidating policy issues extracted from Israeli legislation.

You are given ONE connected component of issue labels.
Earlier pairwise comparisons found that some of these issues may refer to the same policy question.

Your job is to PARTITION all members into the smallest reasonable number of semantically coherent clusters.

IMPORTANT DEFINITION:

Two members belong in the SAME cluster only when they represent the same underlying policy question or decision axis.

Different wording is fine.

Different proposed solutions are also fine when they answer the same underlying policy question.

For example:
- "בחירת נשיא בית המשפט העליון לפי ותק"
- "בחירת נשיא בית המשפט העליון על ידי הכנסת"

may belong to the same policy issue:
"שיטת בחירת נשיא בית המשפט העליון"

because both concern the same underlying policy question.

However:

- same population
- same institution
- same legal mechanism
- same broad domain

are NOT sufficient.

Examples that must remain separate:
- amount of an old-age pension vs taxation of the pension
- sovereignty over Ma'ale Adumim vs sovereignty over the entire West Bank
- mandatory parking conditions vs protected-room conditions
- minimum sentences for weapons offenses vs minimum sentences for vehicle offenses

SCOPE MATTERS.

A broad issue and a narrow geographic/population/special-case issue should normally remain separate unless the examples demonstrate that they actually describe the same scope.

Use the substantive context as the primary evidence:
1. policy_change
2. pro_stance
3. con_stance
4. explanation
5. labels

The label may be vague or imperfect.

RULES:

1. Every member ID must appear EXACTLY ONCE.
2. Do not invent or omit member IDs.
3. A cluster may contain one member.
4. Prefer fewer clusters only when the policy question is genuinely the same.
5. Do not merge merely because issues are related.
6. canonical_name must be short, clear Hebrew.
7. canonical_name must describe the policy question, not one particular bill's proposed solution.
8. Do not concatenate Hebrew words accidentally.
9. Return JSON only.

Return exactly:

{
  "clusters": [
    {
      "canonical_name": "...",
      "members": ["M1", "M2"],
      "reason": "short explanation"
    }
  ]
}

COMPONENT:
${JSON.stringify(issues, null, 2)}
`;

  return {
    prompt,
    idToKey,
  };
}

async function callGemini(
  apiKey: string,
  prompt: string,
): Promise<ModelResponse> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let lastError:
    unknown = undefined;

  for (
    let attempt = 1;
    attempt <= MAX_RETRIES;
    attempt++
  ) {
    try {
      const controller =
        new AbortController();

      const timeout =
        setTimeout(
          () => controller.abort(),
          REQUEST_TIMEOUT_MS,
        );

      const response =
        await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
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
              responseMimeType:
                "application/json",
              temperature: 0,
            },
          }),
          signal: controller.signal,
        });

      clearTimeout(timeout);

      if (!response.ok) {
        const body =
          await response.text();

        throw new Error(
          `Gemini HTTP ${response.status}: ${body}`,
        );
      }

      const data =
        (await response.json()) as any;

      const text =
        data?.candidates?.[0]
          ?.content?.parts
          ?.map(
            (part: any) =>
              part.text ?? "",
          )
          .join("") ?? "";

      if (!text) {
        throw new Error(
          "Gemini returned no text",
        );
      }

      const cleaned =
        cleanJsonResponse(text);

      return JSON.parse(
        cleaned,
      ) as ModelResponse;
    } catch (error) {
      lastError = error;

      console.error(
        `attempt ${attempt}/${MAX_RETRIES} failed:`,
        error,
      );

      if (attempt < MAX_RETRIES) {
        await sleep(
          attempt * 30000,
        );
      }
    }
  }

  throw lastError;
}

function validatePartition(
  component: ReviewComponent,
  response: ModelResponse,
): void {
  if (
    !response ||
    !Array.isArray(response.clusters)
  ) {
    throw new Error(
      "Response has no clusters array",
    );
  }

  const expected =
    new Set(
      component.members.map(
        (_, index) =>
          `M${index + 1}`,
      ),
    );

  const seen =
    new Set<string>();

  for (
    const cluster of response.clusters
  ) {
    if (
      !cluster.canonical_name ||
      !Array.isArray(cluster.members) ||
      cluster.members.length === 0
    ) {
      throw new Error(
        "Invalid cluster structure",
      );
    }

    for (
      const memberId of
      cluster.members
    ) {
      if (
        !expected.has(memberId)
      ) {
        throw new Error(
          `Unexpected member ID: ${memberId}`,
        );
      }

      if (seen.has(memberId)) {
        throw new Error(
          `Member appears twice: ${memberId}`,
        );
      }

      seen.add(memberId);
    }
  }

  if (
    seen.size !== expected.size
  ) {
    const missing =
      [...expected].filter(
        (id) => !seen.has(id),
      );

    throw new Error(
      `Missing members: ${missing.join(", ")}`,
    );
  }
}

async function main(): Promise<void> {
  loadEnvLocal();

  const apiKey =
    process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY not found",
    );
  }

  const reviewComponents =
    readJsonl<ReviewComponent>(
      REVIEW_PATH,
    );

  const input =
    readJsonl<InputRow>(
      INPUT_PATH,
    );

  const contextsByKey =
    new Map<
      string,
      IssueContext[]
    >();

  for (const row of input) {
    let contexts =
      contextsByKey.get(
        row.normalized_issue,
      );

    if (!contexts) {
      contexts = [];

      contextsByKey.set(
        row.normalized_issue,
        contexts,
      );
    }

    contexts.push({
      bill_id: row.bill_id,
      bill_title:
        row.bill_title,
      domain:
        row.raw_domain,
      policy_change:
        row.policy_change,
      pro_stance:
        row.pro_stance,
      con_stance:
        row.con_stance,
      explanation:
        row.explanation,
    });
  }

  const completed =
    new Set<string>();

  if (
    fs.existsSync(OUTPUT_PATH)
  ) {
    const existing =
      readJsonl<SavedPartition>(
        OUTPUT_PATH,
      );

    for (const row of existing) {
      completed.add(
        row.component_id,
      );
    }
  }

  const offset =
    getArgNumber(
      "offset",
      0,
    );

  const limit =
    getArgNumber(
      "limit",
      reviewComponents.length,
    );

  const pending =
    reviewComponents
      .filter(
        (component) =>
          !completed.has(
            component.component_id,
          ),
      )
      .slice(offset, offset + limit);

  console.log(
    "=== COMPONENT PARTITIONING ===",
  );

  console.log(
    "review components:",
    reviewComponents.length,
  );

  console.log(
    "already completed:",
    completed.size,
  );

  console.log(
    "running now:",
    pending.length,
  );

  console.log(
    "model:",
    MODEL,
  );

  for (
    let index = 0;
    index < pending.length;
    index++
  ) {
    const component =
      pending[index];

    console.log();
    console.log(
      `[${index + 1}/${pending.length}]`,
      component.component_id,
      `members=${component.member_count}`,
    );

    const {
      prompt,
      idToKey,
    } = buildPrompt(
      component,
      contextsByKey,
    );

    try {
      const response =
        await callGemini(
          apiKey,
          prompt,
        );

      validatePartition(
        component,
        response,
      );

      const clusters:
        SavedCluster[] =
        response.clusters.map(
          (cluster) => ({
            canonical_name:
              cluster.canonical_name
                .replace(
                  /\s+/g,
                  " ",
                )
                .trim(),

            member_keys:
              cluster.members.map(
                (id) => {
                  const key =
                    idToKey.get(id);

                  if (!key) {
                    throw new Error(
                      `No key for ${id}`,
                    );
                  }

                  return key;
                },
              ),

            reason:
              cluster.reason,
          }),
        );

      const saved:
        SavedPartition = {
        component_id:
          component.component_id,

        member_count:
          component.member_count,

        cluster_count:
          clusters.length,

        clusters,

        adjudicated_at:
          new Date().toISOString(),
      };

      fs.appendFileSync(
        OUTPUT_PATH,
        JSON.stringify(saved) +
          "\n",
      );

      console.log(
        "clusters:",
        clusters.length,
      );
    } catch (error) {
      console.error(
        `FAILED ${component.component_id}`,
        error,
      );

      console.error(
        "Stopping so the run can be resumed safely.",
      );

      process.exitCode = 1;
      return;
    }
  }

  console.log();
  console.log("=== DONE ===");

  const finalCount =
    fs.existsSync(OUTPUT_PATH)
      ? fs
          .readFileSync(
            OUTPUT_PATH,
            "utf8",
          )
          .split("\n")
          .filter(Boolean)
          .length
      : 0;

  console.log(
    "completed partitions:",
    finalCount,
    "/",
    reviewComponents.length,
  );

  console.log(
    "output:",
    OUTPUT_PATH,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});