const fs = require('fs');
const { chromium } = require('playwright');

(async () => {
  const source = process.argv[2];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });
  await page.goto(source, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(10000);

  for (const label of [/accept all/i, /agree/i, /reject all/i]) {
    const button = page.getByRole('button', { name: label });
    if (await button.count()) {
      await button.first().click().catch(() => {});
      await page.waitForTimeout(4000);
      break;
    }
  }

  for (let i = 0; i < 50; i++) {
    await page.mouse.move(360, 760);
    await page.mouse.wheel(0, 1200);
    await page.keyboard.press('End').catch(() => {});
    await page.waitForTimeout(300);
  }

  const bodyText = await page.locator('body').innerText();
  const controls = await page.locator('button, [role="button"]').evaluateAll(nodes => nodes.map(node => ({
    label: (node.getAttribute('aria-label') || '').trim(),
    text: (node.textContent || '').trim().replace(/\s+/g, ' '),
    role: node.getAttribute('role') || node.tagName
  })).filter(item => item.label || item.text));

  const lines = bodyText.split('\n').map(x => x.trim()).filter(Boolean);
  const places = [];
  for (let i = 1; i < lines.length; i++) {
    if (/^[1-5]\.\d$/.test(lines[i])) {
      const name = lines[i - 1];
      const category = lines[i + 1] || '';
      if (name && !places.some(p => p.name === name)) places.push({ name, rating: lines[i], category });
    }
  }

  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync('tmp/tokyo-coffee-list.json', JSON.stringify({
    source,
    title: await page.title(),
    declaredCount: Number((bodyText.match(/·\s*(\d+) places/) || [])[1] || 0),
    count: places.length,
    places,
    controls,
    bodyText
  }, null, 2));
  await browser.close();
})();
