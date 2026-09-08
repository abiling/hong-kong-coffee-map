// Dependency-free camera call-chain checks. These verify deterministic app
// decisions; they do not simulate WebGL, network requests or visual frames.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const ref = process.argv[2] || 'working-tree';
const source = process.argv[2]
  ? execFileSync('git', ['show', `${process.argv[2]}:app.js`], { cwd: root, encoding: 'utf8' })
  : fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function extract(name) {
  const syncStart = source.indexOf(`  function ${name}(`);
  const asyncStart = source.indexOf(`  async function ${name}(`);
  const start = syncStart >= 0 ? syncStart : asyncStart;
  assert.ok(start >= 0, `Missing ${name}`);
  const rest = source.slice(start);
  const end = rest.slice(1).search(/^  (?:async )?function /m);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

class Bounds {
  constructor() { this.points = []; }
  extend(point) { this.points.push(point); return this; }
  getSouthWest() {
    return { lng: Math.min(...this.points.map(p => p[0])), lat: Math.min(...this.points.map(p => p[1])) };
  }
  getNorthEast() {
    return { lng: Math.max(...this.points.map(p => p[0])), lat: Math.max(...this.points.map(p => p[1])) };
  }
}

function startup(order, changedHeader = false, count = 2, changedViewport = false, userMovement = false, movingAtLoad = false) {
  let bottom = 170;
  let width = 390;
  let moving = false;
  const events = {}, calls = [];
  const items = Array.from({ length: count }, (_, i) => ({ longitude: 139.69 + i * .02, latitude: 35.65 + i * .01 }));
  class MapStub {
    addControl() {}
    on(name, fn) { events[name] = fn; }
    getContainer() { return { clientWidth: width, clientHeight: 844 }; }
    isMoving() { return moving; }
    fitBounds(bounds, options) {
      calls.push({ method: 'fitBounds', bounds: bounds.points, options });
      moving = options.duration > 0 && movingAtLoad;
    }
    flyTo(options) {
      calls.push({ method: 'flyTo', options });
      moving = options.duration !== 0 && movingAtLoad;
    }
  }
  const context = vm.createContext({
    window: { maplibregl: true }, maplibregl: {
      Map: MapStub, NavigationControl: class {}, AttributionControl: class {}, LngLatBounds: Bounds
    },
    map: null, filtered: [], lastDataFitKey: '', DEFAULT_CENTER: [114.1588, 22.2857],
    els: { topbar: { getBoundingClientRect: () => ({ bottom }) } },
    installMapContextLayers() {}
  });
  vm.runInContext(extract('initMap') + extract('fitTo') + '\ninitMap();', context);
  if (order === 'data-first') {
    context.filtered = items;
    vm.runInContext('fitTo(filtered, true);', context);
  }
  if (changedHeader) bottom = 201;
  if (changedViewport) width = 430;
  if (userMovement && events.movestart) events.movestart({ originalEvent: {} });
  events.load();
  if (order === 'map-first') {
    context.filtered = items;
    vm.runInContext('fitTo(filtered, true);', context);
  }
  return calls;
}

async function citySwitch(cacheKind) {
  const calls = [];
  const validShop = { active: true, latitude: '35.66', longitude: '139.70' };
  const cached = cacheKind === 'valid' ? { shops: [validShop] }
    : cacheKind === 'empty' ? { shops: [] } : null;
  const context = vm.createContext({
    map: {
      stop: () => calls.push('stop'),
      easeTo: () => calls.push('easeTo')
    },
    activeRegion: 'x', activeDistrict: 'x', selectedId: 'x', shops: ['old'], filtered: ['old'],
    els: { search: { value: 'query' }, clearSearch: { classList: { remove() {} } }, detailSheet: {}, districtSheet: {} },
    window: { CoffeeMapCities: { activeCity: 'Tokyo', cities: { Tokyo: { center: [139.69, 35.68], zoom: 10.6 } }, renderRegionRail() {} } },
    activeCityName: () => 'Tokyo', closeSheet() {}, renderDistricts() {}, applyFilters() {},
    readCityCache: () => cached,
    loadCloudShops: async ({ fit }) => {
      // Valid cached or newly fetched remote data causes applyFilters({fit:true})
      // to perform the final shop-bounds operation.
      if (fit && (cacheKind === 'valid' || cacheKind === 'none')) calls.push('fitBounds');
    }
  });
  vm.runInContext(extract('switchCityView'), context);
  await vm.runInContext("switchCityView({detail:{city:'Tokyo'}})", context);
  return calls;
}

(async () => {
  const stable = startup('data-first');
  const changed = startup('data-first', true);
  const resized = startup('data-first', false, 2, true);
  const interrupted = startup('data-first', false, 2, false, true);
  const animationInProgress = startup('data-first', false, 2, false, false, true);
  const late = startup('map-first');
  const single = startup('data-first', false, 1);
  const result = {
    kind: 'camera operation-count regression, not a browser/network benchmark', ref,
    startup: {
      cachedStableLayout: stable.map(x => x.method),
      cachedChangedHeader: changed.map(x => x.method),
      cachedChangedViewport: resized.map(x => x.method),
      cachedThenUserMovement: interrupted.map(x => x.method),
      cachedAnimationStillMovingAtLoad: animationInProgress.map(x => x.method),
      dataAfterMapLoad: late.map(x => x.method),
      cachedSingleShop: single.map(x => x.method)
    },
    citySwitch: {
      cachedValidShops: await citySwitch('valid'),
      noCacheThenRemote: await citySwitch('none'),
      cachedEmptyCity: await citySwitch('empty')
    }
  };
  if (!process.argv[2]) {
    assert.deepEqual(result.startup.cachedStableLayout, ['fitBounds']);
    assert.deepEqual(result.startup.cachedChangedHeader, ['fitBounds', 'fitBounds']);
    assert.deepEqual(result.startup.cachedChangedViewport, ['fitBounds', 'fitBounds']);
    assert.deepEqual(result.startup.cachedThenUserMovement, ['fitBounds', 'fitBounds']);
    assert.deepEqual(result.startup.cachedAnimationStillMovingAtLoad, ['fitBounds', 'fitBounds']);
    assert.deepEqual(result.startup.dataAfterMapLoad, ['fitBounds']);
    assert.deepEqual(result.startup.cachedSingleShop, ['flyTo']);
    assert.deepEqual(result.citySwitch.cachedValidShops, ['stop', 'fitBounds']);
    assert.deepEqual(result.citySwitch.noCacheThenRemote, ['stop', 'easeTo', 'fitBounds']);
    assert.deepEqual(result.citySwitch.cachedEmptyCity, ['stop', 'easeTo']);
    assert.equal(JSON.stringify(stable[0].options.padding), JSON.stringify({ top: 190, bottom: 120, left: 35, right: 35 }));
    assert.equal(stable[0].options.maxZoom, 14);
    assert.equal(stable[0].options.duration, 700);
    assert.equal(changed[1].options.padding.top, 221);
    assert.equal(changed[1].options.duration, 0);
    assert.equal(animationInProgress[1].options.duration, 0);
  }
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
