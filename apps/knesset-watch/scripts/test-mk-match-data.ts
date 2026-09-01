import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "knesset.db");

const db = new Database(DB_PATH, {
  readonly: true,
});

type BillMkPosition = {
  bill_id: number;
  bill_title: string;
  issue_id: string;
  issue_label: string;
  stance_id: string;
  stance_label: string;
  mk_id: number;
  mk_name: string;
  faction_name: string | null;
  vote_id: number;
  vote_date: string;
  result_code: number;
  position: string;
  bill_vote_count: number;
};

const positions = db
  .prepare(
    `
    WITH unique_bills AS (
      SELECT
        id,
        MAX(title) AS title
      FROM bill
      GROUP BY id
    ),

    unique_votes AS (
      SELECT
        id,
        bill_id,
        MAX(title) AS title,
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

    bill_mk_votes AS (
      SELECT
        c.bill_id,
        b.title AS bill_title,

        c.issue_id,
        c.issue_label,
        c.stance_id,
        c.stance_label,

        pv.id AS vote_id,
        pv.date AS vote_date,

        r.mk_id,
        r.result_code,

        TRIM(
          COALESCE(mp.first_name, '') || ' ' ||
          COALESCE(mp.last_name, '')
        ) AS mk_name,

        mp.faction_name,

        COUNT(*) OVER (
          PARTITION BY c.bill_id, r.mk_id
        ) AS bill_vote_count,

        ROW_NUMBER() OVER (
          PARTITION BY c.bill_id, r.mk_id
          ORDER BY
            pv.date DESC,
            pv.id DESC
        ) AS rn

      FROM bill_political_classification c

      INNER JOIN unique_bills b
        ON b.id = c.bill_id

      INNER JOIN unique_votes pv
        ON pv.bill_id = c.bill_id

      INNER JOIN unique_results r
        ON r.vote_id = pv.id

      LEFT JOIN unique_mks mp
        ON mp.person_id = r.mk_id

      WHERE
        c.issue_id IS NOT NULL
        AND c.stance_id IS NOT NULL
    )

    SELECT
      bill_id,
      bill_title,

      issue_id,
      issue_label,
      stance_id,
      stance_label,

      mk_id,
      mk_name,
      faction_name,

      vote_id,
      vote_date,
      result_code,

      CASE result_code
        WHEN 7 THEN 'בעד'
        WHEN 8 THEN 'נגד'
        WHEN 9 THEN 'נמנע'
        ELSE 'אחר'
      END AS position,

      bill_vote_count

    FROM bill_mk_votes

    WHERE rn = 1

    ORDER BY
      vote_date DESC,
      bill_id,
      mk_name

    LIMIT 100
    `,
  )
  .all() as BillMkPosition[];

console.log("");
console.log("MK Position Per Bill");
console.log(`Rows returned: ${positions.length}`);
console.log("");

console.table(positions);

const summary = db
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

    bill_mk_votes AS (
      SELECT
        c.bill_id,

        c.issue_id,
        c.issue_label,
        c.stance_id,
        c.stance_label,

        pv.id AS vote_id,
        pv.date AS vote_date,

        r.mk_id,
        r.result_code,

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

      WHERE
        c.issue_id IS NOT NULL
        AND c.stance_id IS NOT NULL
    ),

    final_positions AS (
      SELECT
        bill_id,
        issue_id,
        issue_label,
        stance_id,
        stance_label,
        mk_id,
        result_code
      FROM bill_mk_votes
      WHERE rn = 1
    )

    SELECT
      issue_id,
      issue_label,
      stance_id,
      stance_label,

      COUNT(DISTINCT bill_id) AS bills,
      COUNT(DISTINCT mk_id) AS mks,
      COUNT(*) AS mk_bill_positions,

      SUM(
        CASE
          WHEN result_code = 7 THEN 1
          ELSE 0
        END
      ) AS positions_for,

      SUM(
        CASE
          WHEN result_code = 8 THEN 1
          ELSE 0
        END
      ) AS positions_against,

      SUM(
        CASE
          WHEN result_code = 9 THEN 1
          ELSE 0
        END
      ) AS positions_abstain

    FROM final_positions

    GROUP BY
      issue_id,
      issue_label,
      stance_id,
      stance_label

    ORDER BY bills DESC
    `,
  )
  .all();

console.log("");
console.log("Issue / Stance Summary By Bill Position");
console.log("");

console.table(summary);

const duplicates = db
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

    ranked AS (
      SELECT
        c.bill_id,
        r.mk_id,

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

      WHERE
        c.issue_id IS NOT NULL
        AND c.stance_id IS NOT NULL
    ),

    final_positions AS (
      SELECT
        bill_id,
        mk_id
      FROM ranked
      WHERE rn = 1
    )

    SELECT
      bill_id,
      mk_id,
      COUNT(*) AS row_count

    FROM final_positions

    GROUP BY
      bill_id,
      mk_id

    HAVING COUNT(*) > 1
    `,
  )
  .all();

console.log("");
console.log("Duplicate bill + MK positions");
console.log(`Duplicates found: ${duplicates.length}`);

if (duplicates.length > 0) {
  console.table(duplicates);
}

db.close();
