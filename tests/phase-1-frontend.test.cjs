// Chromium DOM tests. All Apps Script reads and writes use local mock contracts.
// No HTTP server, production credentials, WebGL, or external assets are used.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { ALL_DATA_CACHE_KEY, hasCoordinates } = require('../location-catalog.js');

const root = join(__dirname, '..');
const source = file => readFileSync(join(root, file), 'utf8');
const chromium = process.env.CHROMIUM_BIN || 'chromium';
let playwright;
try { playwright = require('playwright'); } catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}
const browserAvailable = playwright && spawnSync(chromium, ['--version']).status === 0;

function installMock({ scenario, cacheKey }) {
  const google = name => 'https://www.google.com/maps/place/' + encodeURIComponent(name);
  const apple = coordinates => 'https://maps.apple.com/place?coordinate=' + coordinates;
  const fixture = (id, city, country, country_code, region, latitude, longitude, url) => ({
    id, city, country, country_code, region, latitude, longitude,
    district: region + ' district', address: city + ' address', name: city + ' Coffee',
    google_maps: url.includes('google.com') ? url : '',
    apple_maps: url.includes('apple.com') ? url : '',
    active: true, favorite: id === 'hk'
  });
  const cities = [
    fixture('hk', 'Hong Kong', 'Hong Kong SAR', 'HK', '港岛', 22.28, 114.15, google('Hong Kong')),
    fixture('jp', 'Tokyo', 'Japan', 'JP', 'Shibuya', 35.66, 139.7, google('Tokyo')),
    fixture('bj', 'Beijing', 'China', 'CN', '朝阳区', 39.9, 116.4, apple('39.9,116.4')),
    fixture('xa', "Xi'an", 'China', 'CN', '碑林区', 34.25, 108.94, apple('34.25,108.94'))
  ];
  const paris = fixture('', 'Paris', 'France', 'FR', '', 48.86, 2.35, google('Paris'));
  const shanghai = fixture('', 'Shanghai', 'China', 'CN', '黄浦区', 31.23, 121.47, apple('31.23,121.47'));
  let records = scenario === 'empty' ? [] : [
    ...cities,
    ...[null, '', ' ', 'garbage', 91].map((latitude, i) => ({ ...cities[1], id: 'invalid-' + i, latitude }))
  ];
  const requests = [];
  const pendingLists = [];
  const list = shops => new Response(JSON.stringify({ ok: true, shops }));
  const reply = payload => new Response(JSON.stringify(payload));
  localStorage.setItem('hk-coffee-admin-key-v2', 'phase-1-test-only');
  localStorage.setItem('coffee-map-country-city-v1:CN', 'Beijing');
  if (scenario !== 'empty') {
    localStorage.setItem('coffee-map-active-country-v1', 'CN');
    localStorage.setItem('coffee-map-active-city-v1', 'Beijing');
  }
  if (scenario === 'migration') {
    localStorage.setItem('coffee-map-all-data-v3', JSON.stringify({
      shops: [{ ...cities[2], id: 'legacy' }], cached_at: new Date().toISOString()
    }));
  }
  if (scenario === 'stale') {
    localStorage.setItem(cacheKey, JSON.stringify({ shops: records, cached_at: '2000-01-01T00:00:00Z' }));
  }

  window.fetch = async (url, options) => {
    if (!String(url).startsWith('https://script.google.com/')) throw new Error('Unexpected network call');
    if (options?.method !== 'POST') {
      if (new URL(url).searchParams.get('action') !== 'list') throw new Error('Unexpected list request');
      return new Promise(resolve => pendingLists.push({ resolve, snapshot: records.slice() }));
    }
    const { action, adminKey, data } = JSON.parse(options.body);
    if (adminKey !== 'phase-1-test-only') throw new Error('Unexpected admin key');
    requests.push({ action, data });
    if (action === 'parse') {
      // PR #9 v7 parse accepts one merchant field, with optional hints.
      const fields = Object.keys(data);
      if (fields.length !== 1 || !['google_maps', 'apple_maps'].includes(fields[0])) throw new Error('Unexpected v7 parse fields');
      if (data.google_maps === paris.google_maps) return reply({ ok: true, place: paris });
      if (data.apple_maps === shanghai.apple_maps) return reply({ ok: true, place: shanghai });
      if (data.google_maps === google('Unresolved')) return reply({ ok: true, place: { ...paris, city: '' } });
      if (data.google_maps === google('Wrong provider')) return reply({ ok: true, place: shanghai });
      if (data.google_maps === google('Invalid coordinates')) return reply({ ok: true, place: { ...paris, latitude: null } });
      throw new Error('Unexpected mock place');
    }
    if (action === 'add') {
      const shop = { ...data, id: 'saved-' + data.city, name: data.name + ' (saved)' };
      records.push(shop);
      return reply({ ok: true, shop });
    }
    if (action === 'update' || action === 'setFavorite') {
      const shop = { ...records.find(record => record.id === data.id), ...data };
      records = records.map(record => record.id === data.id ? shop : record);
      return reply({ ok: true, shop });
    }
    throw new Error('Unexpected action ' + action);
  };
  window.phase1 = {
    cacheKey, cities, google, paris, shanghai, requests, pendingLists,
    completeList() {
      const { resolve, snapshot } = pendingLists.shift();
      resolve(list(snapshot));
    }
  };
}

