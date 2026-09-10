import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

type CanonicalMapping = {
  bill_id: number;
  bill_title: string;
  canonical_issue_id: string;
  canonical_issue_name: string;
  topic: string;
  subtopic: string;
};

type VoteRow = {
  vote_id: number;
  vote_title: string | null;
  vote_date: string | null;
};

type MkVoteRow = {
  mk_id: number;
  first_name: string | null;
  last_name: string | null;
  faction_name: string | null;
  result_code: number;
};

function resultName(code: number): string {
  switch (code) {
    case 6:
      return "PRESENT";
    case 7:
      return "FOR";
    case 8:
      return "AGAINST";
    case 9:
      return "ABSTAIN";
    default:
      return `OTHER_${code}`;
  }
}

const canonicalIssueId = process.argv[2];

if (!canonicalIssueId) {
  console.error(
    "Usage: npx tsx scripts/query-canonical-issue-votes.ts <canonical_issue_id>",
  );
  process.exit(1);
}

const mappingPath = path.join(
  process.cwd(),
  "data/policy-analysis/canonical/bill-issue-mapping.jsonl",
);

const dbPath = path.join(process.cwd(), "knesset.db");

const mappings = fs
  .readFileSync(mappingPath, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as CanonicalMapping)
  .filter((row) => row.canonical_issue_id === canonicalIssueId);

if (mappings.length === 0) {
  console.error(`Canonical issue not found: ${canonicalIssueId}`);
  process.exit(1);
}

const first = mappings[0];

const uniqueBills = new Map<number, CanonicalMapping>();

for (const row of mappings) {
  uniqueBills.set(row.bill_id, row);
}

const db = new Database(dbPath, { readonly: true });

const voteQuery = db.prepare(`
  SELECT
    id AS vote_id,
    title AS vote_title,
    date AS vote_date
  FROM plenary_vote
  WHERE bill_id = ?
  ORDER BY date, id
`);

const mkVoteQuery = db.prepare(`
  SELECT
    r.mk_id,
    p.first_name,
    p.last_name,
    p.faction_name,
    r.result_code
  FROM mk_vote_result r
  LEFT JOIN mk_person p
    ON p.person_id = r.mk_id
  WHERE r.vote_id = ?
  ORDER BY
    COALESCE(p.last_name, ''),
    COALESCE(p.first_name, ''),
    r.mk_id
`);

const bills = [];

for (const mapping of uniqueBills.values()) {
  const voteRows = voteQuery.all(mapping.bill_id) as VoteRow[];

  const votes = voteRows.map((vote) => {
    const mkRows = mkVoteQuery.all(vote.vote_id) as MkVoteRow[];

    return {
      vote_id: vote.vote_id,
      date: vote.vote_date,
      title: vote.vote_title,
      mk_votes: mkRows.map((row) => ({
        mk_id: row.mk_id,
        mk_name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(),
        faction: row.faction_name,
        result_code: row.result_code,
        result: resultName(row.result_code),
      })),
    };
  });

  bills.push({
    bill_id: mapping.bill_id,
    bill_title: mapping.bill_title,
    votes,
  });
}

db.close();

console.log(
  JSON.stringify(
    {
      canonical_issue_id: canonicalIssueId,
      canonical_issue_name: first.canonical_issue_name,
      topic: first.topic,
      subtopic: first.subtopic,
      bill_count: bills.length,
      bills,
    },
    null,
    2,
  ),
);
