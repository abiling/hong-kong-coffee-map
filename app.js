(() => {
  'use strict';

  const API_URL = 'https://script.google.com/macros/s/AKfycby0EnuIMDygemCzD522FkMgdYylRcr-UZef_KZUuiboBa5kT73PpDXrdHK8nqoAlsgxVg/exec';
  const ADMIN_KEY_STORAGE = 'hk-coffee-admin-key-v2';
  const CITY_DATA_CACHE_PREFIX = 'coffee-map-city-data-v1:';
  const DEFAULT_CENTER = [114.1588, 22.2857];

  let shops = [], filtered = [], activeRegion = '全部', activeDistrict = '全部', activeView = 'map', selectedId = null;
  let map = null, toastTimer = null;
  const markers = new Map();
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const els = {
    topbar: $('#topbar'), search: $('#searchInput'), clearSearch: $('#clearSearch'), allCount: $('#allCount'),
    resultCount: $('#resultCount'), list: $('#shopList'), districtList: $('#districtList'), detailSheet: $('#detailSheet'),
    districtSheet: $('#districtSheet'), menuSheet: $('#menuSheet'), addDialog: $('#addDialog'), addForm: $('#addForm'),
    toast: $('#toast'), syncIndicator: $('#syncIndicator'), cloudDot: $('#cloudDot'), cloudState: $('#cloudState'),
    cloudMeta: $('#cloudMeta'), adminKeyInput: $('#adminKeyInput'), parseButton: $('#parsePlaceButton'),
    parseState: $('#parseState'), savePlaceButton: $('#savePlaceButton')
  };
  const cloudLoads = new Map();

  window.CoffeeMapData = Object.freeze({
    load: getCloudPayload,
    getCached: readCityCache,
    upsert: upsertCachedShop,
    remove: removeCachedShop,
    invalidate: invalidateCityCache
  });

  trackLayout();
  initMap();
  bindEvents();
  renderAdminKeyState();
  loadCloudShops({ fit: true });

  function trackLayout() {
    const update = () => {
      const bottom = els.topbar?.getBoundingClientRect().bottom || 170;
      document.documentElement.style.setProperty('--content-top', `${Math.ceil(bottom + 8)}px`);
      map?.resize();
    };
    update();
    window.addEventListener('resize', update, { passive: true });
    window.visualViewport?.addEventListener('resize', update, { passive: true });
    if ('ResizeObserver' in window && els.topbar) new ResizeObserver(update).observe(els.topbar);
    document.fonts?.ready.then(update).catch(() => {});
  }

  function createTrainStationIcon() {
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    const roundedRect = (x, y, width, height, radius) => {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + width, y, x + width, y + height, radius);
      ctx.arcTo(x + width, y + height, x, y + height, radius);
      ctx.arcTo(x, y + height, x, y, radius);
      ctx.arcTo(x, y, x + width, y, radius);
      ctx.closePath();
    };

    roundedRect(2.5, 2.5, 43, 43, 10);
    ctx.fillStyle = '#5f605e';
    ctx.fill();
    ctx.strokeStyle = 'rgba(248, 247, 243, 0.98)';
    ctx.lineWidth = 2;
    ctx.stroke();

    roundedRect(14, 8, 20, 27, 5);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    roundedRect(17, 12, 14, 8, 2);
    ctx.fillStyle = '#5f605e';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(19, 30, 1.8, 0, Math.PI * 2);
    ctx.arc(29, 30, 1.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(18, 36);
    ctx.lineTo(14.5, 40);
    ctx.moveTo(30, 36);
    ctx.lineTo(33.5, 40);
    ctx.stroke();

    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  function installMapContextLayers() {
    if (!map || map.getLayer('coffee-map-transit-station-labels')) return;

    try {
      const styleLayers = map.getStyle()?.layers || [];
      const vectorLayer = styleLayers.find(layer => layer['source-layer'] === 'poi')
        || styleLayers.find(layer => layer['source-layer'] === 'transportation');
      const sourceId = vectorLayer?.source || 'openmaptiles';
      if (!map.getSource(sourceId)) return;

      const beforeRoadLabels = map.getLayer('highway_name_other') ? 'highway_name_other' : undefined;
      const beforePlaceLabels = map.getLayer('place_other') ? 'place_other' : undefined;
      const addLayer = (layer, beforeId) => {
        if (!map.getLayer(layer.id)) map.addLayer(layer, beforeId && map.getLayer(beforeId) ? beforeId : undefined);
      };
      const localName = ['coalesce', ['get', 'name:nonlatin'], ['get', 'name'], ['get', 'name:latin'], ['get', 'name_en']];
      const stationFilter = [
        'all',
        ['==', ['geometry-type'], 'Point'],
        ['match', ['get', 'class'], ['rail', 'railway'], true, false],
        ['has', 'name'],
        ['any',
          ['match', ['get', 'subclass'], ['station', 'halt'], true, false],
          ['all',
            ['match', ['get', 'subclass'], ['subway', 'tram_stop'], true, false],
            ['any',
              ['==', ['get', 'agg_stop'], 1],
              ['==', ['get', 'agg_stop'], '1'],
              ['!', ['has', 'agg_stop']]
            ]
          ]
        ]
      ];
      const publicBuildingFilter = [
        'all',
        ['==', ['geometry-type'], 'Point'],
        ['has', 'name'],
        ['any',
          ['match', ['get', 'class'], ['town_hall', 'library', 'college', 'hospital', 'stadium', 'art_gallery', 'castle'], true, false],
          ['match', ['get', 'subclass'], ['university', 'museum', 'courthouse', 'government', 'community_centre', 'arts_centre', 'opera_house', 'concert_hall', 'monument', 'memorial'], true, false]
        ]
      ];

      const stationIconId = 'coffee-map-train-station-icon';
      if (!map.hasImage(stationIconId)) map.addImage(stationIconId, createTrainStationIcon(), { pixelRatio: 2 });

      addLayer({
        id: 'coffee-map-transit-stations',
        type: 'symbol',
        source: sourceId,
        'source-layer': 'poi',
        minzoom: 13,
        filter: stationFilter,
        layout: {
          'icon-image': stationIconId,
          'icon-size': 0.75,
          'icon-padding': 1,
          'icon-allow-overlap': false,
          'icon-ignore-placement': true,
          'symbol-sort-key': ['coalesce', ['get', 'rank'], 999]
        }
      }, beforeRoadLabels);

      addLayer({
        id: 'coffee-map-public-building-labels',
        type: 'symbol',
        source: sourceId,
        'source-layer': 'poi',
        minzoom: 13.5,
        filter: publicBuildingFilter,
        layout: {
          'text-field': localName,
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 13.5, 10, 17, 12],
          'text-max-width': 9,
          'text-padding': 4
        },
        paint: {
          'text-color': '#747169',
          'text-halo-color': 'rgba(255, 255, 255, 0.94)',
          'text-halo-width': 1.2
        }
      }, beforePlaceLabels);

      addLayer({
        id: 'coffee-map-transit-station-labels',
        type: 'symbol',
        source: sourceId,
        'source-layer': 'poi',
        minzoom: 13,
        filter: stationFilter,
        layout: {
          'text-field': localName,
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 14, 11, 17, 12.5],
          'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
          'text-radial-offset': 1.15,
          'text-justify': 'auto',
          'text-max-width': 9,
          'text-padding': 2
        },
        paint: {
          'text-color': '#574a3e',
          'text-halo-color': 'rgba(255, 255, 255, 0.96)',
          'text-halo-width': 1.5
        }
      });
    } catch (error) {
      console.warn('Map context layers could not be installed.', error);
    }
  }

  function initMap() {
    if (!window.maplibregl) {
      $('#map').innerHTML = '<div class="map-error"><strong>地图未能载入</strong><span>请检查网络连接。</span></div>';
      return;
    }
    map = new maplibregl.Map({
      container: 'map', style: 'https://tiles.openfreemap.org/styles/positron', center: DEFAULT_CENTER,
      zoom: 11.25, minZoom: 9, maxZoom: 19, attributionControl: false
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    map.on('load', () => {
      installMapContextLayers();
      renderMarkers();
      if (filtered.length) fitTo(filtered, false);
    });
  }

  function activeCityName() {
    return window.CoffeeMapCities?.activeCity || 'Hong Kong';
  }

  function cityCacheKey(city = activeCityName()) {
    return `${CITY_DATA_CACHE_PREFIX}${city}`;
  }

  function readCityCache(city = activeCityName()) {
    try {
      const cached = JSON.parse(sessionStorage.getItem(cityCacheKey(city)) || 'null');
      if (!cached || cached.city !== city || !Array.isArray(cached.shops)) return null;
      return {
        ok: true,
        shops: cached.shops,
        updated_at: cached.updated_at || cached.cached_at,
        from_cache: true
      };
    } catch (_) {
      sessionStorage.removeItem(cityCacheKey(city));
      return null;
    }
  }

  function writeCityCache(payload, city = activeCityName()) {
    if (!payload || !Array.isArray(payload.shops)) return;
    try {
      sessionStorage.setItem(cityCacheKey(city), JSON.stringify({
        city,
        shops: payload.shops,
        updated_at: payload.updated_at || new Date().toISOString(),
        cached_at: new Date().toISOString()
      }));
    } catch (error) {
      console.warn('City cache write failed:', error);
    }
  }

  function invalidateCityCache(city = activeCityName()) {
    sessionStorage.removeItem(cityCacheKey(city));
  }

  function upsertCachedShop(rawShop) {
    if (!rawShop?.id) return;
    const city = String(rawShop.city || activeCityName());
    const cached = readCityCache(city);
    if (!cached) return;
    const index = cached.shops.findIndex(shop => String(shop.id) === String(rawShop.id));
    if (index >= 0) cached.shops[index] = rawShop;
    else cached.shops.push(rawShop);
    writeCityCache({ shops: cached.shops, updated_at: new Date().toISOString() }, city);
  }

  function removeCachedShop(id, city = activeCityName()) {
    const cached = readCityCache(city);
    if (!cached) return;
    writeCityCache({
      shops: cached.shops.filter(shop => String(shop.id) !== String(id)),
      updated_at: new Date().toISOString()
    }, city);
  }

  async function getCloudPayload({ force = false, city = activeCityName() } = {}) {
    if (!force) {
      const cached = readCityCache(city);
      if (cached) return cached;
    }
    if (cloudLoads.has(city)) return cloudLoads.get(city);
    const request = (async () => {
      const query = new URLSearchParams({ action: 'list', city, _: String(Date.now()) });
      const response = await fetch(`${API_URL}?${query}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok || !Array.isArray(payload.shops)) throw new Error(payload.error || '云端数据格式不正确');
      writeCityCache(payload, city);
      return { ...payload, from_cache: false };
    })();
    cloudLoads.set(city, request);
    try {
      return await request;
    } finally {
      if (cloudLoads.get(city) === request) cloudLoads.delete(city);
    }
  }

  async function loadCloudShops({ fit = false, quiet = false, force = false, city = activeCityName() } = {}) {
    const hasCachedCity = !force && Boolean(readCityCache(city));
    if (!hasCachedCity) {
      setCloudState('syncing', '正在同步', '正在读取 Google Sheets');
      if (!quiet) els.list.innerHTML = '<div class="empty-state">正在从云端加载…</div>';
    }
    try {
      const payload = await getCloudPayload({ force, city });
      if (activeCityName() !== city) return;
      shops = payload.shops.map(normalizeShop).filter(s => s.active && s.id && Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
      const meta = payload.from_cache
        ? `${shops.length} 家 · 本次会话缓存`
        : `${shops.length} 家 · ${formatSyncTime(payload.updated_at)}`;
      setCloudState('online', '云端已同步', meta);
      renderDistricts();
      applyFilters({ fit });
    } catch (error) {
      if (activeCityName() !== city) return;
      console.error(error);
      setCloudState('error', '云端连接失败', '请检查网络后重试');
      const allCount = $('#allCount');
      if (allCount) allCount.textContent = '—';
      els.resultCount.textContent = '—';
      els.list.innerHTML = '<div class="empty-state"><strong>无法读取云端数据</strong><br>请稍后重新同步。</div>';
      showToast('云端数据读取失败');
    }
  }

  function normalizeShop(raw) {
    return {
      id: String(raw.id || ''), name: String(raw.name || ''), address: String(raw.address || ''),
      city: String(raw.city || window.CoffeeMapCities?.activeCity || 'Hong Kong'), country: String(raw.country || ''),
      region: String(raw.region || '待确认'), district: String(raw.district || '待确认'),
      latitude: Number(raw.latitude), longitude: Number(raw.longitude), googleMaps: String(raw.google_maps || ''),
      appleMaps: String(raw.apple_maps || ''), category: String(raw.category || ''),
      source: String(raw.source || ''), notes: String(raw.notes || ''), active: raw.active !== false,
      favorite: toBoolean(raw.favorite)
    };
  }

  async function apiPost(action, data) {
    const adminKey = ensureAdminKey();
    if (!adminKey) throw new Error('已取消管理员操作');
    const response = await fetch(API_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, adminKey, data }), redirect: 'follow'
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      const message = String(payload.error || '云端操作失败');
      if (/unauthorized/i.test(message)) { localStorage.removeItem(ADMIN_KEY_STORAGE); renderAdminKeyState(); }
      throw new Error(/unauthorized/i.test(message) ? '管理员密钥无效，已从本机清除' : message);
    }
    return payload;
  }

  function ensureAdminKey() {
    let key = localStorage.getItem(ADMIN_KEY_STORAGE) || '';
    if (!key) {
      key = window.prompt('请输入 Apps Script 执行日志中的 ADMIN_KEY。密钥只保存在这台设备。')?.trim() || '';
      if (key) { localStorage.setItem(ADMIN_KEY_STORAGE, key); renderAdminKeyState(); }
    }
    return key;
  }

  function renderMarkers() {
    if (!map) return;
    markers.forEach(marker => marker.remove()); markers.clear();
    filtered.forEach(shop => {
      const node = document.createElement('button');
      node.className = 'marker-hit'; node.type = 'button'; node.title = shop.name;
      node.innerHTML = `<span class="coffee-marker${selectedId === shop.id ? ' selected' : ''}"></span>`;
      node.addEventListener('click', e => { e.stopPropagation(); selectShop(shop.id, true); });
      markers.set(shop.id, new maplibregl.Marker({ element: node, anchor: 'bottom' }).setLngLat([shop.longitude, shop.latitude]).addTo(map));
    });
  }

  function renderList() {
    const allCount = $('#allCount');
    if (allCount) allCount.textContent = shops.length;
    els.resultCount.textContent = filtered.length;
    if (!filtered.length) { els.list.innerHTML = `<div class="empty-state">${activeView === 'saved' ? '还没有收藏咖啡店' : '没有符合当前条件的咖啡店'}</div>`; return; }
    els.list.innerHTML = filtered.map(s => `<button class="shop-card" data-shop-id="${escapeHtml(s.id)}"><h3>${escapeHtml(s.name)}</h3><p><span class="area">${escapeHtml(s.district)}</span>${escapeHtml(s.address)}</p></button>`).join('');
    els.list.querySelectorAll('[data-shop-id]').forEach(card => card.addEventListener('click', () => selectShop(card.dataset.shopId, true)));
  }

  function applyFilters({ fit = false } = {}) {
    const q = normalize(els.search.value);
    filtered = shops.filter(s => {
      const regionOK = activeRegion === '全部' || s.region === activeRegion;
      const districtOK = activeDistrict === '全部' || s.district === activeDistrict;
      const searchOK = !q || [s.name, s.address, s.region, s.district, s.category, s.notes].some(v => normalize(v).includes(q));
      const savedOK = activeView !== 'saved' || s.favorite;
      return regionOK && districtOK && searchOK && savedOK;
    });
    renderList(); if (map) renderMarkers(); if (fit) fitTo(filtered, true);
  }

  function fitTo(items, animate = true) {
    if (!map || !items.length) return;
    if (items.length === 1) return map.flyTo({ center: [items[0].longitude, items[0].latitude], zoom: 15.5, essential: true });
    const bounds = new maplibregl.LngLatBounds(); items.forEach(s => bounds.extend([s.longitude, s.latitude]));
    map.fitBounds(bounds, { padding: { top: Math.max(190, (els.topbar?.getBoundingClientRect().bottom || 170) + 20), bottom: 120, left: 35, right: 35 }, maxZoom: 14, duration: animate ? 700 : 0 });
  }

  function selectShop(id, moveMap) {
    const shop = shops.find(s => s.id === id); if (!shop) return;
    selectedId = id;
    if (moveMap && map) map.flyTo({ center: [shop.longitude, shop.latitude], zoom: 15.6, offset: [0, -90], essential: true });
    markers.forEach((m, key) => m.getElement().querySelector('.coffee-marker')?.classList.toggle('selected', key === id));
    $('#detailRegion').textContent = shop.region; $('#detailDistrict').textContent = shop.district;
    $('#detailName').textContent = shop.name; $('#detailAddress').textContent = shop.address;
    $('#detailNotes').textContent = shop.notes || ''; $('#detailNotes').classList.toggle('visible', Boolean(shop.notes));
    const provider = window.CoffeeMapCities?.getMapProvider(shop.city) || 'google';
    const mapUrl = provider === 'apple' ? shop.appleMaps : shop.googleMaps;
    const validMapUrl = window.CoffeeMapCities?.validateMapUrl(provider, mapUrl) ?? Boolean(mapUrl);
    setMapAction($('#googleMapsButton'), provider === 'google' && validMapUrl, shop.googleMaps);
    setMapAction($('#appleMapsButton'), provider === 'apple' && validMapUrl, shop.appleMaps);
    renderFavoriteAction(shop);
    openSheet(els.detailSheet);
  }

  function renderDistricts() {
    const counts = shops.reduce((a, s) => (a[s.district] = (a[s.district] || 0) + 1, a), {});
    const districts = Object.keys(counts).sort((a, b) => a.localeCompare(b, 'zh-Hans'));
    els.districtList.innerHTML = `<button class="district-option ${activeDistrict === '全部' ? 'active' : ''}" data-district="全部">全部地区</button>` + districts.map(d => `<button class="district-option ${activeDistrict === d ? 'active' : ''}" data-district="${escapeHtml(d)}">${escapeHtml(d)} · ${counts[d]}</button>`).join('');
    els.districtList.querySelectorAll('[data-district]').forEach(b => b.addEventListener('click', () => {
      activeDistrict = b.dataset.district;
      $('#districtButton').classList.toggle('active', activeDistrict !== '全部');
      $('#districtButton').firstChild.textContent = activeDistrict === '全部' ? '具体地区 ' : `${activeDistrict} `;
      closeSheet(els.districtSheet); applyFilters({ fit: true }); renderDistricts();
    }));
  }

  function bindEvents() {
    $('#regionFilters').addEventListener('click', event => {
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (!button || !event.currentTarget.contains(button)) return;
      if (button.id === 'districtButton') {
        renderDistricts();
        openSheet(els.districtSheet);
        return;
      }
      if (!button.matches('[data-region]')) return;
      activeRegion = button.dataset.region;
      event.currentTarget.querySelectorAll('[data-region]').forEach(item => {
        item.classList.toggle('active', item === button);
      });
      applyFilters({ fit: true });
    });
    window.addEventListener('coffee-map:city-change', switchCityView);
    window.addEventListener('coffee-map:shop-updated', event => applyShopUpdate(event.detail?.shop, event.detail?.previousCity));
    window.addEventListener('coffee-map:shop-removed', event => removeShopFromView(event.detail?.id, event.detail?.city));
    els.search.addEventListener('input', () => { els.clearSearch.classList.toggle('visible', Boolean(els.search.value)); applyFilters(); });
    els.clearSearch.addEventListener('click', () => { els.search.value = ''; els.clearSearch.classList.remove('visible'); applyFilters({ fit: true }); });
    $('#fitButton').addEventListener('click', () => fitTo(filtered, true));
    $$('.nav-item').forEach(b => b.addEventListener('click', () => {
      activeView = b.dataset.view; $$('.nav-item').forEach(x => x.classList.toggle('active', x === b));
      document.body.classList.toggle('list-view', activeView === 'list');
      document.body.classList.toggle('saved-view', activeView === 'saved');
      applyFilters(); setTimeout(() => map?.resize(), 80);
    }));
    $('#locateButton').addEventListener('click', () => navigator.geolocation?.getCurrentPosition(p => map?.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 14.5 }), () => showToast('无法取得当前位置'), { enableHighAccuracy: true, timeout: 8000 }));
    $('#addButton').addEventListener('click', () => { resetAddForm(); els.addDialog.showModal(); });
    $('#closeAddDialog').addEventListener('click', () => els.addDialog.close());
    els.parseButton.addEventListener('click', parsePlaceLink);
    ['google_maps', 'apple_maps'].forEach(field => els.addForm.elements[field]?.addEventListener('input', markPlaceLinkChanged));
    els.addForm.addEventListener('submit', saveNewShop);
    $('#useMapCenter').addEventListener('click', () => { if (!map) return; const c = map.getCenter(); els.addForm.elements.latitude.value = c.lat.toFixed(7); els.addForm.elements.longitude.value = c.lng.toFixed(7); });
    $('#favoriteButton').addEventListener('click', toggleFavorite);
    $('#menuButton').addEventListener('click', () => { renderAdminKeyState(); openSheet(els.menuSheet); });
    $$('[data-close-sheet]').forEach(x => x.addEventListener('click', () => closeSheet(els.detailSheet)));
    $$('[data-close-district]').forEach(x => x.addEventListener('click', () => closeSheet(els.districtSheet)));
    $$('[data-close-menu]').forEach(x => x.addEventListener('click', () => closeSheet(els.menuSheet)));
    $('#saveAdminKeyButton').addEventListener('click', () => { const v = els.adminKeyInput.value.trim(); if (!v) return showToast('请输入管理员密钥'); localStorage.setItem(ADMIN_KEY_STORAGE, v); renderAdminKeyState(); showToast('密钥已保存在本机'); });
    $('#clearAdminKeyButton').addEventListener('click', () => { localStorage.removeItem(ADMIN_KEY_STORAGE); renderAdminKeyState(); showToast('本机密钥已清除'); });
    $('#refreshButton').addEventListener('click', async () => { await loadCloudShops({ quiet: true, force: true }); closeSheet(els.menuSheet); });
    $('#exportJsonButton').addEventListener('click', () => download('coffee-shops.json', JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), shops }, null, 2), 'application/json'));
    $('#exportCsvButton').addEventListener('click', exportCsv);
  }

  async function switchCityView(event) {
    const city = event.detail?.city || activeCityName();
    const config = event.detail?.config || window.CoffeeMapCities?.cities?.[city];
    activeRegion = '全部';
    activeDistrict = '全部';
    selectedId = null;
    els.search.value = '';
    els.clearSearch.classList.remove('visible');
    closeSheet(els.detailSheet);
    closeSheet(els.districtSheet);

    if (map && config) {
      map.stop();
      map.easeTo({ center: config.center, zoom: config.zoom, duration: 420, essential: true });
    }

    if (!readCityCache(city)) {
      shops = [];
      filtered = [];
      renderDistricts();
      applyFilters();
    }
    await loadCloudShops({ fit: true, city });
  }

  function applyShopUpdate(rawShop, previousCity) {
    if (!rawShop?.id) return;
    const currentCity = activeCityName();
    const updated = normalizeShop(rawShop);
    const index = shops.findIndex(shop => shop.id === updated.id);
    if (updated.city !== currentCity) {
      if (index >= 0) shops.splice(index, 1);
    } else if (index >= 0) {
      shops[index] = updated;
    } else {
      shops.push(updated);
    }
    if (!previousCity || previousCity === currentCity || updated.city === currentCity) {
      renderDistricts();
      applyFilters();
    }
  }

  function removeShopFromView(id, city = activeCityName()) {
    if (!id || city !== activeCityName()) return;
    const index = shops.findIndex(shop => shop.id === String(id));
    if (index >= 0) shops.splice(index, 1);
    if (selectedId === String(id)) {
      selectedId = null;
      closeSheet(els.detailSheet);
    }
    renderDistricts();
    applyFilters();
  }

  async function parsePlaceLink() {
    const city = els.addForm.elements.city?.value || window.CoffeeMapCities?.activeCity || 'Hong Kong';
    const field = window.CoffeeMapCities?.getMapField(city) || 'google_maps';
    const provider = field === 'apple_maps' ? 'Apple Maps' : 'Google Maps';
    const url = els.addForm.elements[field]?.value.trim();
    if (!url) return showToast(`请先粘贴 ${provider} 链接`);
    if (window.CoffeeMapCities && !window.CoffeeMapCities.validateMapUrl(field === 'apple_maps' ? 'apple' : 'google', url)) return showToast(`这不是有效的 ${provider} 商户链接`);
    els.parseButton.disabled = true; els.parseButton.textContent = '解析中…'; els.parseState.textContent = '正在解析地点…';
    try {
      const { place } = await apiPost('parse', { city, [field]: url });
      ['google_maps','apple_maps','name','address','region','district','latitude','longitude','category','source','notes','city','country'].forEach(f => { if (place?.[f] !== undefined && els.addForm.elements[f]) els.addForm.elements[f].value = place[f] ?? ''; });
      window.CoffeeMapCities?.syncForm(els.addForm, place?.city || city);
      els.parseState.textContent = '解析完成，请确认并按需修改'; els.parseState.className = 'success';
    } catch (error) { els.parseState.textContent = error.message; els.parseState.className = 'error'; showToast(error.message); }
    finally { els.parseButton.disabled = false; els.parseButton.textContent = '解析地点'; }
  }

  async function saveNewShop(event) {
    event.preventDefault(); const fd = new FormData(els.addForm);
    const data = Object.fromEntries([...fd.entries()].map(([k,v]) => [k, String(v).trim()]));
    data.latitude = Number(data.latitude); data.longitude = Number(data.longitude); data.active = true;
    data.status = '想去'; // Keep the existing Sheet schema compatible; status is no longer a user-facing feature.
    data.favorite = false;
    const mapRule = window.CoffeeMapCities?.applyMapProviderRule(data, data.city) || { requiredField: 'google_maps' };
    if (!data[mapRule.requiredField] || mapRule.valid === false || !data.name || !data.address || !data.region || !data.district || !Number.isFinite(data.latitude) || !Number.isFinite(data.longitude)) return showToast('请先解析并确认所有必填信息');
    els.savePlaceButton.disabled = true; els.savePlaceButton.textContent = '正在保存…';
    try {
      const { shop } = await apiPost('add', data); const added = normalizeShop(shop); shops.push(added);
      window.CoffeeMapData.upsert(shop);
      renderDistricts(); applyFilters(); els.addDialog.close(); selectShop(added.id, true); setCloudState('online', '云端已同步', `${shops.length} 家 · 刚刚更新`); showToast('已保存到云端');
    } catch (error) { showToast(error.message); }
    finally { els.savePlaceButton.disabled = false; els.savePlaceButton.textContent = '保存到云端'; }
  }

  async function toggleFavorite() {
    const current = shops.find(shop => shop.id === selectedId);
    if (!current) return;
    const button = $('#favoriteButton');
    button.disabled = true;
    try {
      const { shop } = await apiPost('setFavorite', { id: current.id, favorite: !current.favorite });
      const updated = normalizeShop(shop);
      const index = shops.findIndex(item => item.id === updated.id);
      if (index >= 0) shops[index] = updated;
      window.CoffeeMapData.upsert(shop);
      renderFavoriteAction(updated);
      applyFilters();
      if (activeView === 'saved' && !updated.favorite) closeSheet(els.detailSheet);
      setCloudState('online', '云端已同步', `${shops.length} 家 · 刚刚更新`);
      showToast(updated.favorite ? '已加入收藏' : '已取消收藏');
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  }

  function renderFavoriteAction(shop) {
    const button = $('#favoriteButton');
    if (!button) return;
    button.classList.toggle('active', shop.favorite);
    button.setAttribute('aria-pressed', String(shop.favorite));
    button.querySelector('use')?.setAttribute('href', shop.favorite ? '#ms-bookmark-filled' : '#ms-bookmark');
    $('#favoriteButtonLabel').textContent = shop.favorite ? '取消收藏' : '收藏';
  }

  function renderAdminKeyState() {
    const has = Boolean(localStorage.getItem(ADMIN_KEY_STORAGE)); els.adminKeyInput.value = ''; els.adminKeyInput.placeholder = has ? '已保存在本机' : '未设置'; $('#clearAdminKeyButton').disabled = !has;
  }
  function resetAddForm() {
    els.addForm.reset();
    els.parseState.className = '';
    window.CoffeeMapCities?.syncForm(els.addForm, window.CoffeeMapCities.activeCity);
    const provider = els.addForm.dataset.mapProvider === 'apple' ? 'Apple Maps' : 'Google Maps';
    els.parseState.textContent = `粘贴具体 ${provider} 商户链接后解析`;
  }
  function setCloudState(state, title, meta) { els.syncIndicator.className = `sync-indicator ${state}`; els.syncIndicator.textContent = state === 'online' ? '已同步' : state === 'error' ? '离线' : '正在同步'; els.cloudDot.className = `cloud-dot ${state}`; els.cloudState.textContent = title; els.cloudMeta.textContent = meta; }
  function formatSyncTime(v) { const d = new Date(v); return Number.isNaN(d.getTime()) ? '已更新' : `更新于 ${new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}).format(d)}`; }
  function exportCsv() { const h = ['Name','City','Country','District','Region','Address','Latitude','Longitude','Favorite','Category','Google Maps','Apple Maps','Source','Notes']; const r = shops.map(s => [s.name,s.city,s.country,s.district,s.region,s.address,s.latitude,s.longitude,s.favorite,s.category,s.googleMaps,s.appleMaps,s.source,s.notes]); download('coffee-shops.csv', '\ufeff' + [h,...r].map(x => x.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8'); }
  function csvCell(v) { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; }
  function download(name, content, type) { const blob = new Blob([content], { type }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  function openSheet(el) { el.classList.add('open'); el.setAttribute('aria-hidden','false'); }
  function closeSheet(el) { el.classList.remove('open'); el.setAttribute('aria-hidden','true'); }
  function markPlaceLinkChanged() { els.parseState.textContent = '链接已更改，请重新解析'; els.parseState.className = ''; }
  function setMapAction(button, shouldShow, href) {
    if (!button) return;
    const visible = Boolean(shouldShow && href);
    button.hidden = !visible;
    button.setAttribute('aria-hidden', String(!visible));
    if (visible) button.href = href;
    else button.removeAttribute('href');
  }
  function normalize(v) { return String(v || '').trim().toLowerCase(); }
  function toBoolean(v) { return v === true || v === 1 || String(v || '').trim().toLowerCase() === 'true'; }
  function escapeHtml(v) { return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function showToast(text) { clearTimeout(toastTimer); els.toast.textContent = text; els.toast.classList.add('show'); toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600); }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js?v=22').catch(() => {});
})();