async function exercise(scenario) {
  const { cacheKey, cities, google, paris, shanghai, requests, pendingLists, completeList } = window.phase1;
  const $ = selector => document.querySelector(selector);
  const click = selector => $(selector).click();
  const form = $('#addForm');
  const fields = form.elements;
  const catalog = window.CoffeeMapCities;
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const until = async (predicate, message) => {
    for (let i = 0; i < 50; i++) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(message);
  };
  const shopCard = id => $('#shopList [data-shop-id="' + id + '"]');
  const switchCity = (city, code) => check(catalog.setActiveCity(city, code), 'Cannot switch to ' + city);
  const startParse = url => {
    fields.map_link.value = url;
    fields.map_link.dispatchEvent(new Event('input', { bubbles: true }));
    click('#parsePlaceButton');
  };
  const parse = async (url, state = 'success') => {
    startParse(url);
    await until(() => $('#parseState').className === state, 'Unexpected parse status: ' + $('#parseState').textContent);
  };

  await until(() => pendingLists.length === 1, 'Initial list request missing or duplicated');
  check(localStorage.getItem('hk-coffee-admin-key-v2') === 'phase-1-test-only', 'Admin key changed');
  check(localStorage.getItem('coffee-map-country-city-v1:CN') === 'Beijing', 'Remembered city changed');
  if (scenario === 'empty') {
    check(!localStorage.getItem(cacheKey), 'Cold start unexpectedly has a cache');
    completeList();
    await until(() => $('#resultCount').textContent === '0', 'Empty list did not render');
    check(JSON.parse(localStorage.getItem(cacheKey)).shops.length === 0, 'Empty list not cached');
    click('#addButton');
    await parse(paris.google_maps);
    fields.region.value = 'First Region';
    localStorage.removeItem(cacheKey);
    window.CoffeeMapData.invalidate();
    form.requestSubmit();
    await until(() => Boolean(shopCard('saved-Paris')), 'Cold-cache add did not render returned shop');
    check(catalog.activeCity === 'Paris' && catalog.countries.FR, 'Cold-cache add did not update navigation');
    await until(() => pendingLists.length === 1, 'Partial snapshot did not trigger reconciliation');
    completeList();
    await until(() => Boolean(JSON.parse(localStorage.getItem(cacheKey)).cached_at), 'Full cache did not recover');
    return;
  }
  if (scenario === 'migration') {
    check(!localStorage.getItem('coffee-map-all-data-v3') && !shopCard('legacy'), 'Legacy cache was reused');
    completeList();
    await until(() => Boolean(shopCard('bj')), 'Cold v4 data did not render');
    check(JSON.parse(localStorage.getItem(cacheKey)).shops.some(shop => shop.favorite), 'Favorite lost');
    for (const shop of cities) {
      switchCity(shop.city, shop.country_code);
      await until(() => Boolean(shopCard(shop.id)), 'Existing shop missing in ' + shop.city);
      check($('#resultCount').textContent === '1', 'City isolation or coordinate filtering failed for ' + shop.city);
      const bounds = catalog.getCity(shop.city, shop.country_code).bounds;
      check(bounds.points.length === 1 && bounds.points[0][0] === shop.longitude, 'Invalid point affected bounds');
      shopCard(shop.id).click();
      const apple = shop.country_code === 'CN';
      check($('#appleMapsButton').hidden !== apple && $('#googleMapsButton').hidden === apple, 'Wrong detail provider');
      check($(apple ? '#appleMapsButton' : '#googleMapsButton').getAttribute('href') === (shop.apple_maps || shop.google_maps), 'Stored link changed');
    }
    switchCity('Hong Kong', 'HK');
    click('[data-view="saved"]');
    check(Boolean(shopCard('hk')), 'Existing favorite not visible');
    shopCard('hk').click();
    click('#favoriteButton');
    await until(() => !shopCard('hk'), 'Removing a favorite did not update the saved list');
    click('[data-view="map"]');
    shopCard('hk').click();
    click('#favoriteButton');
    await until(() => $('#favoriteButton').getAttribute('aria-pressed') === 'true', 'Favorite could not be restored');

    switchCity('Tokyo', 'JP');
    await until(() => Boolean($('#shopList [data-shop-row="jp"]')), 'Admin row missing');
    shopCard('jp').click();
    click('#editSelectedButton');
    const edit = $('#editPlaceForm');
    check($('#editPlaceDialog').open && edit.elements.city.value === 'Tokyo', 'Editor did not load current shop');
    check(edit.elements.region.list.options[0].value === 'Shibuya', 'Existing region is not suggested');
    edit.elements.region.value = 'New Tokyo Region';
    edit.elements.google_maps.value = google('Tokyo Edited');
    click('#refreshButton');
    await until(() => pendingLists.length === 1, 'Editor refresh did not start');
    const refreshed = new Promise(resolve => window.addEventListener('coffee-map:data-updated', resolve, { once: true }));
    completeList();
    await refreshed;
    check(edit.elements.region.value === 'New Tokyo Region' && edit.elements.google_maps.value === google('Tokyo Edited'), 'Background refresh changed the editor');
    edit.requestSubmit();
    await until(() => !$('#editPlaceDialog').open, 'New edit region was not saved');
    check(requests.at(-1).data.region === 'New Tokyo Region', 'New edit region missing in request');

    click('#addButton');
    await parse(shanghai.apple_maps);
    check(fields.city.value === 'Shanghai' && fields.country_code.value === 'CN', 'Tokyo restricted Shanghai parsing');
    check(!catalog.getCity('Shanghai', 'CN'), 'Unsaved Shanghai leaked into catalog');
    form.requestSubmit();
    await until(() => Boolean(shopCard('saved-Shanghai')), 'Shanghai save was not immediately visible');
    check(catalog.activeCity === 'Shanghai' && requests.at(-1).data.apple_maps === shanghai.apple_maps
      && requests.at(-1).data.google_maps === '', 'Shanghai save used the wrong provider');
    return;
  }

  check(catalog.activeCity === 'Beijing', 'Stale cache should restore Beijing');
  click('#addButton');
  await parse(google('Unresolved'), 'error');
  check($('#parseState').textContent.includes('无法确认'), 'Missing location was silently accepted');
  await parse(google('Wrong provider'), 'error');
  check($('#parseState').textContent.includes('Apple Maps'), 'Provider was not validated using parsed country');
  await parse(google('Invalid coordinates'), 'error');
  check($('#parseState').textContent.includes('有效坐标'), 'Null parse coordinates were accepted');
  await parse(paris.google_maps);
  check(fields.city.value === 'Paris' && fields.country.value === 'France' && fields.country_code.value === 'FR', 'Beijing restricted Paris parsing');
  check(!catalog.getCity('Paris', 'FR'), 'Unsaved Paris leaked into catalog');
  fields.region.value = 'First Paris Region';
  fields.district.value = 'Edited Paris District';
  const refreshed = new Promise(resolve => window.addEventListener('coffee-map:data-updated', resolve, { once: true }));
  completeList();
  await refreshed;
  await until(() => $('#cloudMeta').textContent.includes('更新于'), 'Background list did not reach the active view');
  check(fields.city.value === 'Paris' && fields.country.value === 'France' && fields.country_code.value === 'FR'
    && fields.region.value === 'First Paris Region' && fields.district.value === 'Edited Paris District'
    && fields.map_link.value === paris.google_maps && $('#parseState').className === 'success', 'Background sync changed the Paris draft');

  click('#refreshButton');
  await until(() => pendingLists.length === 1, 'Second list request did not start');
  form.requestSubmit();
  await until(() => Boolean(shopCard('saved-Paris')), 'New city missing after save');
  const add = requests.at(-1);
  check(add.action === 'add' && add.data.google_maps === paris.google_maps && add.data.apple_maps === ''
    && !('map_link' in add.data) && add.data.region === 'First Paris Region', 'Add payload violated v7 contract');
  check(shopCard('saved-Paris').textContent.includes('(saved)'), 'Catalog did not use returned record');
  const reconciled = new Promise(resolve => window.addEventListener('coffee-map:data-updated', resolve, { once: true }));
  completeList();
  await reconciled;
  check(catalog.getCity('Paris', 'FR').regions.includes('First Paris Region'), 'In-flight list dropped saved city or region');
  switchCity('Beijing', 'CN');
  click('#countryList [data-country-code="FR"]');
  check(catalog.activeCity === 'Paris' && Boolean(shopCard('saved-Paris')), 'France could not be selected immediately');
}

