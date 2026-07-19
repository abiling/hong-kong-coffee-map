(() => {
  'use strict';

  const OriginalMap = window.maplibregl?.Map;
  if (!OriginalMap) return;

  class WorldZoomMap extends OriginalMap {
    constructor(options = {}) {
      super({ ...options, minZoom: 0 });
    }
  }

  window.maplibregl.Map = WorldZoomMap;
})();
