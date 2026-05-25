#!/usr/bin/env node
/**
 * Seed canonical office mappings
 *
 * Usage:
 *   npm run db:seed-offices               # Generate draft
 *   npm run db:seed-offices:apply         # Apply draft
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'knesset.db');
const DRAFT_FILE = path.join(process.cwd(), 'canonical-offices-draft.json');

interface CanonicalOfficeMapping {
  slug: string;
  display_name: string;
  short_name?: string;
  is_active: boolean;
  notes?: string;
  gov_ministry_ids: number[];
}

async function generateDraft() {
  const db = new Database(DB_PATH);

  // Get all distinct (ministry_id, ministry_name) pairs from mk_position
  const ministryPairs = db.prepare(`
    SELECT DISTINCT ministry_id, ministry
    FROM mk_position
    WHERE ministry_id IS NOT NULL AND ministry IS NOT NULL
    ORDER BY ministry ASC
  `).all() as Array<{ ministry_id: number; ministry: string }>;

  console.log(`\n📋 Found ${ministryPairs.length} distinct ministries\n`);

  // Group by Hebrew name similarity (exact match for now)
  const groupedByName = new Map<string, number[]>();
  for (const pair of ministryPairs) {
    const key = pair.ministry;
    if (!groupedByName.has(key)) {
      groupedByName.set(key, []);
    }
    groupedByName.get(key)!.push(pair.ministry_id);
  }

  // Generate canonical office mappings
  const mappings: CanonicalOfficeMapping[] = [];
  let i = 0;
  for (const [ministry, govMinistryIds] of groupedByName) {
    const slug = `ministry-${++i}`.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    mappings.push({
      slug,
      display_name: ministry,
      short_name: undefined,
      is_active: true,
      notes: `${govMinistryIds.length} government ministry ID(s): ${govMinistryIds.join(', ')}`,
      gov_ministry_ids: govMinistryIds.sort((a, b) => a - b),
    });
  }

  // Save draft
  fs.writeFileSync(DRAFT_FILE, JSON.stringify(mappings, null, 2));
  console.log(`✅ Draft saved to canonical-offices-draft.json\n`);
  console.log(`📄 Review the file and edit as needed, then run:\n`);
  console.log(`   npm run db:seed-offices:apply\n`);

  db.close();
}

async function applyDraft() {
  if (!fs.existsSync(DRAFT_FILE)) {
    console.error(`\n❌ Draft file not found: ${DRAFT_FILE}`);
    console.error(`\n   First run: npm run db:seed-offices\n`);
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  const mappings: CanonicalOfficeMapping[] = JSON.parse(fs.readFileSync(DRAFT_FILE, 'utf-8'));

  console.log(`\n📝 Applying ${mappings.length} canonical offices...\n`);

  const insertOffice = db.prepare(`
    INSERT OR REPLACE INTO canonical_office (slug, display_name, short_name, is_active, notes)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertMapping = db.prepare(`
    INSERT OR REPLACE INTO canonical_office_ministry (canonical_office_id, gov_ministry_id)
    VALUES (?, ?)
  `);

  let inserted = 0;
  let mapped = 0;

  db.transaction(() => {
    for (const office of mappings) {
      const result = insertOffice.run(office.slug, office.display_name, office.short_name ?? null, office.is_active ? 1 : 0, office.notes ?? null);
      const officeId = result.lastInsertRowid;

      for (const govMinistryId of office.gov_ministry_ids) {
        insertMapping.run(officeId, govMinistryId);
        mapped++;
      }
      inserted++;
    }
  })();

  console.log(`✅ Inserted ${inserted} canonical offices`);
  console.log(`✅ Created ${mapped} office-ministry mappings\n`);

  // Verify coverage
  const unmappedCount = (
    db.prepare(`
      SELECT COUNT(DISTINCT ministry_id) as cnt
      FROM mk_position
      WHERE ministry_id IS NOT NULL
        AND ministry_id NOT IN (SELECT gov_ministry_id FROM canonical_office_ministry)
    `).get() as { cnt: number }
  ).cnt;

  if (unmappedCount === 0) {
    console.log(`✅ All ministries are mapped to canonical offices\n`);
  } else {
    console.warn(`\n⚠️  ${unmappedCount} ministries are still unmapped!\n`);
  }

  db.close();
}

const mode = process.argv[2];
if (mode === '--apply') {
  applyDraft().catch(err => {
    console.error('Apply failed:', err.message);
    process.exit(1);
  });
} else {
  generateDraft().catch(err => {
    console.error('Generate failed:', err.message);
    process.exit(1);
  });
}
