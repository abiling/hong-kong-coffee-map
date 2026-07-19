(() => {
  'use strict';

  const filterStyles = document.createElement('link');
  filterStyles.rel = 'stylesheet';
  filterStyles.href = './filter-scroll.css';
  document.head.appendChild(filterStyles);

  const OriginalMap = window.maplibregl?.Map;
  if (!OriginalMap) return;

  class WorldZoomMap extends OriginalMap {
    constructor(options = {}) {
      super({ ...options, minZoom: 0 });
    }
  }

  window.maplibregl.Map = WorldZoomMap;
})();
