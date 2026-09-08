import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient, type InStatement } from "@libsql/client";
import fs from "fs";
import path from "path";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 200;

if (!process.env.TURSO_URL) {
  throw new Error("TURSO_URL not set in .env.local");
}

if (!process.env.TURSO_TOKEN) {
  throw new Error("TURSO_TOKEN not set in .env.local");
}

const turso = createClient({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN,
});

const ROOT = process.cwd();

const CANONICAL_FILE = path.join(
  ROOT,
  "data/policy-analysis/canonical/issues.jsonl",
);

const MAPPING_FILE = path.join(
  ROOT,
  "data/policy-analysis/canonical/bill-issue-mapping.jsonl",
);

const POLICY_FILE = path.join(
  ROOT,
  "data/policy-analysis/issues.fulltext-v1.jsonl",
);

function readJsonl(file: string): any[] {
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function json(value: any): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return JSON.stringify(value);
}

function bool(value: any): number {
  return value ? 1 : 0;
}

async function pushBatches(
  rows: any[],
  toStatement: (row: any) => InStatement,
  label: string,
) {
  if (DRY_RUN) {
    console.log(`${label}: ${rows.length.toLocaleString()} rows`);
    return;
  }

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map(toStatement);

    await turso.batch(batch, "write");

    const done = Math.min(i + BATCH_SIZE, rows.length);

    if (done % 5000 === 0 || done === rows.length) {
      console.log(
        `${label}: ${done.toLocaleString()} / ${rows.length.toLocaleString()}`,
      );
    }
  }
}

async function ensureSchema() {
  if (DRY_RUN) {
    console.log("Would create/verify:");
    console.log("  canonical_issue");
    console.log("  bill_issue_mapping");
    console.log("  bill_issue_policy");
    return;
  }

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS canonical_issue (
      canonical_issue_id TEXT PRIMARY KEY,
      canonical_issue_name TEXT NOT NULL,
      cluster_size INTEGER,
      issue_instance_count INTEGER,
      bill_count INTEGER,

      member_keys_json TEXT,
      member_labels_json TEXT,
      domains_json TEXT,
      merged_baseline_issue_ids_json TEXT,
      semantic_merge_count INTEGER,

      topic TEXT NOT NULL,
      subtopic TEXT NOT NULL,

      classification_confidence TEXT,
      classification_score REAL,
      classification_margin REAL,
      subtopic_margin REAL,

      alternative_topic TEXT,
      alternative_subtopic TEXT,

      review_required INTEGER NOT NULL DEFAULT 0,
      classification_method TEXT
    )
  `);

  await turso.execute(`
    CREATE INDEX IF NOT EXISTS idx_canonical_issue_topic_subtopic
    ON canonical_issue(topic, subtopic)
  `);

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS bill_issue_mapping (
      bill_id INTEGER NOT NULL,
      issue_index INTEGER NOT NULL,

      bill_title TEXT,
      raw_domain TEXT,
      raw_issue TEXT NOT NULL,
      normalized_issue TEXT,

      canonical_issue_id TEXT NOT NULL,
      canonical_issue_name TEXT,

      cluster_size INTEGER,
      is_primary INTEGER,
      issue_confidence REAL,

      topic TEXT,
      subtopic TEXT,
      classification_confidence TEXT,
      review_required INTEGER NOT NULL DEFAULT 0,

      PRIMARY KEY (bill_id, issue_index)
    )
  `);

  await turso.execute(`
    CREATE INDEX IF NOT EXISTS idx_bill_issue_mapping_canonical
    ON bill_issue_mapping(canonical_issue_id)
  `);

  await turso.execute(`
    CREATE TABLE IF NOT EXISTS bill_issue_policy (
      bill_id INTEGER NOT NULL,
      issue_index INTEGER NOT NULL,

      canonical_issue_id TEXT NOT NULL,

      domain TEXT,
      issue TEXT NOT NULL,

      policy_change TEXT,
      pro_stance TEXT,
      con_stance TEXT,
      explanation TEXT,

      confidence REAL,
      is_primary INTEGER,

      evidence_json TEXT,

      PRIMARY KEY (bill_id, issue_index)
    )
  `);

  await turso.execute(`
    CREATE INDEX IF NOT EXISTS idx_bill_issue_policy_canonical
    ON bill_issue_policy(canonical_issue_id)
  `);
}

