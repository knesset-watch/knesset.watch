import fs from "node:fs";

const INPUT = "/tmp/canonical-agenda-input.jsonl";
const OUTPUT = "/tmp/canonical-agenda-candidates.jsonl";

type Row = {
  bill_id: number;
  raw_domain: string;
  normalized_domain: string;
  raw_issue: string;
  normalized_issue: string;
  policy_change: string;
  pro_stance: string;
  con_stance: string;
};

const rows: Row[] = fs
  .readFileSync(INPUT, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const STOP_WORDS = new Set([
  "של",
  "על",
  "את",
  "או",
  "עם",
  "בין",
  "לפי",
  "לעניין",
  "בעניין",
  "באמצעות",
  "וכן",
  "ידי",
]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const intersection = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;

  return union === 0 ? 0 : intersection / union;
}

function trigrams(text: string): Set<string> {
  const value = `  ${text}  `;
  const result = new Set<string>();

  for (let i = 0; i < value.length - 2; i++) {
    result.add(value.slice(i, i + 3));
  }

  return result;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;

  const intersection = [...a].filter((x) => b.has(x)).length;

  return (2 * intersection) / (a.size + b.size);
}

type IssueGroup = {
  key: string;
  displayIssue: string;
  count: number;
  domains: Set<string>;
  examples: Row[];
  tokens: Set<string>;
  trigrams: Set<string>;
};

const groups = new Map<string, IssueGroup>();

for (const row of rows) {
  let group = groups.get(row.normalized_issue);

  if (!group) {
    group = {
      key: row.normalized_issue,
      displayIssue: row.raw_issue,
      count: 0,
      domains: new Set(),
      examples: [],
      tokens: tokens(row.normalized_issue),
      trigrams: trigrams(row.normalized_issue),
    };

    groups.set(row.normalized_issue, group);
  }

  group.count++;
  group.domains.add(row.raw_domain);

  if (group.examples.length < 3) {
    group.examples.push(row);
  }
}

const issues = [...groups.values()];

const tokenIndex = new Map<string, number[]>();

issues.forEach((issue, index) => {
  for (const token of issue.tokens) {
    const list = tokenIndex.get(token) ?? [];
    list.push(index);
    tokenIndex.set(token, list);
  }
});

const seenPairs = new Set<string>();
const candidates: object[] = [];

for (let i = 0; i < issues.length; i++) {
  const candidateIndexes = new Set<number>();

  for (const token of issues[i].tokens) {
    for (const index of tokenIndex.get(token) ?? []) {
      if (index > i) candidateIndexes.add(index);
    }
  }

  for (const j of candidateIndexes) {
    const key = `${i}:${j}`;
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);

    const tokenScore = jaccard(issues[i].tokens, issues[j].tokens);
    const charScore = dice(issues[i].trigrams, issues[j].trigrams);

    // This stage is deliberately permissive.
    // These are only candidates for semantic review.
    if (tokenScore < 0.45 && charScore < 0.70) continue;

    candidates.push({
      key_a: issues[i].key,
      key_b: issues[j].key,

      examples_a: issues[i].examples.map((e) => ({
        bill_id: e.bill_id,
        domain: e.raw_domain,
        policy_change: e.policy_change,
        pro_stance: e.pro_stance,
        con_stance: e.con_stance,
       })),

      examples_b: issues[j].examples.map((e) => ({
        bill_id: e.bill_id,
        domain: e.raw_domain,
        policy_change: e.policy_change,
        pro_stance: e.pro_stance,
        con_stance: e.con_stance,
       })),

      issue_a:
        issues[i].examples[0]?.raw_issue ??
        issues[i].key,

      issue_b:
        issues[j].examples[0]?.raw_issue ??
        issues[j].key,

      token_similarity: Number(tokenScore.toFixed(3)),
      char_similarity: Number(charScore.toFixed(3)),

      count_a: issues[i].count,
      count_b: issues[j].count,

      domains_a: [...issues[i].domains],
      domains_b: [...issues[j].domains],

      example_a: {
        bill_id: issues[i].examples[0]?.bill_id,
        policy_change: issues[i].examples[0]?.policy_change,
        pro_stance: issues[i].examples[0]?.pro_stance,
        con_stance: issues[i].examples[0]?.con_stance,
      },

      example_b: {
        bill_id: issues[j].examples[0]?.bill_id,
        policy_change: issues[j].examples[0]?.policy_change,
        pro_stance: issues[j].examples[0]?.pro_stance,
        con_stance: issues[j].examples[0]?.con_stance,
      },
    });
  }
}

candidates.sort((a: any, b: any) => {
  const scoreA = Math.max(a.token_similarity, a.char_similarity);
  const scoreB = Math.max(b.token_similarity, b.char_similarity);
  return scoreB - scoreA;
});

fs.writeFileSync(
  OUTPUT,
  candidates.map((x) => JSON.stringify(x)).join("\n") + "\n",
);

console.log("=== CANDIDATE GENERATION ===");
console.log("unique issues:", issues.length);
console.log("candidate pairs:", candidates.length);
console.log("output:", OUTPUT);

console.log("\n=== TOP 30 ===");

console.table(
  candidates.slice(0, 30).map((c: any) => ({
    token: c.token_similarity,
    char: c.char_similarity,
    issue_a: c.issue_a,
    issue_b: c.issue_b,
  })),
);