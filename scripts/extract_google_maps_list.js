const fs = require('fs');
const { chromium } = require('playwright');

(async () => {
  const url = process.argv[2];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'en-US' });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(8000);

  const consent = page.getByRole('button', { name: /accept all|agree/i });
  if (await consent.count()) {
    await consent.first().click().catch(() => {});
    await page.waitForTimeout(4000);
  }

  const feed = page.locator('[role="feed"]');
  if (await feed.count()) {
    for (let i = 0; i < 30; i++) {
      await feed.evaluate(node => node.scrollTo(0, node.scrollHeight));
      await page.waitForTimeout(900);
    }
  }

  const places = await page.locator('a[href*="/maps/place/"]').evaluateAll(nodes => {
    const seen = new Set();
    return nodes.map(node => {
      const href = node.href || '';
      const name = (node.getAttribute('aria-label') || node.textContent || '').trim();
      return { name, href };
    }).filter(item => item.href && !seen.has(item.href) && seen.add(item.href));
  });

  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync('tmp/tokyo-coffee-list.json', JSON.stringify({ source: url, count: places.length, places }, null, 2));
  console.log(`Extracted ${places.length} places`);
  await browser.close();
})();
