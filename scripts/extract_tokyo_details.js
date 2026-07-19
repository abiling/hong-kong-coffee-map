const fs = require('fs');
const { chromium } = require('playwright');

(async () => {
  const source = process.argv[2];
  const data = JSON.parse(fs.readFileSync('tmp/tokyo-coffee-list.json', 'utf8'));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });
  await page.goto(source, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(10000);

  for (let i = 0; i < 50; i++) {
    await page.mouse.move(360, 760);
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(200);
  }

  for (const place of data.places) {
    const card = page.locator('button').filter({ hasText: place.name }).first();
    if (!await card.count()) continue;
    await card.scrollIntoViewIfNeeded().catch(() => {});
    await card.click().catch(() => {});
    await page.waitForTimeout(1800);
    place.google_maps = page.url();
    const match = page.url().match(/@(-?[0-9.]+),(-?[0-9.]+)/);
    if (match) {
      place.latitude = Number(match[1]);
      place.longitude = Number(match[2]);
    }
    const back = page.getByRole('button', { name: 'Back' }).first();
    if (await back.count()) await back.click().catch(() => {});
    await page.waitForTimeout(600);
  }

  fs.writeFileSync('tmp/tokyo-coffee-list.json', JSON.stringify(data, null, 2));
  await browser.close();
})();
