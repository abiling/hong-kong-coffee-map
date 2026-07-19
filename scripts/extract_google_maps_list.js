const fs = require('fs');
const { chromium } = require('playwright');

(async () => {
  const source = process.argv[2];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 1200 } });
  await page.goto(source, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(12000);

  for (const label of [/accept all/i, /agree/i, /reject all/i]) {
    const button = page.getByRole('button', { name: label });
    if (await button.count()) {
      await button.first().click().catch(() => {});
      await page.waitForTimeout(5000);
      break;
    }
  }

  const scrollTargets = page.locator('[role="feed"], [role="main"]');
  for (let i = 0; i < await scrollTargets.count(); i++) {
    const target = scrollTargets.nth(i);
    for (let n = 0; n < 25; n++) {
      await target.evaluate(node => node.scrollTo(0, node.scrollHeight)).catch(() => {});
      await page.waitForTimeout(500);
    }
  }

  const links = await page.locator('a').evaluateAll(nodes => nodes.map(node => ({
    href: node.href || '',
    label: (node.getAttribute('aria-label') || '').trim(),
    text: (node.textContent || '').trim().replace(/\s+/g, ' ')
  })).filter(item => item.href));

  const bodyText = (await page.locator('body').innerText()).slice(0, 30000);
  const places = links.filter(item => item.href.includes('/maps/place/') || item.href.includes('google.com/maps?cid='));
  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync('tmp/tokyo-coffee-list.json', JSON.stringify({
    source,
    finalUrl: page.url(),
    title: await page.title(),
    bodyText,
    linkCount: links.length,
    links: links.slice(0, 300),
    count: places.length,
    places
  }, null, 2));
  await browser.close();
})();
