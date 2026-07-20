(() => {
  'use strict';

  const API_URL = 'https://script.google.com/macros/s/AKfycby0EnuIMDygemCzD522FkMgdYylRcr-UZef_KZUuiboBa5kT73PpDXrdHK8nqoAlsgxVg/exec';
  const ADMIN_KEY_STORAGE = 'hk-coffee-admin-key-v2';
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
    map.on('load', () => { renderMarkers(); if (filtered.length) fitTo(filtered, false); });
  }

  async function loadCloudShops({ fit = false, quiet = false } = {}) {
    setCloudState('syncing', '正在同步', '正在读取 Google Sheets');
    if (!quiet) els.list.innerHTML = '<div class="empty-state">正在从云端加载…</div>';
    try {
      const response = await fetch(`${API_URL}?action=list&_=${Date.now()}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok || !Array.isArray(payload.shops)) throw new Error(payload.error || '云端数据格式不正确');
      shops = payload.shops.map(normalizeShop).filter(s => s.active && s.id && Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
      setCloudState('online', '云端已同步', `${shops.length} 家 · ${formatSyncTime(payload.updated_at)}`);
      renderDistricts();
      applyFilters({ fit });
    } catch (error) {
      console.error(error);
      setCloudState('error', '云端连接失败', '请检查网络后重试');
      els.allCount.textContent = els.resultCount.textContent = '—';
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
      appleMaps: String(raw.apple_maps || ''), category: String(raw.category || ''), status: String(raw.status || '想去'),
      source: String(raw.source || ''), notes: String(raw.notes || ''), active: raw.active !== false
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
    els.allCount.textContent = shops.length; els.resultCount.textContent = filtered.length;
    if (!filtered.length) { els.list.innerHTML = '<div class="empty-state">没有符合当前条件的咖啡店</div>'; return; }
    els.list.innerHTML = filtered.map(s => `<button class="shop-card" data-shop-id="${escapeHtml(s.id)}"><h3>${escapeHtml(s.name)}</h3><p><span class="area">${escapeHtml(s.district)}</span>${escapeHtml(s.address)}</p></button>`).join('');
    els.list.querySelectorAll('[data-shop-id]').forEach(card => card.addEventListener('click', () => selectShop(card.dataset.shopId, true)));
  }

  function applyFilters({ fit = false } = {}) {
    const q = normalize(els.search.value);
    filtered = shops.filter(s => {
      const regionOK = activeRegion === '全部' || s.region === activeRegion;
      const districtOK = activeDistrict === '全部' || s.district === activeDistrict;
      const searchOK = !q || [s.name, s.address, s.region, s.district, s.category, s.status, s.notes].some(v => normalize(v).includes(q));
      const savedOK = activeView !== 'saved' || s.status === '优先去';
      return regionOK && districtOK && searchOK && savedOK;
    });
    renderList(); if (map?.loaded()) renderMarkers(); if (fit) fitTo(filtered, true);
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
    $$('.status-button').forEach(b => b.classList.toggle('active', b.dataset.status === shop.status));
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
    $('#regionFilters').addEventListener('click', e => {
      const b = e.target.closest('[data-region]'); if (!b) return;
      activeRegion = b.dataset.region; $$('#regionFilters [data-region]').forEach(x => x.classList.toggle('active', x === b)); applyFilters({ fit: true });
    });
    $('#districtButton').addEventListener('click', () => { renderDistricts(); openSheet(els.districtSheet); });
    els.search.addEventListener('input', () => { els.clearSearch.classList.toggle('visible', Boolean(els.search.value)); applyFilters(); });
    els.clearSearch.addEventListener('click', () => { els.search.value = ''; els.clearSearch.classList.remove('visible'); applyFilters({ fit: true }); });
    $('#fitButton').addEventListener('click', () => fitTo(filtered, true));
    $$('.nav-item').forEach(b => b.addEventListener('click', () => {
      activeView = b.dataset.view; $$('.nav-item').forEach(x => x.classList.toggle('active', x === b));
      document.body.classList.toggle('list-view', activeView === 'list'); document.body.classList.toggle('saved-view', activeView === 'saved');
      applyFilters(); setTimeout(() => map?.resize(), 80);
    }));
    $('#locateButton').addEventListener('click', () => navigator.geolocation?.getCurrentPosition(p => map?.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 14.5 }), () => showToast('无法取得当前位置'), { enableHighAccuracy: true, timeout: 8000 }));
    $('#addButton').addEventListener('click', () => { resetAddForm(); els.addDialog.showModal(); });
    $('#closeAddDialog').addEventListener('click', () => els.addDialog.close());
    els.parseButton.addEventListener('click', parsePlaceLink);
    ['google_maps', 'apple_maps'].forEach(field => els.addForm.elements[field]?.addEventListener('input', markPlaceLinkChanged));
    els.addForm.addEventListener('submit', saveNewShop);
    $('#useMapCenter').addEventListener('click', () => { if (!map) return; const c = map.getCenter(); els.addForm.elements.latitude.value = c.lat.toFixed(7); els.addForm.elements.longitude.value = c.lng.toFixed(7); });
    $$('.status-button').forEach(b => b.addEventListener('click', () => updateStatus(b.dataset.status)));
    $('#menuButton').addEventListener('click', () => { renderAdminKeyState(); openSheet(els.menuSheet); });
    $$('[data-close-sheet]').forEach(x => x.addEventListener('click', () => closeSheet(els.detailSheet)));
    $$('[data-close-district]').forEach(x => x.addEventListener('click', () => closeSheet(els.districtSheet)));
    $$('[data-close-menu]').forEach(x => x.addEventListener('click', () => closeSheet(els.menuSheet)));
    $('#saveAdminKeyButton').addEventListener('click', () => { const v = els.adminKeyInput.value.trim(); if (!v) return showToast('请输入管理员密钥'); localStorage.setItem(ADMIN_KEY_STORAGE, v); renderAdminKeyState(); showToast('密钥已保存在本机'); });
    $('#clearAdminKeyButton').addEventListener('click', () => { localStorage.removeItem(ADMIN_KEY_STORAGE); renderAdminKeyState(); showToast('本机密钥已清除'); });
    $('#refreshButton').addEventListener('click', async () => { await loadCloudShops({ quiet: true }); closeSheet(els.menuSheet); });
    $('#exportJsonButton').addEventListener('click', () => download('coffee-shops.json', JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), shops }, null, 2), 'application/json'));
    $('#exportCsvButton').addEventListener('click', exportCsv);
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
      ['google_maps','apple_maps','name','address','region','district','latitude','longitude','category','status','source','notes','city','country'].forEach(f => { if (place?.[f] !== undefined && els.addForm.elements[f]) els.addForm.elements[f].value = place[f] ?? ''; });
      window.CoffeeMapCities?.syncForm(els.addForm, place?.city || city);
      els.parseState.textContent = '解析完成，请确认并按需修改'; els.parseState.className = 'success';
    } catch (error) { els.parseState.textContent = error.message; els.parseState.className = 'error'; showToast(error.message); }
    finally { els.parseButton.disabled = false; els.parseButton.textContent = '解析地点'; }
  }

  async function saveNewShop(event) {
    event.preventDefault(); const fd = new FormData(els.addForm);
    const data = Object.fromEntries([...fd.entries()].map(([k,v]) => [k, String(v).trim()]));
    data.latitude = Number(data.latitude); data.longitude = Number(data.longitude); data.active = true;
    const mapRule = window.CoffeeMapCities?.applyMapProviderRule(data, data.city) || { requiredField: 'google_maps' };
    if (!data[mapRule.requiredField] || mapRule.valid === false || !data.name || !data.address || !data.region || !data.district || !Number.isFinite(data.latitude) || !Number.isFinite(data.longitude)) return showToast('请先解析并确认所有必填信息');
    els.savePlaceButton.disabled = true; els.savePlaceButton.textContent = '正在保存…';
    try {
      const { shop } = await apiPost('add', data); const added = normalizeShop(shop); shops.push(added);
      renderDistricts(); applyFilters(); els.addDialog.close(); selectShop(added.id, true); setCloudState('online', '云端已同步', `${shops.length} 家 · 刚刚更新`); showToast('已保存到云端地图');
    } catch (error) { showToast(error.message); }
    finally { els.savePlaceButton.disabled = false; els.savePlaceButton.textContent = '保存到云端地图'; }
  }

  async function updateStatus(status) {
    if (!selectedId) return;
    try {
      const { shop } = await apiPost('setStatus', { id: selectedId, status }); const updated = normalizeShop(shop);
      const i = shops.findIndex(s => s.id === selectedId); if (i >= 0) shops[i] = updated;
      applyFilters(); selectShop(selectedId, false); setCloudState('online', '云端已同步', `${shops.length} 家 · 刚刚更新`); showToast(`已标记为“${status}”`);
    } catch (error) { showToast(error.message); }
  }

  function renderAdminKeyState() {
    const has = Boolean(localStorage.getItem(ADMIN_KEY_STORAGE)); els.adminKeyInput.value = ''; els.adminKeyInput.placeholder = has ? '已保存在本机' : '未设置'; $('#clearAdminKeyButton').disabled = !has;
  }
  function resetAddForm() {
    els.addForm.reset();
    els.addForm.elements.status.value = '想去';
    els.parseState.className = '';
    window.CoffeeMapCities?.syncForm(els.addForm, window.CoffeeMapCities.activeCity);
    const provider = els.addForm.dataset.mapProvider === 'apple' ? 'Apple Maps' : 'Google Maps';
    els.parseState.textContent = `粘贴具体 ${provider} 商户链接后解析`;
  }
  function setCloudState(state, title, meta) { els.syncIndicator.className = `sync-indicator ${state}`; els.syncIndicator.textContent = state === 'online' ? '已同步' : state === 'error' ? '离线' : '正在同步'; els.cloudDot.className = `cloud-dot ${state}`; els.cloudState.textContent = title; els.cloudMeta.textContent = meta; }
  function formatSyncTime(v) { const d = new Date(v); return Number.isNaN(d.getTime()) ? '已更新' : `更新于 ${new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}).format(d)}`; }
  function exportCsv() { const h = ['Name','City','Country','District','Region','Address','Latitude','Longitude','Status','Category','Google Maps','Apple Maps','Source','Notes']; const r = shops.map(s => [s.name,s.city,s.country,s.district,s.region,s.address,s.latitude,s.longitude,s.status,s.category,s.googleMaps,s.appleMaps,s.source,s.notes]); download('coffee-shops.csv', '\ufeff' + [h,...r].map(x => x.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8'); }
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
  function escapeHtml(v) { return String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function showToast(text) { clearTimeout(toastTimer); els.toast.textContent = text; els.toast.classList.add('show'); toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600); }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
