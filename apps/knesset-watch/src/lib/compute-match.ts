import Database from "better-sqlite3";
import path from "path";

export type UserAnswer = {
  issueId: string;
  stanceId: string;
};

export type MkIssueMatch = {
  issueId: string;
  stanceId: string;
  matchingVotes: number;
  opposingVotes: number;
  abstentions: number;
  totalRelevantBills: number;
  score: number;
  evidenceWeight: number;
};

export type MkMatchResult = {
  mkId: number;
  name: string;
  faction: string | null;
  rawScore: number;
  finalScore: number;
  matchPercent: number;
  confidencePercent: number;
  evidenceCount: number;
  matchingVotes: number;
  opposingVotes: number;
  abstentions: number;
  totalRelevantBills: number;
  issueMatches: MkIssueMatch[];
};

type DbRow = {
  bill_id: number;
  issue_id: string;
  law_stance_id: string;
  mk_id: number;
  mk_name: string;
  faction_name: string | null;
  result_code: number;
};

function getDatabase() {
  const dbPath = path.join(process.cwd(), "knesset.db");

  return new Database(dbPath, {
    readonly: true,
  });
}

function getRelevantRows(issueIds: string[]): DbRow[] {
  if (issueIds.length === 0) {
    return [];
  }

  const db = getDatabase();

  try {
    const placeholders = issueIds.map(() => "?").join(", ");

    const rows = db
      .prepare(
        `
        WITH unique_votes AS (
          SELECT
            id,
            bill_id,
            MAX(date) AS date
          FROM plenary_vote
          WHERE bill_id IS NOT NULL
          GROUP BY id, bill_id
        ),

        unique_results AS (
          SELECT
            vote_id,
            mk_id,
            MIN(result_code) AS result_code
          FROM mk_vote_result
          WHERE result_code IN (7, 8, 9)
          GROUP BY vote_id, mk_id
          HAVING COUNT(DISTINCT result_code) = 1
        ),

        unique_mks AS (
          SELECT
            person_id,
            MAX(first_name) AS first_name,
            MAX(last_name) AS last_name,
            MAX(faction_name) AS faction_name
          FROM mk_person
          GROUP BY person_id
        ),

        ranked_votes AS (
          SELECT
            c.bill_id,
            c.issue_id,
            c.stance_id AS law_stance_id,

            r.mk_id,
            r.result_code,

            TRIM(
              COALESCE(mp.first_name, '') || ' ' ||
              COALESCE(mp.last_name, '')
            ) AS mk_name,

            mp.faction_name,

            ROW_NUMBER() OVER (
              PARTITION BY c.bill_id, r.mk_id
              ORDER BY
                pv.date DESC,
                pv.id DESC
            ) AS rn

          FROM bill_political_classification c

          INNER JOIN unique_votes pv
            ON pv.bill_id = c.bill_id

          INNER JOIN unique_results r
            ON r.vote_id = pv.id

          LEFT JOIN unique_mks mp
            ON mp.person_id = r.mk_id

          WHERE
            c.issue_id IN (${placeholders})
            AND c.stance_id IS NOT NULL
        )

        SELECT
          bill_id,
          issue_id,
          law_stance_id,
          mk_id,
          mk_name,
          faction_name,
          result_code

        FROM ranked_votes

        WHERE rn = 1
        `,
      )
      .all(...issueIds) as DbRow[];

    return rows;
  } finally {
    db.close();
  }
}

function calculateEvidenceWeight(evidenceCount: number): number {
  if (evidenceCount <= 0) {
    return 0;
  }

  const targetEvidence = 20;

  return Math.min(1, Math.sqrt(evidenceCount / targetEvidence));
}

function calculateConfidencePercent(evidenceCount: number): number {
  const targetEvidence = 30;

  const confidence = 1 - Math.exp(-evidenceCount / targetEvidence);

  return Math.round(confidence * 100);
}

