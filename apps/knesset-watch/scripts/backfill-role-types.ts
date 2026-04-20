#!/usr/bin/env node
/**
 * Backfill role_type classification for all mk_position records
 *
 * Classifies all 2,120 existing records based on duty_desc and committee_id.
 * This is a one-shot operation that runs once after adding the role_type column.
 *
 * After running, inspect residual 'other' rows to identify unexpected patterns.
 *
 * Usage:
 *   npm run db:backfill-roles
 */

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

export function backfillRoleTypes() {
  const db = new Database(DB_PATH);

  try {
    console.log('🔄 Backfilling role_type classification...\n');

    // Apply the classification logic
    const result = db.prepare(`
      UPDATE mk_position SET role_type =
        CASE
          WHEN duty_desc LIKE 'ראש הממשלה%'        THEN 'pm'
          WHEN duty_desc LIKE 'סגן ראש הממשלה%'     THEN 'deputy-pm'
          WHEN duty_desc LIKE 'המשנה לראש הממשלה%'  THEN 'deputy-pm'
          WHEN duty_desc LIKE 'שר %'               THEN 'minister'
          WHEN duty_desc LIKE 'שרת %'              THEN 'minister'
          WHEN duty_desc LIKE 'השר %'              THEN 'minister'
          WHEN duty_desc LIKE 'השרה %'             THEN 'minister'
          WHEN duty_desc = 'שר'                    THEN 'minister'
          WHEN duty_desc = 'שרה'                   THEN 'minister'
          WHEN duty_desc LIKE 'שר ללא תיק%'        THEN 'minister'
          WHEN duty_desc LIKE 'שרת ללא תיק%'       THEN 'minister'
          WHEN duty_desc LIKE 'שרה בלי תיק%'       THEN 'minister'
          WHEN duty_desc LIKE 'שר בשירות חוקי%'    THEN 'acting'
          WHEN duty_desc LIKE 'ממלא מקום שר%'      THEN 'acting'
          WHEN duty_desc LIKE 'ממלא מקום השר%'     THEN 'acting'
          WHEN duty_desc LIKE 'סגן שר%'            THEN 'deputy'
          WHEN duty_desc LIKE 'סגנית שר%'          THEN 'deputy'
          WHEN committee_id IS NOT NULL            THEN 'committee'
          WHEN duty_desc IS NULL
           AND committee_id IS NULL
           AND ministry_id IS NULL                 THEN 'mk'
          ELSE 'other'
        END
      WHERE role_type IS NULL
    `).run();

    console.log(`✅ Backfilled ${result.changes} rows with role_type\n`);

    // Show distribution
    console.log('=== ROLE TYPE DISTRIBUTION ===\n');
    const distribution = db.prepare(`
      SELECT role_type, COUNT(*) as count
      FROM mk_position
      GROUP BY role_type
      ORDER BY count DESC
    `).all() as Array<{ role_type: string; count: number }>;

    distribution.forEach(row => {
      const pct = ((row.count / 2120) * 100).toFixed(1);
      console.log(`  ${row.role_type.padEnd(15)} ${String(row.count).padStart(4)}  (${pct}%)`);
    });

    // Identify anomalies
    console.log('\n=== ANOMALY CHECK ===\n');
    const anomalies = db.prepare(`
      SELECT role_type, COUNT(*) as count, ministry_id
      FROM mk_position
      WHERE role_type = 'other' AND ministry_id IS NOT NULL
      GROUP BY ministry_id
      LIMIT 10
    `).all() as Array<{ role_type: string; count: number; ministry_id: number }>;

    if (anomalies.length > 0) {
      console.log('⚠️  Found role_type="other" with ministry_id (unexpected patterns):');
      anomalies.forEach(row => {
        console.log(`  ministry_id=${row.ministry_id}, count=${row.count}`);
      });
      console.log('\nInspect these manually to understand unexpected duty descriptions.\n');
    } else {
      console.log('✓ No anomalies found (all "other" rows have ministry_id=NULL)\n');
    }

    // Sample some rows to verify
    console.log('=== SAMPLE CLASSIFICATIONS ===\n');
    const samples = db.prepare(`
      SELECT
        duty_desc,
        role_type,
        is_current,
        government_num
      FROM mk_position
      WHERE role_type IN ('pm', 'minister', 'deputy', 'committee', 'mk')
      ORDER BY RANDOM()
      LIMIT 5
    `).all() as Array<{ duty_desc: string; role_type: string; is_current: number; government_num: number }>;

    samples.forEach(row => {
      console.log(`  ${row.role_type.padEnd(12)} | ${row.duty_desc?.substring(0, 40) || '(null)'}`);
    });

    console.log('\n✅ Role type backfill complete\n');
  } catch (err) {
    console.error('❌ Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    db.close();
  }
}

backfillRoleTypes();
