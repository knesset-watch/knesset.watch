import fs from "node:fs";
import crypto from "node:crypto";

const INPUT_PATH =
  "/tmp/canonical-agenda-input.jsonl";

const CANDIDATES_PATH =
  "/tmp/canonical-agenda-candidates.jsonl";

const ADJUDICATIONS_PATH =
  "/tmp/canonical-agenda-adjudications.jsonl";

const CLUSTERS_OUTPUT_PATH =
  "/tmp/canonical-agenda-clusters.jsonl";

const MAPPING_OUTPUT_PATH =
  "/tmp/canonical-agenda-mapping.jsonl";

const REVIEW_OUTPUT_PATH =
  "/tmp/canonical-agenda-cluster-review.jsonl";

type InputRow = {
  bill_id: number;
  bill_title?: string;
  issue_index?: number;

  raw_domain?: string;
  normalized_domain?: string;

  raw_issue: string;
  normalized_issue: string;

  policy_change?: string;
  pro_stance?: string;
  con_stance?: string;
  explanation?: string;

  issue_confidence?: number;
  is_primary?: boolean;

  analysis_confidence?: number;
  needs_review?: boolean;

  text_chars?: number;
  rtl_repaired?: boolean;
};

type Candidate = {
  key_a: string;
  key_b: string;

  issue_a: string;
  issue_b: string;

  token_similarity: number;
  char_similarity: number;
};

type Decision =
  | "SAME_ISSUE"
  | "RELATED_BUT_DISTINCT"
  | "DIFFERENT";

type Adjudication = {
  pair_id: string;
  decision: Decision;
  confidence: number;
  reason: string;
  canonical_name: string | null;
};

type NodeInfo = {
  key: string;
  labels: Map<string, number>;
  domains: Map<string, number>;
  billIds: Set<number>;
  issueInstances: number;
};

type CanonicalCluster = {
  canonical_issue_id: string;
  canonical_issue_name: string;

  cluster_size: number;
  issue_instance_count: number;
  bill_count: number;

  member_keys: string[];
  member_labels: string[];
  domains: string[];

  canonical_name_candidates: Array<{
    name: string;
    count: number;
  }>;

  review_required: boolean;
  source_component_id: string;
};