export function computeMatch(answers: UserAnswer[]): MkMatchResult[] {
  if (answers.length === 0) {
    return [];
  }

  const answersByIssue = new Map<string, string>();

  for (const answer of answers) {
    answersByIssue.set(answer.issueId, answer.stanceId);
  }

  const issueIds = [...answersByIssue.keys()];

  const rows = getRelevantRows(issueIds);

  const mkMap = new Map<
    number,
    {
      mkId: number;
      name: string;
      faction: string | null;
      matchingVotes: number;
      opposingVotes: number;
      abstentions: number;
      issueMap: Map<
        string,
        {
          issueId: string;
          stanceId: string;
          matchingVotes: number;
          opposingVotes: number;
          abstentions: number;
          totalRelevantBills: number;
        }
      >;
    }
  >();

  for (const row of rows) {
    const userStance = answersByIssue.get(row.issue_id);

    if (!userStance) {
      continue;
    }

    let mk = mkMap.get(row.mk_id);

    if (!mk) {
      mk = {
        mkId: row.mk_id,
        name: row.mk_name,
        faction: row.faction_name,
        matchingVotes: 0,
        opposingVotes: 0,
        abstentions: 0,
        issueMap: new Map(),
      };

      mkMap.set(row.mk_id, mk);
    }

    let issue = mk.issueMap.get(row.issue_id);

    if (!issue) {
      issue = {
        issueId: row.issue_id,
        stanceId: userStance,
        matchingVotes: 0,
        opposingVotes: 0,
        abstentions: 0,
        totalRelevantBills: 0,
      };

      mk.issueMap.set(row.issue_id, issue);
    }

    issue.totalRelevantBills += 1;

    const lawMatchesUser = row.law_stance_id === userStance;

    if (row.result_code === 9) {
      mk.abstentions += 1;
      issue.abstentions += 1;
      continue;
    }

    const votedFor = row.result_code === 7;
    const votedAgainst = row.result_code === 8;

    const isMatch =
      (lawMatchesUser && votedFor) || (!lawMatchesUser && votedAgainst);

    const isOpposition =
      (lawMatchesUser && votedAgainst) || (!lawMatchesUser && votedFor);

    if (isMatch) {
      mk.matchingVotes += 1;
      issue.matchingVotes += 1;
    }

    if (isOpposition) {
      mk.opposingVotes += 1;
      issue.opposingVotes += 1;
    }
  }

  const results: MkMatchResult[] = [];

  for (const mk of mkMap.values()) {
    const issueMatches: MkIssueMatch[] = [];

    let weightedScoreSum = 0;
    let totalIssueWeight = 0;

    for (const issue of mk.issueMap.values()) {
      const decisiveVotes = issue.matchingVotes + issue.opposingVotes;

      const score =
        decisiveVotes > 0 ? issue.matchingVotes / decisiveVotes : 0.5;

      const evidenceWeight = calculateEvidenceWeight(decisiveVotes);

      issueMatches.push({
        issueId: issue.issueId,
        stanceId: issue.stanceId,
        matchingVotes: issue.matchingVotes,
        opposingVotes: issue.opposingVotes,
        abstentions: issue.abstentions,
        totalRelevantBills: issue.totalRelevantBills,
        score,
        evidenceWeight,
      });

      if (decisiveVotes > 0) {
        weightedScoreSum += score * evidenceWeight;
        totalIssueWeight += evidenceWeight;
      }
    }

    if (totalIssueWeight === 0) {
      continue;
    }

    const rawScore = weightedScoreSum / totalIssueWeight;

    const evidenceCount = mk.matchingVotes + mk.opposingVotes;

    const overallEvidenceWeight = calculateEvidenceWeight(evidenceCount);

    const neutralScore = 0.5;

    const finalScore =
      neutralScore + (rawScore - neutralScore) * overallEvidenceWeight;

    const confidencePercent = calculateConfidencePercent(evidenceCount);

    results.push({
      mkId: mk.mkId,
      name: mk.name,
      faction: mk.faction,
      rawScore,
      finalScore,
      matchPercent: Math.round(finalScore * 100),
      confidencePercent,
      evidenceCount,
      matchingVotes: mk.matchingVotes,
      opposingVotes: mk.opposingVotes,
      abstentions: mk.abstentions,
      totalRelevantBills: mk.matchingVotes + mk.opposingVotes + mk.abstentions,
      issueMatches,
    });
  }

  return results.sort((a, b) => {
    if (b.finalScore !== a.finalScore) {
      return b.finalScore - a.finalScore;
    }

    if (b.evidenceCount !== a.evidenceCount) {
      return b.evidenceCount - a.evidenceCount;
    }

    return b.rawScore - a.rawScore;
  });
}