for (const [scenario, title] of Object.entries({
  migration: 'v3 migration, four existing cities, active edit, and Tokyo → Shanghai',
  stale: 'Beijing → Paris, parse validation, transient draft, and concurrent save/refresh',
  empty: 'cold start, empty catalog, and first save without a cache'
})) {
  test('API v7 mock contract in Chromium: ' + title, {
    skip: !browserAvailable && 'Playwright and Chromium required (set CHROMIUM_BIN if needed)'
  }, async () => {
    const executablePath = process.env.CHROMIUM_BIN || spawnSync('which', [chromium], { encoding: 'utf8' }).stdout.trim();
    const browser = await playwright.chromium.launch({ executablePath, timeout: 10_000 });
    try {
      const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(installMock, { scenario, cacheKey: ALL_DATA_CACHE_KEY });
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://coffee-map.test') return route.abort();
        const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        if (!/^[a-z0-9-]+\.(?:js|css|html)$/.test(name)) return route.abort();
        // Playwright serves local files directly. There is no listening HTTP server.
        return route.fulfill({ path: join(root, name) });
      });
      await page.goto('http://coffee-map.test/', { timeout: 10_000 });
      await page.evaluate(exercise, scenario);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  });
}

test('coordinate validation keeps actual zeros and rejects blanks, coercions, and out-of-range values', () => {
  for (const bad of [undefined, null, '', ' ', false, [], 'bad', '0x10', Infinity, NaN, 91]) {
    assert.equal(hasCoordinates({ latitude: bad, longitude: 0 }), false);
  }
  assert.equal(hasCoordinates({ latitude: 0, longitude: 181 }), false);
  assert.equal(hasCoordinates({ latitude: '0', longitude: 0 }), true);
  assert.equal(hasCoordinates({ latitude: -90, longitude: '180' }), true);
});

test('PWA shell versions match the page and cache bootstrap', () => {
  const html = source('index.html');
  const worker = source('sw.js');
  assert.ok(html.includes(ALL_DATA_CACHE_KEY));
  assert.match(worker, /coffee-map-v39-/);
  assert.match(source('app.js'), /register\('\.\/sw\.js\?v=39'\)/);
  for (const asset of ['location-catalog.js', 'map-config.js', 'multicity.js', 'app.js', 'admin-core.js']) {
    const path = './' + asset + '?v=39';
    assert.ok(worker.includes(path));
    assert.ok((asset === 'multicity.js' ? source('map-config.js') : html).includes(path));
  }
});
