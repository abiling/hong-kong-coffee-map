const fs = require('fs');
const { chromium } = require('playwright');

(async () => {
  const data = JSON.parse(fs.readFileSync('tmp/tokyo-coffee-list.json', 'utf8'));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1400, height: 1000 } });

  for (const place of data.places) {
    const query = encodeURIComponent(place.name + ' Tokyo Japan');
    await page.goto('https://www.google.com/maps/search/?api=1&query=' + query, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(3500);
    place.google_maps = page.url();
    const match = page.url().match(/!3d(-?[0-9.]+)!4d(-?[0-9.]+)/) || page.url().match(/@(-?[0-9.]+),(-?[0-9.]+)/);
    if (match) {
      place.latitude = Number(match[1]);
      place.longitude = Number(match[2]);
    }
    const labels = await page.locator('button').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label') || ''));
    const address = labels.find(label => label.startsWith('Address:')) || '';
    place.address = address.replace('Address:', '').trim();
    place.permanently_closed = /permanently closed/i.test(await page.locator('body').innerText());
  }

  fs.writeFileSync('tmp/tokyo-coffee-list.json', JSON.stringify(data, null, 2));
  await browser.close();
})();
