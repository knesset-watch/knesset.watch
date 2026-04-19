const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:3001/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="password"]', 'knesset-watch');
  await page.click('button[type="submit"]');
  await page.waitForNavigation();
  
  await page.goto('http://localhost:3001/mk/30852', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  
  const text = await page.evaluate(() => document.body.innerText);
  
  console.log("\n=== LOOKING FOR הצבעות (votes) ===");
  const votesIdx = text.indexOf('הצבעות');
  if (votesIdx >= 0) {
    console.log(text.substring(votesIdx - 50, votesIdx + 100));
  }
  
  console.log("\n=== LOOKING FOR היעדרויות (absence) ===");
  const absenceIdx = text.indexOf('היעדרויות');
  if (absenceIdx >= 0) {
    console.log(text.substring(absenceIdx - 50, absenceIdx + 100));
  }
  
  await browser.close();
})();
