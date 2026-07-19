const fs = require('fs');
const { chromium } = require('playwright');

const source = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 1200 } });

  async function openList() {
    await page.goto(source, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(9000);
    for (const label of [/accept all/i, /agree/i, /reject all/i]) {
      const button = page.getByRole('button', { name: label });
      if (await button.count()) {
        await button.first().click().catch(() => {});
        await page.waitForTimeout(4000);
        break;
      }
    }
    for (let n = 0; n < 35; n++) {
      await page.evaluate(() => {
        [...document.querySelectorAll('*')].filter(el => el.scrollHeight > el.clientHeight + 80).forEach(el => el.scrollTo(0, el.scrollHeight));
      });
      await page.waitForTimeout(400);
    }
  }

  await openList();
  const text = await page.locator('body').innerText();
  const lines = text.split('\n').map(x => x.trim()).filter(Boolean);
  const places = [];
  for (let i = 1; i < lines.length; i++) {
    if (/^[1-5]\.\d$/.test(lines[i])) {
      const name = lines[i - 1];
      const category = lines[i + 1] || '';
      if (name && !places.some(p => p.name === name)) places.push({ name, rating: lines[i], category });
    }
  }

  for (const place of places) {
    await openList();
    const item = page.getByText(place.name, { exact: true }).first();
    if (!await item.count()) continue;
    await item.click().catch(() => {});
    await page.waitForTimeout(3500);
    place.google_maps = page.url();
    const match = page.url().match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (match) {
      place.latitude = Number(match[1]);
      place.longitude = Number(match[2]);
    }
    place.address = await page.locator('[data-item-id="address"]').first().innerText().catch(() => '');
    if (!place.address) {
      place.address = await page.locator('button[aria-label^="Address:"]').first().getAttribute('aria-label').catch(() => '');
      place.address = place.address.replace(/^Address:\s*/, '');
    }
    const detailText = await page.locator('body').innerText().catch(() => '');
    place.permanently_closed = /permanently closed/i.test(detailText);
  }

  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync('tmp/tokyo-coffee-list.json', JSON.stringify({
    source,
    title: await page.title(),
    declaredCount: Number((text.match(/·\s*(\d+) places/) || [])[1] || 0),
    count: places.length,
    places
  }, null, 2));
  await browser.close();
})();
