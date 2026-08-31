import { computeMatch } from "../src/lib/compute-match";

const answers = [
  {
    issueId: "women-equality",
    stanceId: "support-equality",
  },
  {
    issueId: "haredi-draft",
    stanceId: "support-draft",
  },
  {
    issueId: "worker-rights",
    stanceId: "support-worker-protection",
  },
];

const results = computeMatch(answers);

console.log("");
console.log("Top MK Matches");
console.log("");

console.table(
  results.slice(0, 20).map((result) => ({
    mkId: result.mkId,
    name: result.name,
    faction: result.faction,
    matchPercent: result.matchPercent,
    confidencePercent: result.confidencePercent,
    evidenceCount: result.evidenceCount,
    matchingVotes: result.matchingVotes,
    opposingVotes: result.opposingVotes,
    abstentions: result.abstentions,
    totalRelevantBills: result.totalRelevantBills,
  })),
);

console.log("");
console.log("Top 5 - Issue Breakdown");
console.log("");

for (const result of results.slice(0, 5)) {
  console.log("");
  console.log(
    `${result.name} | ${result.faction ?? "ללא סיעה"} | ${result.matchPercent}%`,
  );

  console.table(
    result.issueMatches.map((issue) => ({
      issueId: issue.issueId,
      userStance: issue.stanceId,
      matchingVotes: issue.matchingVotes,
      opposingVotes: issue.opposingVotes,
      abstentions: issue.abstentions,
      relevantBills: issue.totalRelevantBills,
      issueMatchPercent: Math.round(issue.score * 100),
    })),
  );
}
