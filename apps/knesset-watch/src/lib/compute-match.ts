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
  /** חוקים שיזם ומקדמים את עמדת המשתמש */
  matchingInitiations: number;
  /** חוקים שיזם ומקדמים את העמדה הנגדית */
  opposingInitiations: number;
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
  matchingInitiations: number;
  opposingInitiations: number;
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

type InitiationRow = {
  bill_id: number;
  issue_id: string;
  law_stance_id: string;
  mk_id: number;
  mk_name: string;
  faction_name: string | null;
};

/**
 * משקל היוזמה מול ההצבעה.
 *
 * זהה למדד AgendaActivity, ומאותה סיבה: משמעת סיעתית של 99.8% הופכת
 * הצבעה לאות חלש — היא מספרת מי בקואליציה, לא מי מקדם מה. יוזמה היא
 * בחירה אישית של חבר הכנסת.
 *
 * הפער בכיסוי מחדד את זה: 13,043 שורות יוזמה על 4,589 חוקים מסווגים,
 * מול 409 חוקים בלבד שהגיעו להצבעת מליאה. בלי היוזמה 66 מתוך 201
 * הצירים היו מחזירים רשימה ריקה.
 */
const INITIATION_WEIGHT = 0.6;
const VOTE_WEIGHT = 0.4;

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

/**
 * מי יזם חוק שסווג לאחת מהשאלות שהמשתמש ענה עליהן.
 *
 * בניגוד להצבעות, כאן אין dedup לפי הצבעה אחרונה — יוזמה היא אירוע
 * יחיד. הדדופ היחיד הנדרש הוא על (bill_id, mk_id), כי חבר כנסת יכול
 * להופיע פעמיים באותה הצעה דרך רשומות כפולות ב-bill_initiator.
 */
