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
  const v40 = /-v4[01]$/.test(scenario);
  const camera = [];
  let deferredMapLoad;
  if (v40) {
    class MapStub {
      constructor() {
        if (scenario === 'webgl-v40') throw new Error('WebGL initialization failed');
      }
      addControl() {}
      on(type, fn) {
        if (type !== 'load') return;
        if (scenario === 'search-v41') deferredMapLoad = fn;
        else requestAnimationFrame(fn);
      }
      getLayer() { return true; }
      getContainer() { return { clientWidth: 390, clientHeight: 844 }; }
      isMoving() { return false; }
      flyTo(options) { camera.push(['fly', options]); }
      fitBounds(bounds) { camera.push(['fit', bounds.points]); }
      easeTo(options) { camera.push(['ease', options]); }
      stop() { camera.push(['stop']); }
    }
    class Marker {
      constructor({ element }) { this.element = element; }
      setLngLat() { return this; }
      addTo() { return this; }
      getElement() { return this.element; }
      remove() {}
    }
    class Bounds {
      constructor() { this.points = []; }
      extend(point) { this.points.push(point); }
      getSouthWest() { return { lng: this.points[0][0], lat: this.points[0][1] }; }
      getNorthEast() { return this.getSouthWest(); }
    }
    window.maplibregl = { Map: MapStub, Marker, LngLatBounds: Bounds, NavigationControl: class {}, AttributionControl: class {} };
    // Give cross-city shops identical names and addresses to expose text-based selection.
    records = [
      ...cities.map(shop => ({ ...shop, favorite: shop.id !== 'bj', name: 'Shared Coffee', address: 'Same address' })),
      { ...cities[0], id: 'hk-other', name: 'Other Coffee', region: '九龙', district: '九龙 district', favorite: false },
      { ...cities[1], id: 'inactive', active: false, favorite: true },
      { ...cities[1], id: 'invalid', latitude: null, favorite: true }
    ];
  }
  if (scenario === 'search-v41') {
    records.push({ ...records[1], id: 'jp-bj', city: 'Beijing', category: 'Roastery', notes: 'Single origin' });
  }
  const requests = [];
  const pendingLists = [];
  const pendingFavorites = [];
  const list = shops => new Response(JSON.stringify({ ok: true, shops }));
  const reply = payload => new Response(JSON.stringify(payload));
  localStorage.setItem('hk-coffee-admin-key-v2', 'phase-1-test-only');
  localStorage.setItem('coffee-map-country-city-v1:CN', 'Beijing');
  if (scenario !== 'empty' && (!v40 || !localStorage.getItem('coffee-map-active-city-v1'))) {
    localStorage.setItem('coffee-map-active-country-v1', v40 ? 'HK' : 'CN');
    localStorage.setItem('coffee-map-active-city-v1', v40 ? 'Hong Kong' : 'Beijing');
  }
  if (scenario === 'sync-v40') {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = () => timeout(1000);
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
      return new Promise((resolve, reject) => pendingLists.push({ resolve, reject, snapshot: records.slice() }));
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
    if (action === 'setFavorite' && v40) {
      return new Promise((resolve, reject) => {
        const write = { data, resolve, reject, signal: options.signal };
        pendingFavorites.push(write);
        options.signal?.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    }
    if (action === 'archive') {
      records = records.filter(record => record.id !== data.id);
      return reply({ ok: true });
    }
    if (action === 'update' || action === 'setFavorite') {
      const shop = { ...records.find(record => record.id === data.id), ...data };
      records = records.map(record => record.id === data.id ? shop : record);
      return reply({ ok: true, shop });
    }
    throw new Error('Unexpected action ' + action);
  };
  window.phase1 = {
    cacheKey, cities, google, paris, shanghai, requests, pendingLists, pendingFavorites, camera,
    finishMapLoad() { deferredMapLoad(); },
    addRecord(shop) { records.push(shop); },
    completeList(ok = true) {
      const { resolve, reject, snapshot } = pendingLists.shift();
      if (ok) resolve(list(snapshot));
      else reject(new TypeError('Connection lost reading list'));
    },
    completeFavorite(outcome = 'success') {
      const { data, resolve, reject } = pendingFavorites.shift();
      if (outcome === 'timeout') return;
      if (outcome === 'failure') return resolve(reply({ ok: false, error: 'Mock rejected write' }));
      if (outcome === 'network-error-no-write') return reject(new TypeError('Connection lost'));
      const shop = { ...records.find(record => record.id === data.id), ...data };
      records = records.map(record => record.id === data.id ? shop : record);
      if (outcome === 'network-error') return reject(new TypeError('Connection lost'));
      if (outcome === 'success') resolve(reply({ ok: true, shop }));
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

async function exerciseV40(scenario) {
  const { cacheKey, cities, requests, pendingLists, pendingFavorites, camera, addRecord, completeList, completeFavorite } = window.phase1;
  const catalog = window.CoffeeMapCities;
  const $ = selector => document.querySelector(selector);
  const click = selector => $(selector).click();
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const until = async (predicate, message) => {
    const limit = Date.now() + 4000;
    while (Date.now() < limit) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(message);
  };
  const card = id => $('#shopList [data-shop-id="' + id + '"]');
  const count = () => Number($('#resultCount').textContent);
  const country = code => $('[data-country-code="' + code + '"].country-option');
  const openCountry = () => click('#cityButton');
  const countryOpen = () => $('#countrySheet').getAttribute('aria-hidden') === 'false';
  const selected = () => $('#detailSheet').dataset.shopId;
  const pressed = () => $('#favoriteButton').getAttribute('aria-pressed');
  const nextData = () => new Promise(resolve => window.addEventListener('coffee-map:data-updated', resolve, { once: true }));
  const cached = id => JSON.parse(localStorage.getItem(cacheKey)).shops.find(shop => shop.id === id);
  const type = (input, text) => {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const openSearch = () => click('.compact-search-button');
  const search = query => type($('.search-mode-input'), query);
  const searchIds = () => [...document.querySelectorAll('[data-search-shop-id]')].map(button => button.dataset.searchShopId);
  const choose = id => click(`[data-search-shop-id="${id}"]`);
  await until(() => pendingLists.length === 1, 'Initial list request missing');
  completeList();
  await until(() => card('hk') && $('.compact-search-button'), 'City list or search did not initialize');
  await new Promise(requestAnimationFrame);

  if (scenario === 'search-v41') {
    click('#districtButton');
    click('[data-district="港岛 district"]');
    const before = JSON.stringify(camera);
    openSearch();
    const expectResults = (...ids) => {
      check(JSON.stringify(searchIds()) === JSON.stringify(ids), 'Unexpected IDs: ' + searchIds());
      if (ids.length) {
        check($('.search-mode-status').textContent === `${ids.length} 个匹配结果`, 'Count differs from displayed records');
      }
    };
    check($('[data-search-scope="all"]').getAttribute('aria-pressed') === 'true', 'Default scope is not global');
    expectResults();
    search('  SHARED  ');
    expectResults('hk', 'jp', 'bj', 'xa', 'jp-bj');
    check($('[data-search-shop-id="jp"]').textContent.includes('Japan · Tokyo'), 'Search result has no location');
    click('[data-search-scope="city"]');
    expectResults('hk');
    search('other');
    expectResults('hk-other');
    click('[data-search-scope="all"]');
    for (const [query, ids] of [
      ['东京', ['jp']], ['Tokyo', ['jp']], ['中国', ['bj', 'xa']], ['西安', ['xa']],
      ['  cn ', ['bj', 'xa']], ['Japan', ['jp', 'jp-bj']], ['日本', ['jp', 'jp-bj']],
      ['北京', ['bj']], ['Beijing', ['bj', 'jp-bj']], ['Shibuya district', ['jp', 'jp-bj']],
      ['碑林区', ['xa']], ['same address', ['hk', 'jp', 'bj', 'xa', 'jp-bj']],
      ['roastery', ['jp-bj']], ['single origin', ['jp-bj']]
    ]) {
      search(query);
      expectResults(...ids);
    }
    click('.search-mode-cancel');
    check(catalog.activeLocationKey === 'HK::Hong Kong' && card('hk') && !card('hk-other')
      && JSON.stringify(camera) === before && pendingLists.length === 0, 'Typing or canceling affected the map, filter or API');

    click('[data-view="list"]');
    openSearch();
    search('shared');
    const now = Date.now.bind(Date);
    Date.now = () => now() + 16 * 60 * 1000;
    choose('bj');
    // Open another result in the same turn, before the first city's continuation.
    openSearch();
    choose('xa');
    await until(() => selected() === 'xa', 'Rapid cross-city choices opened the wrong shop');
    check(catalog.activeLocationKey === "CN::Xi'an" && $('[data-view="map"]').classList.contains('active'),
      'Selection did not prepare the target map view');
    check(!$('#appleMapsButton').hidden && $('#googleMapsButton').hidden, 'Shop country did not determine map provider');
    check(JSON.stringify(camera.slice(JSON.parse(before).length).filter(([type]) => type !== 'stop'))
      === JSON.stringify([['fly', { center: [108.94, 34.25], zoom: 15.6, offset: [0, -90], essential: true }]]),
      'An obsolete city fit or shop focus moved the camera');
    window.phase1.finishMapLoad();
    check(camera.at(-1)[1].zoom === 15.6 && pendingLists.length === 0, 'Map load overrode focus or search fetched data');
    Date.now = now;

    openSearch();
    click('[data-search-scope="city"]');
    expectResults('xa');
    click('[data-search-scope="all"]');
    choose('bj');
    await until(() => selected() === 'bj', 'Beijing detail by ID did not open');
    openSearch();
    click('[data-search-scope="city"]');
    expectResults('bj');
    choose('bj');
    await until(() => selected() === 'bj' && camera.at(-1)[1].zoom === 15.6, 'Current-city result did not focus');

    // Edit and favorite a shop while an older list response is still pending.
    click('#refreshButton');
    click('#editSelectedButton');
    const form = $('#editPlaceForm');
    check(form.dataset.shopId === 'bj', 'Editor selected the wrong ID');
    form.elements.name.value = 'Renamed coffee';
    form.requestSubmit();
    await until(() => !$('#editPlaceDialog').open && cached('bj').name === 'Renamed coffee', 'Edit did not update cache');
    openSearch();
    search('renamed');
    expectResults('bj');
    click('#favoriteButton');
    completeFavorite();
    await until(() => cached('bj').favorite, 'Favorite did not update cache');
    const lastFocus = JSON.stringify(camera);
    const lateRead = nextData();
    completeList();
    await lateRead;
    expectResults('bj');
    check(JSON.stringify(camera) === lastFocus && cached('bj').favorite, 'Late response overrode focus or updated records');
    click('.search-mode-cancel');
    click('[data-view="saved"]');
    openSearch();
    check($('.search-mode-scopes').hidden && $('.search-mode-input').value === '', 'Ordinary search leaked into Favorites');
    search('renamed');
    expectResults('bj');
    choose('bj');
    click('#favoriteButton');
    openSearch();
    expectResults();
    completeFavorite();
    await until(() => !cached('bj').favorite, 'Unfavorite did not persist');
    click('.search-mode-cancel');
    click('[data-view="map"]');
    openSearch();
    check($('.search-mode-input').value === 'renamed' && !$('.search-mode-scopes').hidden, 'Favorites changed ordinary search');
    expectResults('bj');
    choose('bj');
    await until(() => selected() === 'bj', 'Renamed shop was not selectable');
    window.confirm = () => true;
    click('#deleteSelectedButton');
    await until(() => !cached('bj'), 'Archive did not update cache');
    openSearch();
    expectResults();
    check(requests.at(-1).data.id === 'bj' && cached('jp-bj'), 'Archive targeted a different shop');
    return;
  }

  if (scenario === 'navigation-v40') {
    let changes = 0;
    window.addEventListener('coffee-map:city-change', () => changes++);
    openCountry();
    check(!country('JP').hasAttribute('aria-expanded'), 'Single city received a chevron');
    country('JP').click();
    check(!countryOpen() && catalog.activeCity === 'Tokyo' && changes === 1, 'Single city did not open directly');
    openCountry();
    const before = camera.length;
    check(country('CN').querySelector('use').getAttribute('href') === '#ms-expand-more', 'Multi-city chevron missing');
    country('CN').click();
    check(country('CN').getAttribute('aria-expanded') === 'true' && !$('#country-cities-CN').hidden, 'Country did not expand');
    country('CN').click();
    check($('#country-cities-CN').hidden && countryOpen(), 'Country toggle did not collapse the list');
    check(changes === 1 && camera.length === before && pendingLists.length === 0, 'Accordion changed locations, camera or data');
    country('CN').click();
    click(`[data-location-key="CN::Xi'an"]`);
    check(!countryOpen() && catalog.activeCity === "Xi'an" && card('xa'), 'City row did not switch');
    openCountry();
    check(country('CN').getAttribute('aria-expanded') === 'true', 'Active multi-city country did not reopen');
    const selectedCity = $(`[data-location-key="CN::Xi'an"]`);
    const cityLabels = selectedCity.firstElementChild;
    const cityName = cityLabels.querySelector('strong');
    const localName = cityLabels.querySelector('small');
    const rect = node => node.getBoundingClientRect();
    const style = node => getComputedStyle(node);
    check(selectedCity.querySelector('use').getAttribute('href') === '#ms-check', 'Selected city checkmark missing');
    check(rect(cityName).left === rect(country('CN').querySelector('strong')).left
      && rect(selectedCity.querySelector('b')).right === rect(country('CN').querySelector('b')).right,
      'City text or indicator did not align with country row');
    check(style($('#country-cities-CN')).borderLeftWidth === '0px'
      && style($('#country-cities-CN')).marginLeft === '0px' && style(selectedCity).borderBottomWidth === '0px'
      && style(country('CN').parentElement).borderTopWidth === '1px', 'City or country divider behavior changed');
    check(rect(selectedCity).height >= 44 && style(selectedCity).minHeight === '44px'
      && style(cityName).fontSize === '16px' && style(cityName).fontWeight === '500'
      && style(localName).fontSize === '14px' && style(localName).fontWeight === '400'
      && rect(localName).left - rect(cityName).right === 8 && Math.abs(rect(localName).top - rect(cityName).top) < 5,
      'City names are not compact, bilingual and inline');
    cityName.textContent = 'LongEnglishCityName'.repeat(8);
    localName.textContent = '很长的本地化城市名称'.repeat(9);
    check(rect(selectedCity).height > 44 && cityLabels.scrollWidth <= cityLabels.clientWidth
      && rect(cityLabels).right <= rect(selectedCity.querySelector('b')).left,
      'Long city labels did not wrap clear of the indicator');
    click('[data-close-country]');
    click('#districtButton');
    click('[data-location-city="Beijing"]');
    check(catalog.activeCity === 'Beijing' && card('bj'), 'Cities & Areas quick switch failed');
    click('#refreshButton');
    await until(() => pendingLists.length === 1, 'Manual refresh missing');
    completeList();
    addRecord({ ...cities[1], id: 'osaka', city: 'Osaka' });
    await until(() => $('#cloudMeta').textContent.includes('更新于'), 'Refresh failed');
    click('#refreshButton');
    await until(() => pendingLists.length === 1, 'Second refresh missing');
    completeList();
    await until(() => catalog.getCity('Osaka', 'JP'), 'New city not added dynamically');
    openCountry();
    country('JP').click();
    check(countryOpen() && catalog.activeCity === 'Beijing' && $('#country-cities-JP button').dataset.locationKey,
      'New multi-city country switched without a city choice');
    check(!$('[data-location-key="JP::Osaka"] small'), 'City without a local label rendered a placeholder');
    click('[data-location-key="JP::Osaka"]');
    check(!countryOpen() && catalog.activeCity === 'Osaka' && card('osaka'), 'New city selection did not switch');
    return;
  }

  if (scenario === 'webgl-v40') {
    check($('#map .map-error')?.textContent.includes('地图暂不可用') && $('#locateButton').disabled, 'WebGL error state missing');
    click('[data-view="list"]');
    openSearch();
    search('other');
    check(searchIds().join() === 'hk-other', 'List search stopped after WebGL failure');
    search('东京');
    choose('jp');
    await until(() => selected() === 'jp', 'Cross-city search detail stopped after WebGL failure');
    check(catalog.activeCity === 'Tokyo' && card('jp') && $('[data-view="list"]').classList.contains('active'), 'The Tokyo list did not load');
    click('[data-view="saved"]');
    check(count() === 3 && card('jp') && card('xa'), 'Global favorites stopped after WebGL failure');
    card('xa').click();
    check(selected() === 'xa' && !$('#appleMapsButton').hidden, 'Detail stopped after WebGL failure');
    click('#favoriteButton');
    check(!card('xa') && pressed() === 'false', 'Favorite toggle stopped after WebGL failure');
    completeFavorite();
    await until(() => !cached('xa').favorite, 'Write not cached after WebGL failure');
    return;
  }

  if (scenario === 'favorites-v40') {
    click('#districtButton');
    click('[data-location-region="港岛"]');
    type($('#searchInput'), 'Shared');
    await new Promise(requestAnimationFrame);
    const before = JSON.stringify(camera);
    click('[data-view="saved"]');
    check($('#savedTitle').textContent === '收藏' && getComputedStyle($('#cityButton')).display === 'none'
      && getComputedStyle($('#regionFilters')).display === 'none', 'Saved header did not hide location controls');
    check(count() === 3 && Number($('#savedCount').textContent) === 3 && !card('inactive') && !card('invalid'), 'Wrong total or invalid favorites shown');
    check(document.querySelectorAll('.saved-country').length === 3 && document.querySelectorAll('.saved-city').length === 3, 'Wrong location grouping');
    click('.compact-search-button');
    type($('.search-mode-input'), "Xi'an");
    await until(() => $('[data-search-shop-id="xa"]'), 'Mobile global search failed');
    check(count() === 1 && Number($('#savedCount').textContent) === 3 && $('.search-mode-status').textContent === '1 个匹配结果', 'Search modified the total');
    click('[data-search-shop-id="xa"]');
    check(selected() === 'xa' && !$('#appleMapsButton').hidden && $('#googleMapsButton').hidden, 'Cross-city search opened the wrong shop/provider');
    check(catalog.activeCity === 'Hong Kong' && JSON.stringify(camera) === before, 'Cross-city opening changed the camera or city');
    click('#editSelectedButton');
    const form = $('#editPlaceForm');
    check(form.dataset.shopId === 'xa' && form.elements.city.value === "Xi'an", 'Editor resolved identical name/address to the wrong ID');
    form.elements.name.value = 'Edited Xi’an';
    form.requestSubmit();
    await until(() => !$('#editPlaceDialog').open && card('xa')?.textContent.includes('Edited Xi’an'), 'Cross-city edit did not refresh the global card');
    check(requests.at(-1).data.id === 'xa' && cached('hk').name === 'Shared Coffee', 'Edit affected another ID');
    window.confirm = () => true;
    click('#deleteSelectedButton');
    await until(() => !cached('xa') && !card('xa'), 'Cross-city archive did not remove the shop');
    check(requests.at(-1).data.id === 'xa' && selected() == null && Number($('#savedCount').textContent) === 2, 'Delete targeted the wrong ID or left stale detail/count');
    click('[data-view="list"]');
    check($('#searchInput').value === 'Shared' && card('hk') && !card('hk-other'), 'Saved search leaked into city search');
    type($('#searchInput'), '');
    check(!card('hk-other'), 'City region filter was lost');
    click('[data-view="map"]');
    check(JSON.stringify(camera) === before && catalog.activeCity === 'Hong Kong', 'Return to map moved the camera');
    check(pendingLists.length === 0, 'Entering or searching favorites fetched a list');
    return;
  }

  click('[data-view="saved"]');
  card('jp').click();
  const start = performance.now();
  click('#favoriteButton');
  check(pressed() === 'false' && $('#favoriteButtonLabel').textContent === '收藏'
    && $('#favoriteButton use').getAttribute('href') === '#ms-bookmark'
    && !card('jp') && performance.now() - start < 100, 'Slow write blocked immediate visible state');
  click('#favoriteButton');
  check(card('jp') && pressed() === 'true' && pendingFavorites.length === 1, 'Repeated click did not queue the latest intent');
  completeFavorite();
  await until(() => pendingFavorites.length === 1 && pendingFavorites[0].data.favorite, 'Opposite writes were not serialized');
  click('#refreshButton');
  await until(() => pendingLists.length === 1, 'Missing stale list request');
  check(!pendingLists[0].snapshot.find(shop => shop.id === 'jp').favorite, 'Test read is not stale');
  const latestWrite = nextData();
  completeFavorite();
  await latestWrite;
  const lateRead = nextData();
  completeList();
  await lateRead;
  await until(() => $('#menuSheet').getAttribute('aria-hidden') === 'true', 'Late read did not complete');
  check(cached('jp').favorite && card('jp') && pressed() === 'true', 'Late list overrode the confirmed favorite');

  click('#favoriteButton');
  click('#refreshButton');
  await until(() => pendingLists.length === 1, 'Missing pending list request');
  const pendingRead = nextData();
  completeList();
  await pendingRead;
  check(!card('jp') && pressed() === 'false', 'Background list overrode an optimistic state');
  click('[data-close-sheet]');
  catalog.setActiveCity('Beijing', 'CN');
  click('[data-view="list"]');
  completeFavorite('failure');
  await until(() => $('#toast').textContent.includes('Mock rejected write'), 'Definite rejection had no error or rollback: ' + JSON.stringify(requests));
  click('[data-view="saved"]');
  check(card('jp') && cached('jp').favorite && catalog.activeCity === 'Beijing', 'Failed write did not restore state after city/view switch');

  card('jp').click();
  click('#favoriteButton');
  completeFavorite('network-error');
  await until(() => pendingLists.length === 1, 'Uncertain network result was not re-read');
  check(!card('jp') && pressed() === 'false', 'Uncertain write rolled back before verification');
  completeList();
  await until(() => !cached('jp').favorite, 'Committed write was not confirmed');

  card('hk').click();
  click('#favoriteButton');
  const timedOut = pendingFavorites[0];
  await until(() => timedOut.signal.aborted && pendingLists.length === 1, 'Timed-out POST was not re-read');
  check(!card('hk') && pressed() === 'false', 'Timeout rolled back before verifying');
  completeFavorite('timeout');
  completeList();
  await until(() => card('hk') && pressed() === 'true', 'Timeout did not reconcile to the verified server value');
  check($('#toast').textContent.includes('云端未确认'), 'Missing timeout status');

  click('#favoriteButton');
  completeFavorite('network-error-no-write');
  await until(() => pendingLists.length === 1, 'Verification list missing');
  completeList(false);
  await until(() => $('#syncIndicator').textContent === '收藏待确认', 'Failed confirmation was not visible');
  check(!card('hk') && cached('hk').favorite, 'Failed read discarded the optimistic value or overwrote the confirmed cache');
  click('#refreshButton');
  await until(() => pendingLists.length === 1, 'Manual retry missing');
  completeList();
  await until(() => card('hk') && pressed() === 'true', 'Manual retry did not reconcile the favorite');

  for (const id of ['hk', 'xa']) {
    card(id).click();
    click('#favoriteButton');
    completeFavorite();
    await until(() => !cached(id).favorite, 'Removal did not sync for ' + id);
  }
  check(count() === 0 && Number($('#savedCount').textContent) === 0
    && $('#shopList .empty-state').textContent.includes('还没有收藏'), 'Missing empty favorites state');
}

for (const [scenario, title] of Object.entries({
  migration: 'v3 migration, four existing cities, active edit, and Tokyo → Shanghai',
  stale: 'Beijing → Paris, parse validation, transient draft, and concurrent save/refresh',
  empty: 'cold start, empty catalog, and first save without a cache',
  'navigation-v40': 'single-city navigation, accordion, dynamic city addition, and quick switch',
  'favorites-v40': 'global grouping/search, cross-city identity and provider, edit/archive, and map return',
  'sync-v40': 'optimistic feedback, serial writes, late reads, explicit failure, unknown results and timeout',
  'webgl-v40': 'list, cross-city search, details and favorites survive a throwing WebGL constructor',
  'search-v41': 'global search scope, location labels, rapid choices, late fit and cache mutations'
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
      await page.evaluate(/-v4[01]$/.test(scenario) ? exerciseV40 : exercise, scenario);
      if (scenario === 'search-v41') {
        await page.setViewportSize({ width: 1080, height: 844 });
        await page.locator('.search-mode-cancel').click();
        await page.locator('#searchInput').click();
        await page.locator('[data-search-scope="all"]').click();
        await page.locator('.search-mode-input').fill('东京');
        assert.equal(await page.locator('.search-mode-status').textContent(), '1 个匹配结果');
        assert.equal(await page.locator('[data-search-shop-id="jp"]').isVisible(), true);
      }
      if (scenario === 'navigation-v40') {
        await page.reload();
        assert.equal(await page.evaluate(() => window.CoffeeMapCities.activeCity), 'Osaka');
        assert.equal(await page.locator('#shopList [data-shop-id="osaka"]').count(), 1);
      }
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
  assert.match(worker, /coffee-map-v41/);
  assert.match(source('app.js'), /register\('\.\/sw\.js\?v=41'\)/);
  for (const asset of ['location-catalog.js', 'map-config.js', 'multicity.js', 'compact-search.js', 'app.js', 'admin-core.js', 'compact-nav.css', 'dynamic-location.css']) {
    const path = './' + asset + '?v=41';
    assert.ok(worker.includes(path));
    assert.ok((html + source('map-config.js')).includes(path));
  }
});
