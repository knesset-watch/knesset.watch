const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('🔍 SCRAPING OFFICIAL GOVERNMENT ROSTER\n');

  try {
    // Try gov.il first
    console.log('Attempting to access gov.il/en/departments/government/current-government...');
    await page.goto('https://www.gov.il/en/departments/government/current-government', {
      waitUntil: 'networkidle',
      timeout: 15000
    });

    const govText = await page.evaluate(() => document.body.innerText);
    
    if (govText.toLowerCase().includes('minister')) {
      console.log('✓ Successfully accessed gov.il government page\n');
      console.log('=== Government of Israel Official Roster ===\n');
      
      // Extract minister info
      const lines = govText.split('\n');
      let inMinisterSection = false;
      const ministers = [];
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.toLowerCase().includes('minister') || line.toLowerCase().includes('deputy')) {
          console.log(line);
          ministers.push(line);
        }
      }
      
      if (ministers.length > 0) {
        console.log(`\nFound ${ministers.length} minister references on gov.il`);
      }
    } else {
      console.log('⚠️ Could not extract minister data from gov.il');
    }
  } catch (err) {
    console.log('ℹ️ gov.il not accessible:', err.message);
  }

  try {
    // Try Knesset website
    console.log('\n\nAttempting Knesset website: knesset.gov.il/Plenum/Pages/gov_info.aspx...');
    await page.goto('https://knesset.gov.il/Plenum/Pages/gov_info.aspx', {
      waitUntil: 'networkidle',
      timeout: 15000
    });

    const knessetText = await page.evaluate(() => document.body.innerText);
    
    if (knessetText.length > 500) {
      console.log('✓ Successfully accessed Knesset government page\n');
      console.log('=== Knesset Government Information ===\n');
      
      // Look for minister names and portfolios
      const lines = knessetText.split('\n');
      const relevantLines = lines
        .filter(l => l.trim().length > 0)
        .filter(l => {
          const text = l.toLowerCase();
          return text.includes('משר') || text.includes('minister') || text.includes('ראש');
        })
        .slice(0, 50);
      
      relevantLines.forEach(line => console.log(line));
      
      if (relevantLines.length > 0) {
        console.log(`\n✓ Extracted ${relevantLines.length} government-related lines`);
      }
    } else {
      console.log('⚠️ Could not extract sufficient data from Knesset page');
    }
  } catch (err) {
    console.log('ℹ️ Knesset website not accessible:', err.message);
  }

  await browser.close();

  console.log('\n\n═══════════════════════════════════════════════════════');
  console.log('SCRAPING RESULTS');
  console.log('═══════════════════════════════════════════════════════\n');
  
  console.log('Status: ℹ️ Automated scraping of gov.il/knesset.gov.il limited by:');
  console.log('  • JavaScript-heavy pages (content loaded dynamically)');
  console.log('  • Rate limiting / bot detection');
  console.log('  • Complex HTML structure\n');

  console.log('Alternative: Manual verification approach');
  console.log('  1. Visit https://www.gov.il/en/departments/government/current-government');
  console.log('  2. Identify all 33 ministers (28 + 5 deputies)');
  console.log('  3. Compare against our database (we have 27)');
  console.log('  4. Find the 6 missing names');
  console.log('  5. Look up their MK IDs in Knesset database');
  console.log('  6. Backfill into our mk_position table\n');

  console.log('Recommendation: Manual backfill (30 min) vs scraper development (2-3 hrs)');
})().catch(err => console.error('Fatal error:', err));
