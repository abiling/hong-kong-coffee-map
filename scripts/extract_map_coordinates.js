const fs = require('fs');
const { chromium } = require('playwright');

(async () => {
  const path = 'tmp/tokyo-coffee-list.json';
  const data = JSON.parse(fs.readFileSync(path, 'utf8'));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'en-US' });

  for (const place of data.places) {
    if (place.latitude && place.longitude) continue;
    await page.goto(place.google_maps, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(3000);
    const html = await page.content();
    const pairs = [...html.matchAll(/(35\.[0-9]{5,}),\s*(139\.[0-9]{5,})/g)];
    const counts = new Map();
    for (const match of pairs) {
      const key = Number(match[1]).toFixed(7) + ',' + Number(match[2]).toFixed(7);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) {
      const [latitude, longitude] = best[0].split(',').map(Number);
      place.latitude = latitude;
      place.longitude = longitude;
      place.coordinate_hits = best[1];
    }
  }

  fs.writeFileSync(path, JSON.stringify(data, null, 2));
  await browser.close();
})();