function readJsonl<T>(path: string): T[] {
  if (!fs.existsSync(path)) {
    throw new Error(`Missing file: ${path}`);
  }

  return fs
    .readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function writeJsonl(
  path: string,
  rows: unknown[],
): void {
  fs.writeFileSync(
    path,
    rows
      .map((row) => JSON.stringify(row))
      .join("\n") + "\n",
  );
}

function pairId(
  keyA: string,
  keyB: string,
): string {
  return [keyA, keyB]
    .sort()
    .join("|||");
}

function shortHash(value: string): string {
  return crypto
    .createHash("sha1")
    .update(value)
    .digest("hex")
    .slice(0, 10);
}

function addCount(
  map: Map<string, number>,
  value: string | undefined,
): void {
  if (!value) {
    return;
  }

  const cleaned = value.trim();

  if (!cleaned) {
    return;
  }

  map.set(
    cleaned,
    (map.get(cleaned) ?? 0) + 1,
  );
}

function sortCountMap(
  map: Map<string, number>,
): Array<{
  name: string;
  count: number;
}> {
  return [...map.entries()]
    .map(([name, count]) => ({
      name,
      count,
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.name.length - b.name.length ||
        a.name.localeCompare(b.name, "he"),
    );
}

function mostCommon(
  map: Map<string, number>,
): string | undefined {
  return sortCountMap(map)[0]?.name;
}

function ensureAdjacency(
  adjacency: Map<string, Set<string>>,
  key: string,
): Set<string> {
  let set = adjacency.get(key);

  if (!set) {
    set = new Set<string>();
    adjacency.set(key, set);
  }

  return set;
}

function connectedComponents(
  keys: string[],
  adjacency: Map<string, Set<string>>,
): string[][] {
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const start of keys) {
    if (visited.has(start)) {
      continue;
    }

    const stack = [start];
    const component: string[] = [];

    visited.add(start);

    while (stack.length > 0) {
      const current = stack.pop();

      if (!current) {
        continue;
      }

      component.push(current);

      for (
        const neighbor of
        adjacency.get(current) ?? []
      ) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }

    components.push(
      component.sort(),
    );
  }

  return components;
}

function degreeWithin(
  key: string,
  remaining: Set<string>,
  adjacency: Map<string, Set<string>>,
): number {
  let degree = 0;

  for (
    const neighbor of
    adjacency.get(key) ?? []
  ) {
    if (remaining.has(neighbor)) {
      degree++;
    }
  }

  return degree;
}

/**
 * Conservative clustering:
 *
 * Every pair of members inside a returned cluster must have
 * an explicit SAME_ISSUE edge.
 *
 * This deliberately avoids blind transitive merging:
 *
 * A SAME B
 * B SAME C
 *
 * does NOT automatically imply:
 *
 * A SAME C
 */
function splitIntoConservativeClusters(
  component: string[],
  adjacency: Map<string, Set<string>>,
): string[][] {
  const remaining =
    new Set(component);

  const clusters: string[][] = [];

  while (remaining.size > 0) {
    const ordered =
      [...remaining].sort(
        (a, b) =>
          degreeWithin(
            b,
            remaining,
            adjacency,
          ) -
            degreeWithin(
              a,
              remaining,
              adjacency,
            ) ||
          a.localeCompare(b, "he"),
      );

    const seed = ordered[0];

    if (!seed) {
      break;
    }

    const cluster = [seed];

    remaining.delete(seed);

    const candidates =
      [...remaining].sort(
        (a, b) =>
          degreeWithin(
            b,
            remaining,
            adjacency,
          ) -
            degreeWithin(
              a,
              remaining,
              adjacency,
            ) ||
          a.localeCompare(b, "he"),
      );

    for (const candidate of candidates) {
      const candidateNeighbors =
        adjacency.get(candidate) ??
        new Set<string>();

      const isSameAsEveryMember =
        cluster.every((member) =>
          candidateNeighbors.has(member),
        );

      if (isSameAsEveryMember) {
        cluster.push(candidate);
        remaining.delete(candidate);
      }
    }

    clusters.push(
      cluster.sort(),
    );
  }

  return clusters;
}

function main(): void {
  const input =
    readJsonl<InputRow>(INPUT_PATH);

  const candidates =
    readJsonl<Candidate>(
      CANDIDATES_PATH,
    );

  const adjudications =
    readJsonl<Adjudication>(
      ADJUDICATIONS_PATH,
    );

  console.log(
    "=== BUILD CANONICAL AGENDA CLUSTERS ===",
  );

  console.log(
    "issue instances:",
    input.length,
  );

  console.log(
    "candidate pairs:",
    candidates.length,
  );

  console.log(
    "adjudications:",
    adjudications.length,
  );

  if (
    adjudications.length !==
    candidates.length
  ) {
    console.warn(
      "WARNING: candidate/adjudication counts differ",
    );
  }

  const nodes =
    new Map<string, NodeInfo>();

  for (const row of input) {
    if (!row.normalized_issue) {
      continue;
    }

    let node =
      nodes.get(row.normalized_issue);

    if (!node) {
      node = {
        key: row.normalized_issue,
        labels: new Map(),
        domains: new Map(),
        billIds: new Set(),
        issueInstances: 0,
      };

      nodes.set(
        row.normalized_issue,
        node,
      );
    }

    node.issueInstances++;

    node.billIds.add(
      row.bill_id,
    );

    addCount(
      node.labels,
      row.raw_issue,
    );

    addCount(
      node.domains,
      row.raw_domain,
    );
  }

  console.log(
    "unique normalized issues:",
    nodes.size,
  );

  const candidateByPair =
    new Map<string, Candidate>();

  for (const candidate of candidates) {
    candidateByPair.set(
      pairId(
        candidate.key_a,
        candidate.key_b,
      ),
      candidate,
    );
  }

  const adjudicationByPair =
    new Map<string, Adjudication>();

  for (
    const adjudication of adjudications
  ) {
    adjudicationByPair.set(
      adjudication.pair_id,
      adjudication,
    );
  }

  const decisionCounts: Record<
    Decision,
    number
  > = {
    SAME_ISSUE: 0,
    RELATED_BUT_DISTINCT: 0,
    DIFFERENT: 0,
  };

  const sameAdjacency =
    new Map<string, Set<string>>();

  for (const key of nodes.keys()) {
    ensureAdjacency(
      sameAdjacency,
      key,
    );
  }

  for (
    const adjudication of adjudications
  ) {
    decisionCounts[
      adjudication.decision
    ]++;

    if (
      adjudication.decision !==
      "SAME_ISSUE"
    ) {
      continue;
    }

    const candidate =
      candidateByPair.get(
        adjudication.pair_id,
      );

    if (!candidate) {
      throw new Error(
        `Missing candidate for pair ${adjudication.pair_id}`,
      );
    }

    ensureAdjacency(
      sameAdjacency,
      candidate.key_a,
    ).add(candidate.key_b);

    ensureAdjacency(
      sameAdjacency,
      candidate.key_b,
    ).add(candidate.key_a);
  }

  console.log(
    "SAME_ISSUE:",
    decisionCounts.SAME_ISSUE,
  );

  console.log(
    "RELATED_BUT_DISTINCT:",
    decisionCounts.RELATED_BUT_DISTINCT,
  );

  console.log(
    "DIFFERENT:",
    decisionCounts.DIFFERENT,
  );

  const components =
    connectedComponents(
      [...nodes.keys()].sort(),
      sameAdjacency,
    );

  const clusterByKey =
    new Map<
      string,
      CanonicalCluster
    >();

  const clusters:
    CanonicalCluster[] = [];

  const reviewRows:
    unknown[] = [];

  let reviewComponentCount = 0;

  for (const component of components) {
    const conservativeClusters =
      splitIntoConservativeClusters(
        component,
        sameAdjacency,
      );

    const componentId =
      `cc_${shortHash(
        component[0],
      )}`;

    const reviewRequired =
      component.length > 1 &&
      conservativeClusters.length > 1;

    if (reviewRequired) {
      reviewComponentCount++;
    }

    const componentSet =
      new Set(component);

    const explicitNonSamePairs:
      unknown[] = [];

    let adjudicatedPairsInside = 0;
    let samePairsInside = 0;

    for (
      let i = 0;
      i < component.length;
      i++
    ) {
      for (
        let j = i + 1;
        j < component.length;
        j++
      ) {
        const id = pairId(
          component[i],
          component[j],
        );

        const adjudication =
          adjudicationByPair.get(id);

        if (!adjudication) {
          continue;
        }

        adjudicatedPairsInside++;

        if (
          adjudication.decision ===
          "SAME_ISSUE"
        ) {
          samePairsInside++;
        } else {
          const candidate =
            candidateByPair.get(id);

          explicitNonSamePairs.push({
            key_a: component[i],
            key_b: component[j],

            issue_a:
              candidate?.issue_a,
            issue_b:
              candidate?.issue_b,

            decision:
              adjudication.decision,

            confidence:
              adjudication.confidence,

            reason:
              adjudication.reason,
          });
        }
      }
    }

    const totalPossiblePairs =
      (component.length *
        (component.length - 1)) /
      2;

    const untestedPairs =
      totalPossiblePairs -
      adjudicatedPairsInside;

    const proposedClusters:
      CanonicalCluster[] = [];

    for (
      const memberKeys of
      conservativeClusters
    ) {
      const canonicalNames =
        new Map<string, number>();

      const labels =
        new Map<string, number>();

      const domains =
        new Map<string, number>();

      const billIds =
        new Set<number>();

      let issueInstanceCount = 0;

      for (
        const key of memberKeys
      ) {
        const node = nodes.get(key);

        if (!node) {
          continue;
        }

        issueInstanceCount +=
          node.issueInstances;

        for (
          const billId of
          node.billIds
        ) {
          billIds.add(billId);
        }

        for (
          const [
            label,
            count,
          ] of node.labels
        ) {
          labels.set(
            label,
            (labels.get(label) ?? 0) +
              count,
          );
        }

        for (
          const [
            domain,
            count,
          ] of node.domains
        ) {
          domains.set(
            domain,
            (domains.get(domain) ?? 0) +
              count,
          );
        }
      }

      for (
        let i = 0;
        i < memberKeys.length;
        i++
      ) {
        for (
          let j = i + 1;
          j < memberKeys.length;
          j++
        ) {
          const id = pairId(
            memberKeys[i],
            memberKeys[j],
          );

          const adjudication =
            adjudicationByPair.get(id);

          if (
            adjudication?.decision ===
              "SAME_ISSUE" &&
            adjudication.canonical_name
          ) {
            addCount(
              canonicalNames,
              adjudication.canonical_name,
            );
          }
        }
      }

      const fallbackName =
        mostCommon(labels) ??
        memberKeys[0];

      const canonicalName =
        mostCommon(canonicalNames) ??
        fallbackName;

      const stableKey =
        [...memberKeys]
          .sort()[0];

      const canonicalIssueId =
        `ci_${shortHash(
          stableKey,
        )}`;

      const cluster:
        CanonicalCluster = {
        canonical_issue_id:
          canonicalIssueId,

        canonical_issue_name:
          canonicalName,

        cluster_size:
          memberKeys.length,

        issue_instance_count:
          issueInstanceCount,

        bill_count:
          billIds.size,

        member_keys:
          [...memberKeys].sort(),

        member_labels:
          [...labels.keys()].sort(
            (a, b) =>
              a.localeCompare(
                b,
                "he",
              ),
          ),

        domains:
          sortCountMap(domains).map(
            (row) => row.name,
          ),

        canonical_name_candidates:
          sortCountMap(
            canonicalNames,
          ),

        review_required:
          reviewRequired,

        source_component_id:
          componentId,
      };

      clusters.push(cluster);

      proposedClusters.push(
        cluster,
      );

      for (
        const key of memberKeys
      ) {
        if (
          clusterByKey.has(key)
        ) {
          throw new Error(
            `Issue key assigned twice: ${key}`,
          );
        }

        clusterByKey.set(
          key,
          cluster,
        );
      }
    }

    if (reviewRequired) {
      reviewRows.push({
        component_id:
          componentId,

        member_count:
          component.length,

        members:
          component.map((key) => ({
            key,
            labels: [
              ...(
                nodes.get(key)
                  ?.labels.keys() ??
                []
              ),
            ],
          })),

        total_possible_pairs:
          totalPossiblePairs,

        adjudicated_pairs:
          adjudicatedPairsInside,

        same_pairs:
          samePairsInside,

        untested_pairs:
          untestedPairs,

        explicit_non_same_pairs:
          explicitNonSamePairs,

        proposed_clusters:
          proposedClusters.map(
            (cluster) => ({
              canonical_issue_id:
                cluster.canonical_issue_id,

              canonical_issue_name:
                cluster.canonical_issue_name,

              member_keys:
                cluster.member_keys,

              member_labels:
                cluster.member_labels,
            }),
          ),
      });
    }
  }

  if (
    clusterByKey.size !== nodes.size
  ) {
    throw new Error(
      `Not all issues were assigned: ${clusterByKey.size}/${nodes.size}`,
    );
  }

  clusters.sort(
    (a, b) =>
      b.cluster_size -
        a.cluster_size ||
      a.canonical_issue_name.localeCompare(
        b.canonical_issue_name,
        "he",
      ),
  );

  const mapping =
    input.map((row) => {
      const cluster =
        clusterByKey.get(
          row.normalized_issue,
        );

      if (!cluster) {
        throw new Error(
          `Missing cluster for ${row.normalized_issue}`,
        );
      }

      return {
        bill_id: row.bill_id,
        bill_title:
          row.bill_title,

        issue_index:
          row.issue_index,

        raw_domain:
          row.raw_domain,

        raw_issue:
          row.raw_issue,

        normalized_issue:
          row.normalized_issue,

        canonical_issue_id:
          cluster.canonical_issue_id,

        canonical_issue_name:
          cluster.canonical_issue_name,

        cluster_size:
          cluster.cluster_size,

        is_primary:
          row.is_primary,

        issue_confidence:
          row.issue_confidence,
      };
    });

  writeJsonl(
    CLUSTERS_OUTPUT_PATH,
    clusters,
  );

  writeJsonl(
    MAPPING_OUTPUT_PATH,
    mapping,
  );

  writeJsonl(
    REVIEW_OUTPUT_PATH,
    reviewRows,
  );

  const multiMemberClusters =
    clusters.filter(
      (cluster) =>
        cluster.cluster_size > 1,
    );

  const singletonClusters =
    clusters.filter(
      (cluster) =>
        cluster.cluster_size === 1,
    );

  const largestCluster =
    Math.max(
      ...clusters.map(
        (cluster) =>
          cluster.cluster_size,
      ),
    );

  console.log();
  console.log("=== RESULT ===");

  console.log(
    "canonical issues:",
    clusters.length,
  );

  console.log(
    "multi-member clusters:",
    multiMemberClusters.length,
  );

  console.log(
    "singleton clusters:",
    singletonClusters.length,
  );

  console.log(
    "issues consolidated:",
    nodes.size - clusters.length,
  );

  console.log(
    "review components:",
    reviewComponentCount,
  );

  console.log(
    "largest cluster:",
    largestCluster,
  );

  console.log(
    "mapping rows:",
    mapping.length,
  );

  console.log();
  console.log(
    "clusters:",
    CLUSTERS_OUTPUT_PATH,
  );

  console.log(
    "mapping:",
    MAPPING_OUTPUT_PATH,
  );

  console.log(
    "review:",
    REVIEW_OUTPUT_PATH,
  );
}

main();