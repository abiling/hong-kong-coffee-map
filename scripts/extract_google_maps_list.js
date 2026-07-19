const fs = require('fs');
const { chromium } = require('playwright');

(async () => {
  const source = process.argv[2];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 1200 } });
  await page.goto('https://demo.takeout-tools.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(5000);

  const input = page.getByPlaceholder(/Google Maps shared list link/i).first();
  await input.fill(source);
  await page.getByRole('button', { name: /Generate/i }).first().click();
  await page.waitForTimeout(30000);

  const rows = await page.locator('table tbody tr').evaluateAll(nodes => nodes.map(row =>
    [...row.querySelectorAll('td')].map(cell => cell.innerText.trim())
  ));
  const links = await page.locator('table tbody tr').evaluateAll(nodes => nodes.map(row =>
    [...row.querySelectorAll('a')].map(a => a.href)
  ));
  const headers = await page.locator('table thead th').allInnerTexts();
  const bodyText = (await page.locator('body').innerText()).slice(0, 30000);

  const places = rows.map((cells, index) => ({ cells, links: links[index] || [] }));
  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync('tmp/tokyo-coffee-list.json', JSON.stringify({
    source,
    title: await page.title(),
    headers,
    count: places.length,
    places,
    bodyText
  }, null, 2));
  await browser.close();
})();
