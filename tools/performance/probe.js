// Loaded ONLY by serve.py, never by the production app or service worker.
(() => {
  const result = {
    variant: location.pathname.split('/')[1], city: new URLSearchParams(location.search).get('city'),
    instances: 0, create: null, constructorEnd: null, load: null, idle: null,
    calls: {}, requests: [], events: [], errors: [], warnings: [], workerResources: []
  };
  let map;
  const now = () => Math.round(performance.now() * 10) / 10;
  const entry = e => ({ name: e.name, start: e.startTime, duration: e.duration,
    transferSize: e.transferSize, responseStatus: e.responseStatus });
  function publish() {
    const nav = performance.getEntriesByType('navigation')[0];
    const snapshot = { ...result,
      dcl: nav?.domContentLoadedEventEnd || null,
      createToLoad: result.load === null ? null : result.load - result.create,
      createToIdle: result.idle === null ? null : result.idle - result.create,
      dclToLoad: result.load === null || !nav?.domContentLoadedEventEnd ? null : result.load - nav.domContentLoadedEventEnd,
      dclToIdle: result.idle === null || !nav?.domContentLoadedEventEnd ? null : result.idle - nav.domContentLoadedEventEnd,
      viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
      resources: performance.getEntriesByType('resource').map(entry)
    };
    if (window.parent !== window) window.parent.postMessage({ coffeeAudit: snapshot }, location.origin);
  }
  performance.setResourceTimingBufferSize(3000);
  for (const level of ['error', 'warn']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      result[level === 'error' ? 'errors' : 'warnings'].push({ at: now(), text: args.map(String).join(' ') });
      original(...args);
    };
  }
  window.addEventListener('error', event => {
    result.errors.push({ at: now(), text: event.message || 'resource error' }); publish();
  });
  window.addEventListener('unhandledrejection', event => {
    result.errors.push({ at: now(), text: String(event.reason) }); publish();
  });
  const OriginalMap = window.maplibregl?.Map;
  if (!OriginalMap) { result.errors.push({ text: 'MapLibre library unavailable' }); publish(); return; }
  class MeasuredMap extends OriginalMap {
    constructor(options) {
      result.create = now(); result.instances++;
      const transformRequest = options.transformRequest;
      try {
        super({ ...options, collectResourceTiming: true, transformRequest: (url, type) => {
          result.requests.push({ at: now(), url, type });
          return transformRequest ? transformRequest(url, type) : { url };
        } });
      } catch (error) {
        result.errors.push({ at: now(), text: String(error) }); publish(); throw error;
      }
      map = this;
      result.constructorEnd = now();
      this.once('load', () => {
        result.load = now();
        result.requestsAtLoad = result.requests.length;
        result.tilesAtLoad = result.requests.filter(r => r.type === 'Tile').length;
        publish();
      });
      this.on('idle', () => {
        if (result.idle === null) result.idle = now();
        result.events.push({ at: now(), type: 'idle' }); publish();
      });
      this.on('error', event => result.errors.push({ at: now(), text: String(event.error) }));
      this.on('data', event => {
        if (event.resourceTiming) result.workerResources.push(...event.resourceTiming.map(entry));
      });
    }
  }
  for (const method of ['resize', 'fitBounds', 'flyTo', 'easeTo', 'jumpTo', 'setStyle']) {
    MeasuredMap.prototype[method] = function (...args) {
      result.calls[method] = (result.calls[method] || 0) + 1;
      return OriginalMap.prototype[method].apply(this, args);
    };
  }
  window.maplibregl.Map = MeasuredMap;
  const positions = {
    shibuya: [139.7016, 35.658], harajuku: [139.702, 35.6702], omotesando: [139.7126, 35.6653]
  };
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== parent || !event.data.auditAction) return;
    const action = event.data.auditAction;
    result.events.push({ at: now(), type: action });
    if (!map) { publish(); return; }
    if (positions[action]) map.easeTo({ center: positions[action], zoom: 15, duration: 700 });
    if (['Tokyo', 'Hong Kong', 'Beijing'].includes(action)) window.CoffeeMapCities.setActiveCity(action);
    if (action === 'zoom') {
      const start = map.getZoom();
      [2, -1, 3, 0].forEach((offset, i) => setTimeout(() => {
        map.easeTo({ zoom: Math.max(0, Math.min(19, start + offset)), duration: 180 });
      }, i * 120));
    }
    publish();
  });
  setInterval(publish, 1000);
})();