async function main() {
  console.log(
    DRY_RUN
      ? "=== CANONICAL POLICY DRY RUN ==="
      : "=== CANONICAL POLICY TURSO SYNC ===",
  );

  const canonical = readJsonl(CANONICAL_FILE);
  const mapping = readJsonl(MAPPING_FILE);
  const policyBills = readJsonl(POLICY_FILE);

  const canonicalIds = new Set(
    canonical.map((row) => String(row.canonical_issue_id)),
  );

  const policyByBill = new Map<number, any>();

  for (const row of policyBills) {
    policyByBill.set(Number(row.bill_id), row);
  }

  const derivedPolicy: any[] = [];

  let missingBill = 0;
  let badIndex = 0;
  let issueMismatch = 0;
  let unknownCanonical = 0;

  for (const m of mapping) {
    const billId = Number(m.bill_id);
    const issueIndex = Number(m.issue_index);

    if (!canonicalIds.has(String(m.canonical_issue_id))) {
      unknownCanonical++;
      continue;
    }

    const billPolicy = policyByBill.get(billId);

    if (!billPolicy) {
      missingBill++;
      continue;
    }

    const issues = Array.isArray(billPolicy.issues)
      ? billPolicy.issues
      : [];

    if (issueIndex < 0 || issueIndex >= issues.length) {
      badIndex++;
      continue;
    }

    const issue = issues[issueIndex];

    if (issue.issue !== m.raw_issue) {
      issueMismatch++;
      continue;
    }

    derivedPolicy.push({
      bill_id: billId,
      issue_index: issueIndex,
      canonical_issue_id: m.canonical_issue_id,
      domain: issue.domain ?? null,
      issue: issue.issue,
      policy_change: issue.policy_change ?? null,
      pro_stance: issue.pro_stance ?? null,
      con_stance: issue.con_stance ?? null,
      explanation: issue.explanation ?? null,
      confidence: issue.confidence ?? null,
      is_primary: issue.is_primary,
      evidence: issue.evidence ?? null,
    });
  }

  console.log("\nSource validation:");
  console.log(
    `canonical_issue:       ${canonical.length.toLocaleString()}`,
  );
  console.log(
    `bill_issue_mapping:    ${mapping.length.toLocaleString()}`,
  );
  console.log(
    `bill_issue_policy:     ${derivedPolicy.length.toLocaleString()}`,
  );
  console.log(`missing_bill:          ${missingBill}`);
  console.log(`bad_index:             ${badIndex}`);
  console.log(`issue_mismatch:        ${issueMismatch}`);
  console.log(`unknown_canonical:     ${unknownCanonical}`);

  if (
    missingBill !== 0 ||
    badIndex !== 0 ||
    issueMismatch !== 0 ||
    unknownCanonical !== 0 ||
    derivedPolicy.length !== mapping.length
  ) {
    throw new Error(
      "Canonical policy validation failed; refusing to write to Turso.",
    );
  }

  console.log("\nSchema:");
  await ensureSchema();

  console.log("\nData:");

  await pushBatches(
    canonical,
    (r) => ({
      sql: `
        INSERT INTO canonical_issue (
          canonical_issue_id,
          canonical_issue_name,
          cluster_size,
          issue_instance_count,
          bill_count,
          member_keys_json,
          member_labels_json,
          domains_json,
          merged_baseline_issue_ids_json,
          semantic_merge_count,
          topic,
          subtopic,
          classification_confidence,
          classification_score,
          classification_margin,
          subtopic_margin,
          alternative_topic,
          alternative_subtopic,
          review_required,
          classification_method
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(canonical_issue_id) DO UPDATE SET
          canonical_issue_name = excluded.canonical_issue_name,
          cluster_size = excluded.cluster_size,
          issue_instance_count = excluded.issue_instance_count,
          bill_count = excluded.bill_count,
          member_keys_json = excluded.member_keys_json,
          member_labels_json = excluded.member_labels_json,
          domains_json = excluded.domains_json,
          merged_baseline_issue_ids_json =
            excluded.merged_baseline_issue_ids_json,
          semantic_merge_count = excluded.semantic_merge_count,
          topic = excluded.topic,
          subtopic = excluded.subtopic,
          classification_confidence =
            excluded.classification_confidence,
          classification_score = excluded.classification_score,
          classification_margin = excluded.classification_margin,
          subtopic_margin = excluded.subtopic_margin,
          alternative_topic = excluded.alternative_topic,
          alternative_subtopic = excluded.alternative_subtopic,
          review_required = excluded.review_required,
          classification_method = excluded.classification_method
      `,
      args: [
        r.canonical_issue_id,
        r.canonical_issue_name,
        r.cluster_size ?? null,
        r.issue_instance_count ?? null,
        r.bill_count ?? null,
        json(r.member_keys),
        json(r.member_labels),
        json(r.domains),
        json(r.merged_baseline_issue_ids),
        r.semantic_merge_count ?? null,
        r.topic,
        r.subtopic,
        r.classification_confidence ?? null,
        r.classification_score ?? null,
        r.classification_margin ?? null,
        r.subtopic_margin ?? null,
        r.alternative_topic ?? null,
        r.alternative_subtopic ?? null,
        bool(r.review_required),
        r.classification_method ?? null,
      ],
    }),
    "canonical_issue",
  );

  await pushBatches(
    mapping,
    (r) => ({
      sql: `
        INSERT INTO bill_issue_mapping (
          bill_id,
          issue_index,
          bill_title,
          raw_domain,
          raw_issue,
          normalized_issue,
          canonical_issue_id,
          canonical_issue_name,
          cluster_size,
          is_primary,
          issue_confidence,
          topic,
          subtopic,
          classification_confidence,
          review_required
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(bill_id, issue_index) DO UPDATE SET
          bill_title = excluded.bill_title,
          raw_domain = excluded.raw_domain,
          raw_issue = excluded.raw_issue,
          normalized_issue = excluded.normalized_issue,
          canonical_issue_id = excluded.canonical_issue_id,
          canonical_issue_name = excluded.canonical_issue_name,
          cluster_size = excluded.cluster_size,
          is_primary = excluded.is_primary,
          issue_confidence = excluded.issue_confidence,
          topic = excluded.topic,
          subtopic = excluded.subtopic,
          classification_confidence =
            excluded.classification_confidence,
          review_required = excluded.review_required
      `,
      args: [
        Number(r.bill_id),
        Number(r.issue_index),
        r.bill_title ?? null,
        r.raw_domain ?? null,
        r.raw_issue,
        r.normalized_issue ?? null,
        r.canonical_issue_id,
        r.canonical_issue_name ?? null,
        r.cluster_size ?? null,
        bool(r.is_primary),
        r.issue_confidence ?? null,
        r.topic ?? null,
        r.subtopic ?? null,
        r.classification_confidence ?? null,
        bool(r.review_required),
      ],
    }),
    "bill_issue_mapping",
  );

  await pushBatches(
    derivedPolicy,
    (r) => ({
      sql: `
        INSERT INTO bill_issue_policy (
          bill_id,
          issue_index,
          canonical_issue_id,
          domain,
          issue,
          policy_change,
          pro_stance,
          con_stance,
          explanation,
          confidence,
          is_primary,
          evidence_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(bill_id, issue_index) DO UPDATE SET
          canonical_issue_id = excluded.canonical_issue_id,
          domain = excluded.domain,
          issue = excluded.issue,
          policy_change = excluded.policy_change,
          pro_stance = excluded.pro_stance,
          con_stance = excluded.con_stance,
          explanation = excluded.explanation,
          confidence = excluded.confidence,
          is_primary = excluded.is_primary,
          evidence_json = excluded.evidence_json
      `,
      args: [
        r.bill_id,
        r.issue_index,
        r.canonical_issue_id,
        r.domain,
        r.issue,
        r.policy_change,
        r.pro_stance,
        r.con_stance,
        r.explanation,
        r.confidence,
        bool(r.is_primary),
        json(r.evidence),
      ],
    }),
    "bill_issue_policy",
  );

  if (!DRY_RUN) {
    console.log("\nTurso validation:");

    for (const table of [
      "canonical_issue",
      "bill_issue_mapping",
      "bill_issue_policy",
    ]) {
      const result = await turso.execute(
        `SELECT COUNT(*) AS n FROM ${table}`,
      );

      console.log(
        `${table}: ${Number(result.rows[0].n).toLocaleString()}`,
      );
    }
  }

  console.log(
    DRY_RUN
      ? "\nDry run completed — nothing was written to Turso."
      : "\nCanonical policy sync completed successfully.",
  );
}

main().catch((err) => {
  console.error("\nSYNC FAILED:");
  console.error(err);
  process.exitCode = 1;
});
