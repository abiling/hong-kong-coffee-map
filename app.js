(() => {
  'use strict';

  const API_URL = 'https://script.google.com/macros/s/AKfycby0EnuIMDygemCzD522FkMgdYylRcr-UZef_KZUuiboBa5kT73PpDXrdHK8nqoAlsgxVg/exec';
  const ADMIN_KEY_STORAGE = 'hk-coffee-admin-key-v2';
  const Catalog = window.CoffeeMapLocationCatalog;
  const { ALL_DATA_CACHE_KEY } = Catalog;
  const CLOUD_CACHE_TTL_MS = 15 * 60 * 1000;
  const DEFAULT_CENTER = [114.1588, 22.2857];

  let shops = [], filtered = [], activeRegion = '全部', activeDistrict = '全部', activeView = 'map', selectedId = null;
  let map = null, toastTimer = null, userLocationMarker = null, lastDataFitKey = '';
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
  let allDataCache, cloudLoad = null;
  let parsedAddPlace = null, parseRevision = 0;

  window.CoffeeMapData = Object.freeze({
    load: getCloudPayload,
    getCached: readCityCache,
    upsert: upsertCachedShop,
    remove: removeCachedShop,
    invalidate: invalidateCityCache
  });

  try { localStorage.removeItem('coffee-map-all-data-v3'); } catch (_) {}
  trackLayout();
  initMap();
  bindEvents();
  renderAdminKeyState();
  loadCloudShops({ fit: true });

  function trackLayout() {
    let lastContentTop;
    const update = () => {
      const bottom = els.topbar?.getBoundingClientRect().bottom || 170;
      const contentTop = `${Math.ceil(bottom + 8)}px`;
      if (contentTop !== lastContentTop) {
        document.documentElement.style.setProperty('--content-top', contentTop);
        lastContentTop = contentTop;
      }
      // MapLibre 5.12 observes its own container (trackResize defaults to true).
      // Header/font changes only move overlays; they do not resize #map.
    };
    update();
    window.addEventListener('resize', update, { passive: true });
    window.visualViewport?.addEventListener('resize', update, { passive: true });
    if ('ResizeObserver' in window && els.topbar) new ResizeObserver(update).observe(els.topbar);
    document.fonts?.ready.then(update).catch(() => {});
  }

  function installMapContextLayers() {
    if (!map || map.getLayer('coffee-map-public-building-labels')) return;

    try {
      const styleLayers = map.getStyle()?.layers || [];
      const vectorLayer = styleLayers.find(layer => layer['source-layer'] === 'poi')
        || styleLayers.find(layer => layer['source-layer'] === 'transportation');
      const sourceId = vectorLayer?.source || 'openmaptiles';
      if (!map.getSource(sourceId)) return;

      const beforePlaceLabels = map.getLayer('place_other') ? 'place_other' : undefined;
      const publicBuildingFilter = [
        'all',
        ['==', ['geometry-type'], 'Point'],
        ['has', 'name'],
        ['any',
          ['match', ['get', 'class'], ['town_hall', 'library', 'college', 'hospital', 'stadium', 'art_gallery', 'castle'], true, false],
          ['match', ['get', 'subclass'], ['university', 'museum', 'courthouse', 'government', 'community_centre', 'arts_centre', 'opera_house', 'concert_hall', 'monument', 'memorial'], true, false]
        ]
      ];
      const localName = ['coalesce', ['get', 'name:nonlatin'], ['get', 'name'], ['get', 'name:latin'], ['get', 'name_en']];

      map.addLayer({
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
      }, beforePlaceLabels && map.getLayer(beforePlaceLabels) ? beforePlaceLabels : undefined);
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
    map.on('movestart', event => {
      if (event.originalEvent) lastDataFitKey = '';
    });
    map.on('load', () => {
      installMapContextLayers();
      // applyFilters renders DOM markers as soon as shop data arrives, including
      // before style load. Rebuilding them here only discards identical nodes.
      // Keep the load-time correction only when bounds or header padding changed.
      // Otherwise an earlier cached-data fit is already the final viewport.
      if (filtered.length) fitTo(filtered, false, { skipIfSame: true });
    });
  }

  function activeCityName() {
    return window.CoffeeMapCities?.activeCity || '';
  }

  function activeCountryCode() {
    return window.CoffeeMapCities?.activeCountryCode || '';
  }

  function countryCodeForCity(city = activeCityName()) {
    return window.CoffeeMapCities?.getCity(city, activeCountryCode())?.countryCode || activeCountryCode();
  }

  function showUserLocation(position) {
    if (!map || !window.maplibregl) return;
    const coordinates = [position.coords.longitude, position.coords.latitude];
    if (!userLocationMarker) {
      const node = document.createElement('div');
      node.className = 'user-location-marker';
      node.setAttribute('aria-label', '当前位置');
      node.innerHTML = '<span class="user-location-dot"></span>';
      userLocationMarker = new maplibregl.Marker({ element: node, anchor: 'center' }).setLngLat(coordinates).addTo(map);
    } else {
      userLocationMarker.setLngLat(coordinates);
    }
    $('#locateButton')?.classList.add('active');
    lastDataFitKey = '';
    map.flyTo({ center: coordinates, zoom: Math.max(map.getZoom(), 14.5), essential: true });
  }

  function locateUser() {
    const button = $('#locateButton');
    if (!navigator.geolocation) return showToast('当前浏览器不支持定位');
    button.disabled = true;
    button.classList.add('locating');
    navigator.geolocation.getCurrentPosition(position => {
      showUserLocation(position);
      button.disabled = false;
      button.classList.remove('locating');
    }, () => {
      button.disabled = false;
      button.classList.remove('locating');
      showToast('无法取得当前位置');
    }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 });
  }

  function readAllDataCache() {
    if (allDataCache !== undefined) return allDataCache;
    try {
      const cached = JSON.parse(localStorage.getItem(ALL_DATA_CACHE_KEY) || 'null');
      if (Array.isArray(cached?.shops)) return allDataCache = { ...cached, ok: true, from_cache: true };
    } catch (_) {}
    return allDataCache = null;
  }

  function writeAllDataCache(payload, cachedAt = new Date().toISOString()) {
    const snapshot = {
      shops: payload.shops,
      updated_at: payload.updated_at || new Date().toISOString(),
      cached_at: cachedAt
    };
    allDataCache = { ...snapshot, ok: true, from_cache: true };
    try {
      localStorage.setItem(ALL_DATA_CACHE_KEY, JSON.stringify(snapshot));
    } catch (error) {
      console.warn('Persistent cloud cache write failed:', error);
    }
    window.CoffeeMapCities?.updateCatalog(payload.shops);
    window.dispatchEvent(new CustomEvent('coffee-map:data-updated'));
  }

  function cityPayloadFromAll(payload, city = activeCityName(), countryCode = countryCodeForCity(city)) {
    if (!payload || !Array.isArray(payload.shops)) return null;
    const cityShops = window.CoffeeMapLocationCatalog?.shopsForLocation(payload.shops, countryCode, city)
      || payload.shops.filter(shop => String(shop.city || '').trim() === city
        && String(shop.country_code || '').trim().toUpperCase() === String(countryCode || '').trim().toUpperCase());
    return {
      ok: true,
      shops: cityShops,
      updated_at: payload.updated_at || payload.cached_at,
      cached_at: payload.cached_at,
      from_cache: payload.from_cache !== false
    };
  }

  function readCityCache(city = activeCityName(), countryCode = countryCodeForCity(city)) {
    return cityPayloadFromAll(readAllDataCache(), city, countryCode);
  }

  function isCacheStale(payload) {
    const cachedAt = Date.parse(payload?.cached_at || '');
    return !Number.isFinite(cachedAt) || Date.now() - cachedAt >= CLOUD_CACHE_TTL_MS;
  }

  function invalidateCityCache() {
    allDataCache = null;
    localStorage.removeItem(ALL_DATA_CACHE_KEY);
  }

  function upsertCachedShop(rawShop) {
    if (!rawShop?.id) return;
    changeCachedShop(rawShop.id, rawShop);
  }

  function removeCachedShop(id) {
    changeCachedShop(id, null);
  }

  function changeCachedShop(id, shop) {
    id = String(id);
    cloudLoad?.changes.set(id, shop);
    const cached = readAllDataCache();
    if (!cached && !shop) return;
    const nextShops = [...(cached?.shops || [])];
    applyShopChange(nextShops, shop, id);
    writeAllDataCache({ shops: nextShops }, cached?.cached_at ?? null);
  }

  function applyShopChange(records, shop, id) {
    const index = records.findIndex(record => String(record?.id) === id);
    if (index < 0 && shop) records.push(shop);
    else if (index >= 0 && shop) records[index] = shop;
    else if (index >= 0) records.splice(index, 1);
  }

  async function fetchAllCloudPayload() {
    if (cloudLoad) return cloudLoad.promise;
    const changes = new Map();
    const promise = (async () => {
      const query = new URLSearchParams({ action: 'list', _: String(Date.now()) });
      const response = await fetch(`${API_URL}?${query}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok || !Array.isArray(payload.shops)) throw new Error(payload.error || '云端数据格式不正确');
      changes.forEach((shop, id) => applyShopChange(payload.shops, shop, id));
      const cachedAt = new Date().toISOString();
      writeAllDataCache(payload, cachedAt);
      return { ...payload, cached_at: cachedAt, from_cache: false };
    })();
    cloudLoad = { promise, changes };
    try {
      return await promise;
    } finally {
      cloudLoad = null;
    }
  }

  async function getCloudPayload({ force = false, city = activeCityName(), countryCode = countryCodeForCity(city) } = {}) {
    const cached = readAllDataCache();
    if (!force && cached) return cityPayloadFromAll(cached, city, countryCode);
    return cityPayloadFromAll(await fetchAllCloudPayload(), city, countryCode);
  }

  function applyCloudPayload(payload, { fit = false } = {}) {
    shops = payload.shops.map(normalizeShop)
      .filter(shop => shop.active && shop.id && Number.isFinite(shop.latitude) && Number.isFinite(shop.longitude));
    const meta = payload.from_cache
      ? `${shops.length} 家 · 本地缓存`
      : `${shops.length} 家 · ${formatSyncTime(payload.updated_at)}`;
    setCloudState('online', '云端已同步', meta);
    window.CoffeeMapCities?.renderRegionRail(shops, activeRegion);
    renderDistricts();
    applyFilters({ fit });
  }

  function refreshAllInBackground(city, countryCode) {
    fetchAllCloudPayload().then(payload => {
      if (activeCityName() !== city || activeCountryCode() !== countryCode) return;
      const cityPayload = cityPayloadFromAll(payload, city, countryCode);
      if (cityPayload) applyCloudPayload(cityPayload);
    }).catch(error => {
      console.warn('Background cloud refresh failed:', error);
      if (activeCityName() === city && activeCountryCode() === countryCode) setCloudState('online', '使用本地缓存', `${shops.length} 家 · 云端更新稍后重试`);
    });
  }

  async function loadCloudShops({ fit = false, quiet = false, force = false, city = activeCityName(), countryCode = countryCodeForCity(city) } = {}) {
    const allCache = !force ? readAllDataCache() : null;
    const cachedCity = allCache ? cityPayloadFromAll(allCache, city, countryCode) : null;
    if (cachedCity) {
      if (activeCityName() === city && activeCountryCode() === countryCode) applyCloudPayload(cachedCity, { fit });
      if (isCacheStale(allCache)) refreshAllInBackground(city, countryCode);
      return cachedCity;
    }

    setCloudState('syncing', '正在同步', '正在读取 Google Sheets');
    if (!quiet) els.list.innerHTML = '<div class="empty-state">正在从云端加载…</div>';
    try {
      const payload = await getCloudPayload({ force: true, city, countryCode });
      if (activeCityName() !== city || activeCountryCode() !== countryCode) return payload;
      applyCloudPayload(payload, { fit });
      return payload;
    } catch (error) {
      if (activeCityName() !== city || activeCountryCode() !== countryCode) return null;
      console.error(error);
      setCloudState('error', '云端连接失败', '请检查网络后重试');
      const allCount = $('#allCount');
      if (allCount) allCount.textContent = '—';
      els.resultCount.textContent = '—';
      els.list.innerHTML = '<div class="empty-state"><strong>无法读取云端数据</strong><br>请稍后重新同步。</div>';
      showToast('云端数据读取失败');
      return null;
    }
  }

  function normalizeShop(raw) {
    const location = window.CoffeeMapCities?.normalizeLocationFields(raw) || raw;
    const validCoordinates = Catalog.hasCoordinates(raw);
    return {
      id: String(raw.id || ''), name: String(raw.name || ''), address: String(raw.address || ''),
      city: String(location.city || ''), country: String(location.country || ''),
      country_code: String(location.country_code || ''),
      region: String(raw.region || ''), district: String(raw.district || ''),
      latitude: validCoordinates ? Number(raw.latitude) : NaN,
      longitude: validCoordinates ? Number(raw.longitude) : NaN, googleMaps: String(raw.google_maps || ''),
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

  function fitTo(items, animate = true, { skipIfSame = false } = {}) {
    if (!map || !items.length) return;
    if (items.length === 1) {
      const fitKey = `point:${items[0].longitude},${items[0].latitude}:15.5`;
      if (skipIfSame && fitKey === lastDataFitKey && !map.isMoving()) return;
      lastDataFitKey = fitKey;
      return map.flyTo({ center: [items[0].longitude, items[0].latitude], zoom: 15.5, essential: true });
    }
    const bounds = new maplibregl.LngLatBounds(); items.forEach(s => bounds.extend([s.longitude, s.latitude]));
    const padding = { top: Math.max(190, (els.topbar?.getBoundingClientRect().bottom || 170) + 20), bottom: 120, left: 35, right: 35 };
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const container = map.getContainer();
    const fitKey = `bounds:${sw.lng},${sw.lat}:${ne.lng},${ne.lat}:${padding.top},${padding.bottom},${padding.left},${padding.right}:14:${container.clientWidth}x${container.clientHeight}`;
    if (skipIfSame && fitKey === lastDataFitKey && !map.isMoving()) return;
    lastDataFitKey = fitKey;
    map.fitBounds(bounds, { padding, maxZoom: 14, duration: animate ? 700 : 0 });
  }

  function selectShop(id, moveMap) {
    const shop = shops.find(s => s.id === id); if (!shop) return;
    selectedId = id;
    if (moveMap && map) {
      lastDataFitKey = '';
      map.flyTo({ center: [shop.longitude, shop.latitude], zoom: 15.6, offset: [0, -90], essential: true });
    }
    markers.forEach((m, key) => m.getElement().querySelector('.coffee-marker')?.classList.toggle('selected', key === id));
    $('#detailRegion').textContent = shop.region; $('#detailDistrict').textContent = shop.district;
    $('#detailName').textContent = shop.name; $('#detailAddress').textContent = shop.address;
    $('#detailNotes').textContent = shop.notes || ''; $('#detailNotes').classList.toggle('visible', Boolean(shop.notes));
    const provider = window.CoffeeMapCities?.getMapProvider(shop) || 'google';
    const mapUrl = provider === 'apple' ? shop.appleMaps : shop.googleMaps;
    const validMapUrl = window.CoffeeMapCities?.validateMapUrl(provider, mapUrl) ?? Boolean(mapUrl);
    setMapAction($('#googleMapsButton'), provider === 'google' && validMapUrl, shop.googleMaps);
    setMapAction($('#appleMapsButton'), provider === 'apple' && validMapUrl, shop.appleMaps);
    renderFavoriteAction(shop);
    openSheet(els.detailSheet);
  }

  function renderDistricts() {
    const city = activeCityName();
    const countryCode = window.CoffeeMapCities?.activeCountryCode;
    const cities = window.CoffeeMapCities?.citiesForCountry(countryCode) || [city];
    const regionCounts = shops.reduce((counts, shop) => {
      if (shop.region) counts[shop.region] = (counts[shop.region] || 0) + 1;
      return counts;
    }, {});
    const districtCounts = shops.reduce((counts, shop) => {
      if (shop.district) counts[shop.district] = (counts[shop.district] || 0) + 1;
      return counts;
    }, {});
    const actualRegions = new Set(shops.map(s => s.region).filter(Boolean));
    const cityConfig = window.CoffeeMapCities?.getCity(city, countryCode);
    const preferredRegions = cityConfig?.regionOrder || [];
    const regions = preferredRegions.filter(region => actualRegions.has(region))
      .concat([...actualRegions].filter(region => !preferredRegions.includes(region)).sort((a, b) => a.localeCompare(b, 'zh-Hans')));
    const districts = [...new Set(shops.map(s => s.district).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hans'));
    if (activeRegion !== '全部' && !regions.includes(activeRegion)) activeRegion = '全部';
    if (activeDistrict !== '全部' && !districts.includes(activeDistrict)) activeDistrict = '全部';
    window.CoffeeMapCities?.renderRegionRail(shops, activeRegion);
    const cityOptions = cities.length > 1
      ? `<section class="location-section"><h3>城市</h3><div class="district-grid">${cities.map(name => {
        const config = window.CoffeeMapCities?.getCity(name, countryCode);
        return `<button class="district-option${name === city ? ' active' : ''}" data-location-city="${escapeHtml(name)}">${escapeHtml(config?.localLabel || config?.label || name)}</button>`;
      }).join('')}</div></section>`
      : '';
    const regionOptions = regions.length
      ? `<section class="location-section"><h3>行政区／大区</h3><div class="district-grid">${regions.map(region => `<button class="district-option${activeRegion === region ? ' active' : ''}" data-location-region="${escapeHtml(region)}">${escapeHtml(region)} <span class="district-count">${regionCounts[region] || 0}</span></button>`).join('')}</div></section>`
      : '';
    const districtOptions = districts.length
      ? `<section class="location-section"><h3>具体地区</h3><div class="district-grid">${districts.map(district => `<button class="district-option${activeDistrict === district ? ' active' : ''}" data-district="${escapeHtml(district)}">${escapeHtml(district)} <span class="district-count">${districtCounts[district] || 0}</span></button>`).join('')}</div></section>`
      : '';
    els.districtList.innerHTML = `<button class="district-option location-reset${activeRegion === '全部' && activeDistrict === '全部' ? ' active' : ''}" data-location-all="true">全部地区</button>${cityOptions}${regionOptions}${districtOptions}`;

    els.districtList.querySelector('[data-location-all]')?.addEventListener('click', () => {
      activeRegion = '全部';
      activeDistrict = '全部';
      closeSheet(els.districtSheet);
      window.CoffeeMapCities?.renderRegionRail(shops, activeRegion);
      applyFilters({ fit: true });
    });
    els.districtList.querySelectorAll('[data-location-city]').forEach(button => button.addEventListener('click', () => {
      window.CoffeeMapCities?.setActiveCity(button.dataset.locationCity);
      closeSheet(els.districtSheet);
    }));
    els.districtList.querySelectorAll('[data-location-region]').forEach(button => button.addEventListener('click', () => {
      activeRegion = button.dataset.locationRegion;
      activeDistrict = '全部';
      closeSheet(els.districtSheet);
      window.CoffeeMapCities?.renderRegionRail(shops, activeRegion);
      applyFilters({ fit: true });
    }));
    els.districtList.querySelectorAll('[data-district]').forEach(button => button.addEventListener('click', () => {
      activeRegion = '全部';
      activeDistrict = button.dataset.district;
      closeSheet(els.districtSheet);
      window.CoffeeMapCities?.renderRegionRail(shops, activeRegion);
      applyFilters({ fit: true });
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
      activeDistrict = '全部';
      window.CoffeeMapCities?.renderRegionRail(shops, activeRegion);
      applyFilters({ fit: true });
    });
    window.addEventListener('coffee-map:city-change', switchCityView);
    window.addEventListener('coffee-map:shop-updated', event => applyShopUpdate(event.detail?.shop, event.detail?.previousCity, event.detail?.previousCountryCode));
    window.addEventListener('coffee-map:shop-removed', event => removeShopFromView(event.detail?.id, event.detail?.city, event.detail?.countryCode));
    els.search.addEventListener('input', () => { els.clearSearch.classList.toggle('visible', Boolean(els.search.value)); applyFilters(); });
    els.clearSearch.addEventListener('click', () => { els.search.value = ''; els.clearSearch.classList.remove('visible'); applyFilters({ fit: true }); });
    $('#fitButton').addEventListener('click', () => fitTo(filtered, true));
    $$('.nav-item').forEach(b => b.addEventListener('click', () => {
      activeView = b.dataset.view; $$('.nav-item').forEach(x => x.classList.toggle('active', x === b));
      document.body.classList.toggle('list-view', activeView === 'list');
      document.body.classList.toggle('saved-view', activeView === 'saved');
      applyFilters(); setTimeout(() => map?.resize(), 80);
    }));
    $('#locateButton').addEventListener('click', locateUser);
    $('#addButton').addEventListener('click', () => { resetAddForm(); els.addDialog.showModal(); });
    $('#closeAddDialog').addEventListener('click', () => els.addDialog.close());
    els.parseButton.addEventListener('click', parsePlaceLink);
    els.addForm.elements.map_link.addEventListener('input', markPlaceLinkChanged);
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
    const countryCode = event.detail?.countryCode || activeCountryCode();
    const config = event.detail?.config || window.CoffeeMapCities?.getCity(city, countryCode);
    const cachedCity = readCityCache(city, countryCode);
    const hasCachedShops = cachedCity?.shops?.some(shop => shop.active !== false
      && window.CoffeeMapLocationCatalog.hasCoordinates(shop));
    activeRegion = '全部';
    activeDistrict = '全部';
    selectedId = null;
    lastDataFitKey = '';
    els.search.value = '';
    els.clearSearch.classList.remove('visible');
    closeSheet(els.detailSheet);
    closeSheet(els.districtSheet);

    if (map) map.stop();
    if (map && config?.camera && !hasCachedShops) {
      map.easeTo({ center: config.camera.center, zoom: config.camera.zoom, duration: 420, essential: true });
    }

    if (!cachedCity) {
      shops = [];
      filtered = [];
      window.CoffeeMapCities?.renderRegionRail([], activeRegion);
      renderDistricts();
      applyFilters();
    }
    await loadCloudShops({ fit: true, city, countryCode });
  }

  function applyShopUpdate(rawShop, previousCity, previousCountryCode) {
    if (!rawShop?.id) return;
    const currentCity = activeCityName();
    const updated = normalizeShop(rawShop);
    const index = shops.findIndex(shop => shop.id === updated.id);
    const belongsToCurrentLocation = updated.active && Number.isFinite(updated.latitude) && Number.isFinite(updated.longitude)
      && updated.city === currentCity && updated.country_code === activeCountryCode();
    if (!belongsToCurrentLocation) {
      if (index >= 0) shops.splice(index, 1);
    } else if (index >= 0) {
      shops[index] = updated;
    } else {
      shops.push(updated);
    }
    const movedFromCurrentLocation = previousCity === currentCity
      && (!previousCountryCode || previousCountryCode === activeCountryCode());
    if (!previousCity || movedFromCurrentLocation || belongsToCurrentLocation) {
      window.CoffeeMapCities?.renderRegionRail(shops, activeRegion);
      renderDistricts();
      applyFilters();
    }
  }

  function removeShopFromView(id, city = activeCityName(), countryCode = activeCountryCode()) {
    if (!id || city !== activeCityName() || countryCode !== activeCountryCode()) return;
    const index = shops.findIndex(shop => shop.id === String(id));
    if (index >= 0) shops.splice(index, 1);
    if (selectedId === String(id)) {
      selectedId = null;
      closeSheet(els.detailSheet);
    }
    renderDistricts();
    window.CoffeeMapCities?.renderRegionRail(shops, activeRegion);
    applyFilters();
  }

  async function parsePlaceLink() {
    const cities = window.CoffeeMapCities;
    const url = els.addForm.elements.map_link.value.trim();
    const provider = cities.detectMapProvider(url);
    if (!provider) return showToast(url ? '请提供有效的 Google Maps 或 Apple Maps 商户链接' : '请先粘贴地图商户链接');
    const revision = ++parseRevision;
    parsedAddPlace = null;
    els.parseButton.disabled = true; els.parseButton.textContent = '解析中…'; els.parseState.textContent = '正在解析地点…';
    els.parseState.className = '';
    try {
      const { place } = await apiPost('parse', { [cities.providers[provider].field]: url });
      if (revision !== parseRevision || !els.addDialog.open) return;
      if (!Catalog.isCompleteLocation(place) || !Catalog.hasCoordinates(place)) {
        throw new Error('无法确认商户所属国家、城市或有效坐标，请检查链接后重新解析');
      }
      const location = Catalog.canonicalLocation(place);
      const expectedProvider = cities.getMapProvider(location);
      if (provider !== expectedProvider) {
        throw new Error(`${location.city} 的商户请提供 ${cities.providers[expectedProvider].label} 链接`);
      }
      ['name','address','region','district','latitude','longitude','category','source','notes'].forEach(field => {
        els.addForm.elements[field].value = location[field] ?? '';
      });
      cities.syncForm(els.addForm, location);
      parsedAddPlace = { url, provider, city: location.city, countryCode: location.country_code };
      els.parseState.textContent = '解析完成，请确认并按需修改'; els.parseState.className = 'success';
    } catch (error) {
      if (revision !== parseRevision || !els.addDialog.open) return;
      els.parseState.textContent = error.message; els.parseState.className = 'error'; showToast(error.message);
    }
    finally { els.parseButton.disabled = false; els.parseButton.textContent = '解析地点'; }
  }

  async function saveNewShop(event) {
    event.preventDefault();
    if (els.savePlaceButton.disabled) return;
    const fd = new FormData(els.addForm);
    const data = Object.fromEntries([...fd.entries()].map(([k,v]) => [k, String(v).trim()]));
    if (!parsedAddPlace || data.map_link !== parsedAddPlace.url || data.city !== parsedAddPlace.city
      || data.country_code !== parsedAddPlace.countryCode) return showToast('请先解析地图商户链接并确认解析所得城市');
    if (!Catalog.hasCoordinates(data)) return showToast('请输入有效的经纬度');
    const cities = window.CoffeeMapCities;
    data[cities.providers[parsedAddPlace.provider].field] = data.map_link;
    delete data.map_link;
    data.latitude = Number(data.latitude); data.longitude = Number(data.longitude); data.active = true;
    data.status = '想去'; // Keep the existing Sheet schema compatible; status is no longer a user-facing feature.
    data.favorite = false;
    const mapRule = cities.applyMapProviderRule(data, data);
    if (!Catalog.isCompleteLocation(data) || !mapRule.valid || !data.name || !data.address || !data.region || !data.district) return showToast('请先解析并确认所有必填信息');
    els.savePlaceButton.disabled = true; els.savePlaceButton.textContent = '正在保存…';
    try {
      const { shop } = await apiPost('add', data);
      if (!shop?.id || !Catalog.isCompleteLocation(shop)) throw new Error('云端未返回完整的店铺资料，请重新同步确认');
      const added = Catalog.canonicalLocation(shop);
      window.CoffeeMapData.upsert(shop);
      els.addDialog.close();
      if (added.city !== activeCityName() || added.country_code !== activeCountryCode()) {
        cities.setActiveCity(added.city, added.country_code);
        showToast('已保存到云端');
        return;
      }
      applyShopUpdate(shop);
      if (Catalog.hasCoordinates(shop)) selectShop(String(added.id), true);
      setCloudState('online', '云端已同步', `${shops.length} 家 · 刚刚更新`);
      showToast('已保存到云端');
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
      const favorite = toBoolean(shop.favorite);
      window.CoffeeMapData.upsert(shop);
      applyShopUpdate(shop);
      if (selectedId === String(shop.id)) {
        renderFavoriteAction({ favorite });
        if (activeView === 'saved' && !favorite) closeSheet(els.detailSheet);
      }
      setCloudState('online', '云端已同步', `${shops.length} 家 · 刚刚更新`);
      showToast(favorite ? '已加入收藏' : '已取消收藏');
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
    parsedAddPlace = null;
    parseRevision += 1;
    els.parseState.className = '';
    window.CoffeeMapCities?.syncForm(els.addForm, window.CoffeeMapCities.activeConfig);
    els.parseState.textContent = '粘贴具体商户链接后解析';
  }
  function setCloudState(state, title, meta) { els.syncIndicator.className = `sync-indicator ${state}`; els.syncIndicator.textContent = state === 'online' ? '已同步' : state === 'error' ? '离线' : '正在同步'; els.cloudDot.className = `cloud-dot ${state}`; els.cloudState.textContent = title; els.cloudMeta.textContent = meta; }
  function formatSyncTime(v) { const d = new Date(v); return Number.isNaN(d.getTime()) ? '已更新' : `更新于 ${new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}).format(d)}`; }
  function exportCsv() { const h = ['Name','City','Country','Country Code','District','Region','Address','Latitude','Longitude','Favorite','Category','Google Maps','Apple Maps','Source','Notes']; const r = shops.map(s => [s.name,s.city,s.country,s.country_code,s.district,s.region,s.address,s.latitude,s.longitude,s.favorite,s.category,s.googleMaps,s.appleMaps,s.source,s.notes]); download('coffee-shops.csv', '\ufeff' + [h,...r].map(x => x.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8'); }
  function csvCell(v) { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; }
  function download(name, content, type) { const blob = new Blob([content], { type }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  function openSheet(el) { el.classList.add('open'); el.setAttribute('aria-hidden','false'); }
  function closeSheet(el) { el.classList.remove('open'); el.setAttribute('aria-hidden','true'); }
  function markPlaceLinkChanged() {
    parsedAddPlace = null;
    parseRevision += 1;
    els.parseState.textContent = '链接已更改，请重新解析';
    els.parseState.className = '';
  }
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

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js?v=39').catch(() => {});
})();
