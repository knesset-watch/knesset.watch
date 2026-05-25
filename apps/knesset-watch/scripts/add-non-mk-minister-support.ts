#!/usr/bin/env node
/**
 * Add support for non-Knesset member ministers
 *
 * Some positions (like appointed officials, foreign advisors) may be ministers
 * but not Knesset members. This script adds a flag to track this.
 *
 * Schema change:
 * - Add `is_mk` boolean column to mk_person table
 * - Set is_mk=1 for all existing records (all are Knesset members)
 * - Future non-MK ministers can have is_mk=0
 *
 * Usage:
 *   npm run db:add-non-mk-support
 */

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');

export function addNonMkMinisterSupport() {
  const db = new Database(DB_PATH);

  try {
    console.log('🔧 Adding non-Knesset member minister support...\n');

    // Check if column already exists
    const columns = db.prepare(`PRAGMA table_info(mk_person)`).all();
    const hasIsMkColumn = columns.some((col: any) => col.name === 'is_mk');

    if (!hasIsMkColumn) {
      console.log('📋 Adding is_mk column to mk_person table...');
      db.exec(`
        ALTER TABLE mk_person ADD COLUMN is_mk INTEGER DEFAULT 1;
      `);
      console.log('  ✓ Column added\n');
    } else {
      console.log('ℹ️  is_mk column already exists\n');
    }

    // Ensure all existing people are marked as MK (they are)
    db.prepare(`
      UPDATE mk_person SET is_mk = 1 WHERE is_mk IS NULL
    `).run();

    // Verify schema
    console.log('=== SCHEMA VERIFICATION ===\n');
    const newColumns = db.prepare(`PRAGMA table_info(mk_person)`).all();
    console.log('mk_person columns:');
    newColumns.forEach((col: any) => {
      if (col.name === 'is_mk') {
        console.log(`  ✓ ${col.name}: ${col.type} (NEW)`);
      } else if (['person_id', 'first_name', 'last_name', 'faction_name'].includes(col.name)) {
        console.log(`  • ${col.name}: ${col.type}`);
      }
    });

    // Count MK vs non-MK
    const stats = db.prepare(`
      SELECT
        SUM(CASE WHEN is_mk = 1 THEN 1 ELSE 0 END) as mk_count,
        SUM(CASE WHEN is_mk = 0 THEN 1 ELSE 0 END) as non_mk_count,
        COUNT(*) as total
      FROM mk_person
    `).get() as { mk_count: number; non_mk_count: number; total: number };

    console.log('\n=== PERSON RECORDS ===\n');
    console.log(`Knesset members (is_mk=1):        ${stats.mk_count}`);
    console.log(`Non-MK ministers (is_mk=0):       ${stats.non_mk_count || 0}`);
    console.log(`Total person records:              ${stats.total}`);

    console.log('\n✅ Non-Knesset member minister support added\n');
    console.log('Usage: When creating a minister record for a non-MK, set is_mk=0\n');

  } catch (err) {
    console.error('❌ Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    db.close();
  }
}

addNonMkMinisterSupport();
