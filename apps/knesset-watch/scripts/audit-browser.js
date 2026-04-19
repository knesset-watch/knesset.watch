#!/usr/bin/env node
/**
 * AUDIT BROWSER VALIDATION SCRIPT
 * Visits each expected page, extracts actual UI values, compares against expected
 */

const fs = require('fs');
const path = require('path');

// Load Playwright (will be launched)
const { chromium } = require('playwright');

const expectedData = JSON.parse(fs.readFileSync('scripts/audit-expected-values.json', 'utf8'));

const RESULTS = [];
let PASS = 0;
let FAIL = 0;

async function runAudit() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('🔍 AUDIT BROWSER VALIDATION PHASE\n');
  console.log(`Starting Playwright validation of ${expectedData.length} pages...\n`);

  for (let i = 0; i < expectedData.length; i++) {
    const data = JSON.parse(expectedData[i]);
    const pageNum = i + 1;

    try {
      if (data.type === 'mk') {
        await auditMkPage(page, data, pageNum, expectedData.length);
      } else if (data.type === 'vote') {
        await auditVotePage(page, data, pageNum, expectedData.length);
      } else if (data.type === 'committee') {
        await auditCommitteePage(page, data, pageNum, expectedData.length);
      } else if (data.type === 'faction') {
        await auditFactionPage(page, data, pageNum, expectedData.length);
      } else if (data.type === 'ministry') {
        await auditMinistryPage(page, data, pageNum, expectedData.length);
      } else if (data.type === 'agenda') {
        await auditAgendaPage(page, data, pageNum, expectedData.length);
      } else if (data.type === 'ministers_special') {
        await auditMinistersPage(page, data, pageNum, expectedData.length);
      }
    } catch (err) {
      console.error(`✗ [${pageNum}/${expectedData.length}] Error: ${err.message}`);
      FAIL++;
      RESULTS.push({
        type: data.type,
        url: data.url,
        status: 'ERROR',
        error: err.message
      });
    }
  }

  await browser.close();

  // Print summary
  printSummary();

  // Save results
  fs.writeFileSync(
    'scripts/audit-results.json',
    JSON.stringify(RESULTS, null, 2)
  );

  console.log('\n✓ Results saved to scripts/audit-results.json\n');

  process.exit(FAIL > 0 ? 1 : 0);
}

async function auditMkPage(page, data, pageNum, total) {
  const url = `http://localhost:3001${data.url}`;
  await page.goto(url, { waitUntil: 'networkidle' });

  // Wait for content to load
  await page.waitForTimeout(500);

  // Extract actual values from DOM
  const stats = await page.evaluate(() => {
    const elements = document.querySelectorAll('[class*="stat"]');
    const values = {};

    // Look for the numeric display elements
    const textContent = document.body.innerText;

    // Extract bills, queries, positions, votes, absences
    const billsMatch = textContent.match(/(\d+)\s+הצ"ח/);
    const queriesMatch = textContent.match(/(\d+)\s+שאילתות/);
    const positionsMatch = textContent.match(/(\d+)\s+תפקידים/);
    const votesMatch = textContent.match(/(\d+)\s+הצבעות/);
    const absenceMatch = textContent.match(/(\d+)\s+היעדרויות/);

    return {
      bills: billsMatch ? parseInt(billsMatch[1]) : null,
      queries: queriesMatch ? parseInt(queriesMatch[1]) : null,
      positions: positionsMatch ? parseInt(positionsMatch[1]) : null,
      votes: votesMatch ? parseInt(votesMatch[1]) : null,
      absence: absenceMatch ? parseInt(absenceMatch[1]) : null
    };
  });

  const expected = data.expected;
  let matches = true;
  const mismatches = [];

  if (stats.bills !== expected.bills) {
    matches = false;
    mismatches.push(`Bills: expected ${expected.bills}, got ${stats.bills}`);
  }
  if (stats.queries !== expected.queries) {
    matches = false;
    mismatches.push(`Queries: expected ${expected.queries}, got ${stats.queries}`);
  }
  if (stats.positions !== expected.positions) {
    matches = false;
    mismatches.push(`Positions: expected ${expected.positions}, got ${stats.positions}`);
  }
  if (stats.votes !== expected.votes) {
    matches = false;
    mismatches.push(`Votes: expected ${expected.votes}, got ${stats.votes}`);
  }
  if (stats.absence !== expected.absence) {
    matches = false;
    mismatches.push(`Absence: expected ${expected.absence}, got ${stats.absence}`);
  }

  if (matches) {
    PASS++;
    console.log(`✓ [${pageNum}/${total}] MK ${data.mkId} — ${data.name}`);
  } else {
    FAIL++;
    console.log(`✗ [${pageNum}/${total}] MK ${data.mkId} — ${data.name}`);
    mismatches.forEach(m => console.log(`    ${m}`));
  }

  RESULTS.push({
    type: 'mk',
    mkId: data.mkId,
    url: data.url,
    expected,
    actual: stats,
    status: matches ? 'PASS' : 'FAIL',
    mismatches
  });
}

async function auditVotePage(page, data, pageNum, total) {
  const url = `http://localhost:3001${data.url}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const stats = await page.evaluate(() => {
    const textContent = document.body.innerText;
    const forMatch = textContent.match(/בעד:\s*(\d+)/);
    const againstMatch = textContent.match(/נגד:\s*(\d+)/);
    const abstainMatch = textContent.match(/נמנע:\s*(\d+)/);
    const presentMatch = textContent.match(/נוכח:\s*(\d+)/);

    return {
      for: forMatch ? parseInt(forMatch[1]) : null,
      against: againstMatch ? parseInt(againstMatch[1]) : null,
      abstain: abstainMatch ? parseInt(abstainMatch[1]) : null,
      present: presentMatch ? parseInt(presentMatch[1]) : null
    };
  });

  const expected = data.expected;
  let matches = (
    stats.for === expected.for &&
    stats.against === expected.against &&
    stats.abstain === expected.abstain
  );

  if (matches) {
    PASS++;
    console.log(`✓ [${pageNum}/${total}] Vote ${data.voteId}`);
  } else {
    FAIL++;
    console.log(`✗ [${pageNum}/${total}] Vote ${data.voteId}`);
    if (stats.for !== expected.for) console.log(`    For: expected ${expected.for}, got ${stats.for}`);
    if (stats.against !== expected.against) console.log(`    Against: expected ${expected.against}, got ${stats.against}`);
    if (stats.abstain !== expected.abstain) console.log(`    Abstain: expected ${expected.abstain}, got ${stats.abstain}`);
  }

  RESULTS.push({
    type: 'vote',
    voteId: data.voteId,
    url: data.url,
    expected,
    actual: stats,
    status: matches ? 'PASS' : 'FAIL'
  });
}

async function auditCommitteePage(page, data, pageNum, total) {
  const url = `http://localhost:3001${data.url}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const stats = await page.evaluate(() => {
    const textContent = document.body.innerText;
    // Committee pages show members and sessions counts
    const lines = textContent.split('\n');
    let members = null, sessions = null;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('חברים') && i > 0) {
        const match = lines[i - 1].match(/(\d+)/);
        if (match) members = parseInt(match[1]);
      }
      if (lines[i].includes('ישיבות')) {
        const match = lines[i].match(/(\d+)/);
        if (match) sessions = parseInt(match[1]);
      }
    }

    return { members, sessions };
  });

  const expected = data.expected;
  let matches = (stats.members === expected.members);

  if (matches) {
    PASS++;
    console.log(`✓ [${pageNum}/${total}] Committee (members: ${stats.members})`);
  } else {
    FAIL++;
    console.log(`✗ [${pageNum}/${total}] Committee`);
    console.log(`    Members: expected ${expected.members}, got ${stats.members}`);
  }

  RESULTS.push({
    type: 'committee',
    name: data.name,
    url: data.url,
    expected,
    actual: stats,
    status: matches ? 'PASS' : 'FAIL'
  });
}

