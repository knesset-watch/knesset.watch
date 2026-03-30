/**
 * Adds vote outcome columns (total_for, total_against, total_abstain, is_passed)
 * to the plenary_vote table, computed from existing mk_vote_result data.
 * No API calls needed — everything is derived locally.
 *
 * Usage:
 *   cd apps/knesset-watch
 *   npx tsx scripts/seed-vote-outcomes.ts
 */

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

// result_code: 6=נוכח, 7=בעד, 8=נגד, 9=נמנע
// A vote passes when total_for > total_against
function seedVoteOutcomes() {
  const db = new Database(DB_PATH);

  console.log('Adding vote outcome columns …');

  for (const col of [
    'total_for INTEGER NOT NULL DEFAULT 0',
    'total_against INTEGER NOT NULL DEFAULT 0',
    'total_abstain INTEGER NOT NULL DEFAULT 0',
    'is_passed INTEGER NOT NULL DEFAULT 0',
  ]) {
    try { db.exec(`ALTER TABLE plenary_vote ADD COLUMN ${col}`); } catch { /* already exists */ }
  }

  console.log('Computing outcomes from mk_vote_result …');

  db.exec(`
    UPDATE plenary_vote
    SET
      total_for     = (SELECT COUNT(*) FROM mk_vote_result r WHERE r.vote_id = plenary_vote.id AND r.result_code = 7),
      total_against = (SELECT COUNT(*) FROM mk_vote_result r WHERE r.vote_id = plenary_vote.id AND r.result_code = 8),
      total_abstain = (SELECT COUNT(*) FROM mk_vote_result r WHERE r.vote_id = plenary_vote.id AND r.result_code = 9),
      is_passed     = CASE WHEN
        (SELECT COUNT(*) FROM mk_vote_result r WHERE r.vote_id = plenary_vote.id AND r.result_code = 7) >
        (SELECT COUNT(*) FROM mk_vote_result r WHERE r.vote_id = plenary_vote.id AND r.result_code = 8)
      THEN 1 ELSE 0 END;
  `);

  const stats = db
    .prepare(`SELECT COUNT(*) as total, SUM(is_passed) as passed FROM plenary_vote`)
    .get() as { total: number; passed: number };

  console.log(`Done. ${stats.total.toLocaleString()} votes — ${stats.passed.toLocaleString()} passed, ${(stats.total - stats.passed).toLocaleString()} did not pass.`);

  db.close();
}

seedVoteOutcomes();
