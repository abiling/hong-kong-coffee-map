(() => {
  'use strict';

  ['./filter-scroll.css', './compact-nav.css'].forEach(href => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  });

  const OriginalMap = window.maplibregl?.Map;
  if (OriginalMap) {
    class WorldZoomMap extends OriginalMap {
      constructor(options = {}) {
        super({ ...options, minZoom: 0 });
      }
    }
    window.maplibregl.Map = WorldZoomMap;
  }

  window.addEventListener('load', () => {
    if (document.querySelector('script[data-compact-search]')) return;
    const script = document.createElement('script');
    script.src = './compact-search.js';
    script.dataset.compactSearch = 'true';
    document.body.appendChild(script);
  }, { once: true });
})();