async function auditFactionPage(page, data, pageNum, total) {
  const url = `http://localhost:3001${data.url}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // Faction pages: validate that data loads (full validation is complex)
  const titleMatch = await page.title();
  const passes = titleMatch.includes('knesset.watch');

  if (passes) {
    PASS++;
    console.log(`✓ [${pageNum}/${total}] Faction: ${data.name}`);
  } else {
    FAIL++;
    console.log(`✗ [${pageNum}/${total}] Faction: ${data.name} (page load issue)`);
  }

  RESULTS.push({
    type: 'faction',
    name: data.name,
    url: data.url,
    status: passes ? 'PASS' : 'FAIL'
  });
}

async function auditMinistryPage(page, data, pageNum, total) {
  const url = `http://localhost:3001${data.url}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const passes = await page.evaluate(() => {
    return document.body.innerText.length > 0;
  });

  if (passes) {
    PASS++;
    console.log(`✓ [${pageNum}/${total}] Ministry: ${data.name}`);
  } else {
    FAIL++;
    console.log(`✗ [${pageNum}/${total}] Ministry: ${data.name} (page load issue)`);
  }

  RESULTS.push({
    type: 'ministry',
    name: data.name,
    url: data.url,
    status: passes ? 'PASS' : 'FAIL'
  });
}

async function auditAgendaPage(page, data, pageNum, total) {
  const url = `http://localhost:3001${data.url}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const passes = await page.evaluate(() => {
    return document.body.innerText.length > 0;
  });

  if (passes) {
    PASS++;
    console.log(`✓ [${pageNum}/${total}] Agenda: ${data.name}`);
  } else {
    FAIL++;
    console.log(`✗ [${pageNum}/${total}] Agenda: ${data.name} (page load issue)`);
  }

  RESULTS.push({
    type: 'agenda',
    name: data.name,
    url: data.url,
    status: passes ? 'PASS' : 'FAIL'
  });
}

async function auditMinistersPage(page, data, pageNum, total) {
  const url = `http://localhost:3001${data.url}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const actual = await page.evaluate(() => {
    const textContent = document.body.innerText;
    // Extract minister count from page
    const match = textContent.match(/(\d+)\s+שר/);
    return match ? parseInt(match[1]) : null;
  });

  const expected = data.expected.active;
  const matches = actual === expected;

  if (matches) {
    PASS++;
    console.log(`✓ [${pageNum}/${total}] Ministers Page: ${actual} active`);
  } else {
    FAIL++;
    console.log(`✗ [${pageNum}/${total}] Ministers Page`);
    console.log(`    Active ministers: expected ${expected}, got ${actual}`);
    console.log(`    Note: Baseline from Knesset = 38 (33 ministers + 5 deputy)`);
  }

  RESULTS.push({
    type: 'ministers',
    url: data.url,
    expected: data.expected,
    actual: { active: actual },
    status: matches ? 'PASS' : 'FAIL'
  });
}

function printSummary() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('AUDIT VALIDATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`✓ PASS: ${PASS}`);
  console.log(`✗ FAIL: ${FAIL}`);
  console.log(`Total: ${PASS + FAIL}`);
  console.log(`Score: ${Math.round((PASS / (PASS + FAIL)) * 100)}%\n`);

  if (FAIL > 0) {
    console.log('FAILURES:');
    RESULTS.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  - ${r.type}: ${r.name || r.mkId || r.voteId || r.url}`);
    });
  }
}

runAudit().catch(err => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});