function getInitiationRows(issueIds: string[]): InitiationRow[] {
  if (issueIds.length === 0) {
    return [];
  }

  const db = getDatabase();

  try {
    const placeholders = issueIds.map(() => "?").join(", ");

    return db
      .prepare(
        `
        WITH unique_mks AS (
          SELECT
            person_id,
            MAX(first_name) AS first_name,
            MAX(last_name) AS last_name,
            MAX(faction_name) AS faction_name
          FROM mk_person
          GROUP BY person_id
        )

        SELECT DISTINCT
          c.bill_id,
          c.issue_id,
          c.stance_id AS law_stance_id,
          bi.mk_id,

          TRIM(
            COALESCE(mp.first_name, '') || ' ' ||
            COALESCE(mp.last_name, '')
          ) AS mk_name,

          mp.faction_name

        FROM bill_political_classification c

        INNER JOIN bill_initiator bi
          ON bi.bill_id = c.bill_id

        LEFT JOIN unique_mks mp
          ON mp.person_id = bi.mk_id

        WHERE
          c.issue_id IN (${placeholders})
          AND c.stance_id IS NOT NULL
        `,
      )
      .all(...issueIds) as InitiationRow[];
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

/**
 * אחוז הביטחון — אמירה על גודל המדגם, לא על נכונות ההתאמה.
 *
 * היעד ירד מ-30 ל-15 אחרי שהטקסונומיה גדלה מ-12 סוגיות רחבות ל-201
 * צירים צרים. שאלה צרה מייצרת פחות ראיות לכל ח"כ, ולכן היעד הישן היה
 * מציג 50% על 21 אירועים מתועדים — קריאה מטעה של "לא בטוח" על התאמה
 * שנשענת על ראיות מוצקות.
 */
function calculateConfidencePercent(evidenceCount: number): number {
  const targetEvidence = 15;

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
  const initiationRows = getInitiationRows(issueIds);

  const mkMap = new Map<
    number,
    {
      mkId: number;
      name: string;
      faction: string | null;
      matchingVotes: number;
      opposingVotes: number;
      abstentions: number;
      matchingInitiations: number;
      opposingInitiations: number;
      issueMap: Map<
        string,
        {
          issueId: string;
          stanceId: string;
          matchingVotes: number;
          opposingVotes: number;
          abstentions: number;
          matchingInitiations: number;
          opposingInitiations: number;
          totalRelevantBills: number;
        }
      >;
    }
  >();

  type MkAcc = NonNullable<ReturnType<typeof mkMap.get>>;

  const ensureMk = (
    mkId: number,
    name: string,
    faction: string | null,
  ): MkAcc => {
    let mk = mkMap.get(mkId);

    if (!mk) {
      mk = {
        mkId,
        name,
        faction,
        matchingVotes: 0,
        opposingVotes: 0,
        abstentions: 0,
        matchingInitiations: 0,
        opposingInitiations: 0,
        issueMap: new Map(),
      };

      mkMap.set(mkId, mk);
    }

    return mk;
  };

  const ensureIssue = (mk: MkAcc, issueId: string, stanceId: string) => {
    let issue = mk.issueMap.get(issueId);

    if (!issue) {
      issue = {
        issueId,
        stanceId,
        matchingVotes: 0,
        opposingVotes: 0,
        abstentions: 0,
        matchingInitiations: 0,
        opposingInitiations: 0,
        totalRelevantBills: 0,
      };

      mk.issueMap.set(issueId, issue);
    }

    return issue;
  };

  /**
   * יוזמה נספרת ראשונה, כדי שח"כ שיזם חוק רלוונטי יופיע בתוצאות גם אם
   * החוק מעולם לא הגיע להצבעה. זה המצב אצל 4,251 מתוך 4,660 החוקים.
   */
  for (const row of initiationRows) {
    const userStance = answersByIssue.get(row.issue_id);

    if (!userStance) {
      continue;
    }

    const mk = ensureMk(row.mk_id, row.mk_name, row.faction_name);
    const issue = ensureIssue(mk, row.issue_id, userStance);

    if (row.law_stance_id === userStance) {
      mk.matchingInitiations += 1;
      issue.matchingInitiations += 1;
    } else {
      mk.opposingInitiations += 1;
      issue.opposingInitiations += 1;
    }
  }

  for (const row of rows) {
    const userStance = answersByIssue.get(row.issue_id);

    if (!userStance) {
      continue;
    }

    const mk = ensureMk(row.mk_id, row.mk_name, row.faction_name);
    const issue = ensureIssue(mk, row.issue_id, userStance);

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
      const decisiveInitiations =
        issue.matchingInitiations + issue.opposingInitiations;

      const voteScore =
        decisiveVotes > 0 ? issue.matchingVotes / decisiveVotes : null;
      const initiationScore =
        decisiveInitiations > 0
          ? issue.matchingInitiations / decisiveInitiations
          : null;

      /**
       * כשרק אחד משני האותות קיים הוא מקבל את מלוא המשקל. חלוקה קשיחה
       * ב-0.6/0.4 הייתה מושכת ח"כ שיזם שלושה חוקים תואמים ולא הצביע
       * מעולם אל עבר 0.6 במקום 1.0, ומענישה אותו על היעדר הצבעה
       * שכלל לא התקיימה.
       */
      let score: number;

      if (initiationScore !== null && voteScore !== null) {
        score =
          initiationScore * INITIATION_WEIGHT + voteScore * VOTE_WEIGHT;
      } else if (initiationScore !== null) {
        score = initiationScore;
      } else if (voteScore !== null) {
        score = voteScore;
      } else {
        score = 0.5;
      }

      /** יוזמה שקולה להצבעה כראיה — שתיהן אירוע מתועד אחד */
      const evidence = decisiveVotes + decisiveInitiations;
      const evidenceWeight = calculateEvidenceWeight(evidence);

      issueMatches.push({
        issueId: issue.issueId,
        stanceId: issue.stanceId,
        matchingVotes: issue.matchingVotes,
        opposingVotes: issue.opposingVotes,
        abstentions: issue.abstentions,
        matchingInitiations: issue.matchingInitiations,
        opposingInitiations: issue.opposingInitiations,
        totalRelevantBills: issue.totalRelevantBills,
        score,
        evidenceWeight,
      });

      if (evidence > 0) {
        weightedScoreSum += score * evidenceWeight;
        totalIssueWeight += evidenceWeight;
      }
    }

    if (totalIssueWeight === 0) {
      continue;
    }

    const rawScore = weightedScoreSum / totalIssueWeight;

    const evidenceCount =
      mk.matchingVotes +
      mk.opposingVotes +
      mk.matchingInitiations +
      mk.opposingInitiations;

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
      matchingInitiations: mk.matchingInitiations,
      opposingInitiations: mk.opposingInitiations,
      totalRelevantBills:
        mk.matchingVotes +
        mk.opposingVotes +
        mk.abstentions +
        mk.matchingInitiations +
        mk.opposingInitiations,
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
