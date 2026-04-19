const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('http://localhost:3001/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="password"]', 'knesset-watch');
  await page.click('button[type="submit"]');
  await page.waitForNavigation();
  
  await page.goto('http://localhost:3001/vote/40337', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  
  const text = await page.evaluate(() => document.body.innerText);
  
  console.log("\n=== LOOKING FOR בעד (for) ===");
  const forIdx = text.indexOf('בעד');
  if (forIdx >= 0) {
    console.log(text.substring(forIdx - 20, forIdx + 100));
  }
  
  console.log("\n=== LOOKING FOR נגד (against) ===");
  const againstIdx = text.indexOf('נגד');
  if (againstIdx >= 0) {
    console.log(text.substring(againstIdx - 20, againstIdx + 100));
  }
  
  await browser.close();
})();
