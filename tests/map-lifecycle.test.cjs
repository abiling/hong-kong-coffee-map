// Dependency-free lifecycle checks. These count application operations; they do
// NOT simulate WebGL, network performance, tile caching, or actual device memory.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const source = process.argv[2]
  ? execFileSync('git', ['show', `${process.argv[2]}:app.js`], { cwd: root, encoding: 'utf8' })
  : fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function extract(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `Missing ${name}`);
  const rest = source.slice(start);
  const end = rest.slice(1).search(/^  (?:async )?function /m);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

async function layout() {
  let bottom = 170, writes = 0, resizes = 0, observer;
  const listeners = {};
  const context = vm.createContext({
    els: { topbar: { getBoundingClientRect: () => ({ bottom }) } },
    map: { resize: () => resizes++ },
    document: {
      documentElement: { style: { setProperty: (name, value) => {
        assert.equal(name, '--content-top');
        assert.equal(value, `${Math.ceil(bottom + 8)}px`);
        writes++;
      } } },
      fonts: { ready: Promise.resolve() }
    },
    window: {
      ResizeObserver: true,
      addEventListener: (event, fn) => { listeners[event] = fn; },
      visualViewport: { addEventListener: (event, fn) => { listeners.visual = fn; } }
    },
    ResizeObserver: class { constructor(fn) { observer = fn; } observe() {} }
  });
  vm.runInContext(extract('trackLayout') + '\ntrackLayout();', context);
  await Promise.resolve();
  observer(); listeners.resize(); listeners.visual();
  const unchanged = { cssWrites: writes, explicitResizes: resizes };
  bottom = 201.25;
  observer();
  assert.ok(writes > unchanged.cssWrites, 'A real header change still updates the layout');
  return unchanged;
}

function markers(dataFirst, count) {
  let created = 0, removed = 0, fitCalls = 0, instances = 0;
  const events = {};
  const markerSet = new Map();
  const shops = Array.from({ length: count }, (_, i) => ({
    id: `fixture-${i}`, name: `Fixture ${i}`, longitude: 139.7 + i * .001, latitude: 35.66
  }));
  const MapClass = class {
    constructor() { instances++; }
    addControl() {}
    on(name, fn) { events[name] = fn; }
  };
  const context = vm.createContext({
    window: { maplibregl: true },
    maplibregl: {
      Map: MapClass, NavigationControl: class {}, AttributionControl: class {},
      Marker: class {
        constructor(options) { created++; this.node = options.element; }
        setLngLat(coords) { this.coords = coords; return this; }
        addTo() { return this; }
        remove() { removed++; }
      }
    },
    map: null, markers: markerSet, filtered: [], selectedId: 'fixture-0',
    DEFAULT_CENTER: [114.1588, 22.2857],
    document: { createElement: () => ({ addEventListener() {} }) },
    installMapContextLayers() {}, fitTo() { fitCalls++; }, selectShop() {}
  });
  vm.runInContext(extract('initMap') + extract('renderMarkers') + '\ninitMap();', context);
  const render = () => { context.filtered = shops; vm.runInContext('renderMarkers();', context); };
  if (dataFirst) render();
  const initialNodes = [...markerSet.values()];
  events.load();
  if (!dataFirst) render();
  assert.equal(instances, 1);
  assert.equal(markerSet.size, count);
  assert.ok(markerSet.get('fixture-0').node.innerHTML.includes(' selected'));
  const atLoad = { created, removed, fitCalls, sameNodes: initialNodes.every((m, i) => m === [...markerSet.values()][i]) };
  // Existing search/city updates must still remove stale markers and render the
  // new result. The performance patch must not disable normal marker updates.
  context.filtered = [shops[0]];
  vm.runInContext('renderMarkers();', context);
  assert.equal(markerSet.size, 1);
  assert.equal([...markerSet.keys()][0], 'fixture-0');
  return atLoad;
}

(async () => {
  const result = {
    kind: 'operation-count regression, not a browser benchmark',
    ref: process.argv[2] || 'working-tree',
    layout: await layout(),
    markersDataFirst: markers(true, 30),
    markersMapFirst: markers(false, 30)
  };
  if (!process.argv[2]) {
    assert.deepEqual(result.layout, { cssWrites: 1, explicitResizes: 0 });
    assert.equal(result.markersDataFirst.created, 30);
    assert.equal(result.markersDataFirst.removed, 0);
    assert.equal(result.markersDataFirst.sameNodes, true);
    assert.equal(result.markersMapFirst.created, 30);
  }
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
