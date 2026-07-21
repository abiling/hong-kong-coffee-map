(() => {
  'use strict';

  [
    './filter-scroll.css?v=17',
    './compact-nav.css?v=17',
    './city-list-fix.css?v=17'
  ].forEach(href => {
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

  if (!document.querySelector('script[data-multicity]')) {
    const openTag = '<scr' + 'ipt src="./multicity.js?v=17" data-multicity="true">';
    const closeTag = '</scr' + 'ipt>';
    document.write(openTag + closeTag);
  }

  window.addEventListener('load', () => {
    if (document.querySelector('script[data-compact-search]')) return;
    const script = document.createElement('script');
    script.src = './compact-search.js?v=17';
    script.dataset.compactSearch = 'true';
    document.body.appendChild(script);
  }, { once: true });
})();