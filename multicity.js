(() => {
  'use strict';

  const CITY_STORAGE_KEY = 'coffee-map-active-city-v1';
  const COUNTRY_STORAGE_KEY = 'coffee-map-active-country-v1';
  const COUNTRY_CITY_STORAGE_PREFIX = 'coffee-map-country-city-v1:';
  const API_MARKER = 'script.google.com/macros/s/AKfycby0EnuIMDygemCzD522FkMgdYylRcr-UZef_KZUuiboBa5kT73PpDXrdHK8nqoAlsgxVg/exec';
  const PROVIDERS = Object.freeze({
    google: Object.freeze({ field: 'google_maps', label: 'Google Maps', placeholder: 'https://maps.app.goo.gl/…' }),
    apple: Object.freeze({ field: 'apple_maps', label: 'Apple Maps', placeholder: 'https://maps.apple.com/place?…' })
  });
  const COUNTRIES = Object.freeze({
    HK: Object.freeze({ label: 'Hong Kong SAR', localLabel: '香港特区', mapProvider: 'google' }),
    JP: Object.freeze({ label: 'Japan', localLabel: '日本', mapProvider: 'google' }),
    CN: Object.freeze({ label: 'China', localLabel: '中国', mapProvider: 'apple' })
  });
  const CITIES = Object.freeze({
    'Hong Kong': Object.freeze({
      label: 'Hong Kong', localLabel: '香港', country: 'Hong Kong SAR', countryCode: 'HK',
      center: [114.1588, 22.2857], zoom: 11.25,
      regions: ['港岛', '九龙', '新界', '离岛']
    }),
    Tokyo: Object.freeze({
      label: 'Tokyo', localLabel: '东京', country: 'Japan', countryCode: 'JP',
      center: [139.6917, 35.6895], zoom: 10.6,
      regions: ['千代田区', '中央区', '港区', '新宿区', '文京区', '台东区', '墨田区', '江东区', '品川区', '目黑区', '大田区', '世田谷区', '涩谷区', '中野区', '杉并区', '丰岛区', '北区', '荒川区', '板桥区', '练马区', '足立区', '葛饰区', '江户川区']
    }),
    Beijing: Object.freeze({
      label: 'Beijing', localLabel: '北京', country: 'China', countryCode: 'CN',
      center: [116.4074, 39.9042], zoom: 10.6,
      regions: ['东城区', '西城区', '朝阳区', '海淀区', '丰台区', '石景山区', '通州区', '昌平区', '大兴区', '顺义区', '房山区', '门头沟区', '怀柔区', '平谷区', '密云区', '延庆区']
    })
  });

  const storedCity = localStorage.getItem(CITY_STORAGE_KEY);
  let activeCity = CITIES[storedCity] ? storedCity : 'Hong Kong';
  let activeConfig = CITIES[activeCity];
  let activeCountryCode = activeConfig.countryCode;

  window.CoffeeMapCities = Object.freeze({
    get activeCity() { return activeCity; },
    get activeConfig() { return activeConfig; },
    get activeCountryCode() { return activeCountryCode; },
    get activeCountry() { return COUNTRIES[activeCountryCode]; },
    countries: COUNTRIES,
    cities: CITIES,
    providers: PROVIDERS,
    getMapProvider,
    getMapField,
    validateMapUrl,
    syncForm: syncFormLocation,
    applyMapProviderRule,
    setActiveCity,
    setActiveCountry,
    citiesForCountry,
    renderRegionRail
  });

  patchMapDefaults();
  patchApiResponses();
  installCitySelector();
  renderRegionRail();
  enhanceAddForm();
  watchForEditForm();
  patchDialogOpen();
  updateDocumentMetadata();

  function getMapProvider(city = activeCity) {
    const countryCode = CITIES[city]?.countryCode || activeCountryCode;
    return COUNTRIES[countryCode]?.mapProvider || 'google';
  }

  function getMapField(city = activeCity) {
    return PROVIDERS[getMapProvider(city)].field;
  }

  function applyMapProviderRule(target, city = activeCity) {
    const provider = getMapProvider(city);
    const requiredField = PROVIDERS[provider].field;
    const blockedField = provider === 'google' ? PROVIDERS.apple.field : PROVIDERS.google.field;
    if (target && typeof target === 'object') target[blockedField] = '';
    return { provider, requiredField, blockedField, valid: validateMapUrl(provider, target?.[requiredField]) };
  }

  function validateMapUrl(provider, value) {
    try {
      const url = new URL(String(value || '').trim());
      if (url.protocol !== 'https:') return false;
      const host = url.hostname.toLowerCase();
      if (provider === 'apple') return host === 'maps.apple.com';
      const googleHost = /(^|\.)google\.[a-z.]+$/.test(host) && url.pathname.startsWith('/maps');
      return host === 'maps.app.goo.gl' || host === 'goo.gl' && url.pathname.startsWith('/maps') || googleHost;
    } catch (_) {
      return false;
    }
  }

  function patchMapDefaults() {
    const BaseMap = window.maplibregl?.Map;
    if (!BaseMap || BaseMap.__coffeeMapCityAware) return;
    class CityAwareMap extends BaseMap {
      constructor(options = {}) {
        super({ ...options, center: activeConfig.center, zoom: activeConfig.zoom, minZoom: 0 });
      }
    }
    CityAwareMap.__coffeeMapCityAware = true;
    window.maplibregl.Map = CityAwareMap;
  }

  function patchApiResponses() {
    if (window.fetch.__coffeeMapCityAware) return;
    const nativeFetch = window.fetch.bind(window);
    const cityAwareFetch = async (...args) => {
      const response = await nativeFetch(...args);
      const requestUrl = String(args[0]?.url || args[0] || '');
      if (!requestUrl.includes(API_MARKER)) return response;
      let responseCity = activeCity;
      try {
        const requestedCity = new URL(requestUrl, window.location.href).searchParams.get('city');
        if (CITIES[requestedCity]) responseCity = requestedCity;
      } catch (_) {}
      try {
        const payload = await response.clone().json();
        if (Array.isArray(payload.shops)) {
          payload.shops = payload.shops.map(normalizeLocationFields).filter(shop => shop.city === responseCity);
          payload.count = payload.shops.length;
        }
        if (payload.place) payload.place = normalizeLocationFields(payload.place);
        if (payload.shop) payload.shop = normalizeLocationFields(payload.shop);
        const headers = new Headers(response.headers);
        headers.delete('content-length');
        headers.set('content-type', 'application/json; charset=utf-8');
        return new Response(JSON.stringify(payload), { status: response.status, statusText: response.statusText, headers });
      } catch (_) {
        return response;
      }
    };
    cityAwareFetch.__coffeeMapCityAware = true;
    window.fetch = cityAwareFetch;
  }

  function normalizeLocationFields(raw = {}) {
    const city = inferCity(raw);
    const cityConfig = CITIES[city] || activeConfig;
    const country = cityConfig.country;
    const countryCode = String(raw.country_code || cityConfig.countryCode);
    const inferredRegion = city === 'Tokyo' ? inferTokyoRegion(raw.address) : inferBeijingRegion(raw.address);
    const region = validRegion(city, raw.region) ? raw.region : (validRegion(city, inferredRegion) ? inferredRegion : raw.region);
    return { ...raw, city, country, country_code: countryCode, region };
  }

  function inferCity(place = {}) {
    if (CITIES[place.city]) return place.city;
    const latitude = Number(place.latitude);
    const longitude = Number(place.longitude);
    const address = String(place.address || '');
    const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
    const insideTokyo = hasCoordinates && latitude >= 35.45 && latitude <= 35.95 && longitude >= 139.35 && longitude <= 140.10;
    const insideBeijing = hasCoordinates && latitude >= 39.40 && latitude <= 41.10 && longitude >= 115.40 && longitude <= 117.60;
    if (insideTokyo || /Tokyo|東京都|东京/i.test(address)) return 'Tokyo';
    if (insideBeijing || /Beijing|北京市|北京/i.test(address)) return 'Beijing';
    return 'Hong Kong';
  }

  function inferTokyoRegion(address = '') {
    const text = String(address).toLowerCase();
    const aliases = {
      '千代田区': ['千代田区', 'chiyoda'], '中央区': ['中央区', 'chuo'], '港区': ['港区', 'minato'],
      '新宿区': ['新宿区', 'shinjuku'], '文京区': ['文京区', 'bunkyo'], '台东区': ['台東区', '台东区', 'taito'],
      '墨田区': ['墨田区', 'sumida'], '江东区': ['江東区', '江东区', 'koto'], '品川区': ['品川区', 'shinagawa'],
      '目黑区': ['目黒区', '目黑区', 'meguro'], '大田区': ['大田区', 'ota'], '世田谷区': ['世田谷区', 'setagaya'],
      '涩谷区': ['渋谷区', '涩谷区', 'shibuya'], '中野区': ['中野区', 'nakano'], '杉并区': ['杉並区', '杉并区', 'suginami'],
      '丰岛区': ['豊島区', '丰岛区', 'toshima'], '北区': ['北区', 'kita'], '荒川区': ['荒川区', 'arakawa'],
      '板桥区': ['板橋区', '板桥区', 'itabashi'], '练马区': ['練馬区', '练马区', 'nerima'], '足立区': ['足立区', 'adachi'],
      '葛饰区': ['葛飾区', '葛饰区', 'katsushika'], '江户川区': ['江戸川区', '江户川区', 'edogawa']
    };
    return Object.keys(aliases).find(region => aliases[region].some(alias => text.includes(alias.toLowerCase()))) || '待确认';
  }

  function inferBeijingRegion(address = '') {
    const text = String(address);
    return CITIES.Beijing.regions.find(region => text.includes(region)) || '待确认';
  }

  function validRegion(city, region) {
    return Boolean(region && CITIES[city]?.regions.includes(String(region)));
  }

  function setActiveCity(city) {
    if (!CITIES[city]) return;
    const sheet = document.querySelector('#countrySheet');
    if (city === activeCity) {
      if (sheet) closeSheet(sheet);
      return;
    }
    activeCity = city;
    activeConfig = CITIES[city];
    activeCountryCode = activeConfig.countryCode;
    localStorage.setItem(CITY_STORAGE_KEY, city);
    localStorage.setItem(COUNTRY_STORAGE_KEY, activeCountryCode);
    localStorage.setItem(COUNTRY_CITY_STORAGE_PREFIX + activeCountryCode, city);
    syncCitySelector();
    renderRegionRail([], '全部');
    updateDocumentMetadata();
    if (sheet) closeSheet(sheet);
    window.dispatchEvent(new CustomEvent('coffee-map:city-change', {
      detail: { city, config: activeConfig }
    }));
  }

  function setActiveCountry(countryCode) {
    if (!COUNTRIES[countryCode]) return;
    const availableCities = citiesForCountry(countryCode);
    if (!availableCities.length) return;
    const rememberedCity = localStorage.getItem(COUNTRY_CITY_STORAGE_PREFIX + countryCode);
    const targetCity = availableCities.includes(rememberedCity) ? rememberedCity : availableCities[0];
    if (countryCode === activeCountryCode && targetCity === activeCity) {
      closeSheet(document.querySelector('#countrySheet'));
      return;
    }
    setActiveCity(targetCity);
  }

  function citiesForCountry(countryCode = activeCountryCode) {
    return Object.keys(CITIES).filter(city => CITIES[city].countryCode === countryCode);
  }

  function installCitySelector() {
    let button = document.querySelector('#cityButton');
    if (!button) {
      const heading = document.querySelector('.brand-row h1');
      if (!heading) return;
      button = document.createElement('button');
      button.id = 'cityButton';
      button.className = 'city-title-button';
      button.type = 'button';
      button.innerHTML = '<span data-country-label></span><span class="city-chevron" aria-hidden="true"><svg class="material-symbol" viewBox="0 0 960 960"><use href="#ms-expand-more"/></svg></span>';
      heading.replaceWith(button);
    }
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', 'countrySheet');

    const sheet = document.createElement('div');
    sheet.id = 'countrySheet';
    sheet.className = 'sheet';
    sheet.setAttribute('aria-hidden', 'true');
    sheet.innerHTML = `<div class="sheet-backdrop" data-close-country></div><article class="sheet-card compact-card city-sheet-card"><div class="sheet-grabber"></div><div class="sheet-title-row"><div><p class="list-kicker">Countries & Regions</p><h2>选择国家／地区</h2></div><button class="sheet-close" type="button" data-close-country aria-label="关闭"><svg class="material-symbol" viewBox="0 0 960 960" aria-hidden="true"><use href="#ms-close"/></svg></button></div><div id="countryList" class="city-list">${Object.keys(COUNTRIES).map(code => `<button class="city-option" type="button" data-country-code="${escapeHtml(code)}"><span><strong>${escapeHtml(COUNTRIES[code].label)}</strong><small>${escapeHtml(COUNTRIES[code].localLabel)}</small></span><b aria-hidden="true"></b></button>`).join('')}</div></article>`;
    document.body.appendChild(sheet);
    syncCitySelector();

    button.addEventListener('click', () => openSheet(sheet));
    sheet.querySelectorAll('[data-close-country]').forEach(node => node.addEventListener('click', () => closeSheet(sheet)));
    sheet.querySelector('#countryList')?.addEventListener('click', event => {
      const option = event.target.closest('[data-country-code]');
      if (!option) return;
      setActiveCountry(option.dataset.countryCode);
    });
  }

  function syncCitySelector() {
    const label = document.querySelector('[data-country-label]');
    if (label) label.textContent = COUNTRIES[activeCountryCode].label;
    document.querySelectorAll('#countryList [data-country-code]').forEach(option => {
      const selected = option.dataset.countryCode === activeCountryCode;
      option.classList.toggle('active', selected);
      option.setAttribute('aria-current', selected ? 'true' : 'false');
      const mark = option.querySelector('b');
      if (mark) mark.innerHTML = selected
        ? '<svg class="material-symbol" viewBox="0 0 960 960"><use href="#ms-check"/></svg>'
        : '';
    });
  }

  function renderRegionRail(shops = [], activeRegion = '全部') {
    const rail = document.querySelector('#regionFilters');
    if (!rail) return;
    const cityShops = Array.isArray(shops) ? shops.filter(shop => shop.city === activeCity) : [];
    const actualRegions = new Set(cityShops.map(shop => String(shop.region || '').trim()).filter(Boolean));
    const configuredRegions = activeConfig.regions.filter(region => actualRegions.has(region));
    const extraRegions = [...actualRegions].filter(region => !activeConfig.regions.includes(region))
      .sort((a, b) => a.localeCompare(b, 'zh-Hans'));
    const regions = configuredRegions.concat(extraRegions);
    const count = cityShops.length ? cityShops.length : '—';
    rail.innerHTML = `<button class="chip city-area-chip${activeRegion === '全部' ? ' active' : ''}" id="districtButton" type="button"><span class="city-area-label">${escapeHtml(activeConfig.localLabel)}</span> <span id="allCount">${count}</span><svg class="material-symbol" viewBox="0 0 960 960" aria-hidden="true"><use href="#ms-expand-more"/></svg></button>${regions.map(region => `<button class="chip${activeRegion === region ? ' active' : ''}" data-region="${escapeHtml(region)}">${escapeHtml(region)}</button>`).join('')}`;
  }

  function enhanceAddForm() {
    const form = document.querySelector('#addForm');
    if (!form) return;
    enhanceLocationFields(form, activeCity);
    const parseState = document.querySelector('#parseState');
    if (!parseState) return;
    new MutationObserver(() => {
      if (!parseState.classList.contains('success')) return;
      syncFormLocation(form, inferCity(readFormLocation(form)));
    }).observe(parseState, { childList: true, attributes: true, subtree: true });
  }

  function watchForEditForm() {
    const enhanceExisting = () => {
      const form = document.querySelector('#editPlaceForm');
      if (form) enhanceLocationFields(form, activeCity);
    };
    enhanceExisting();
    new MutationObserver(enhanceExisting).observe(document.body, { childList: true, subtree: true });
  }

  function enhanceLocationFields(form, defaultCity) {
    if (form.dataset.multicityEnhanced === 'true') return;
    const districtLabel = form.elements.district?.closest('label');
    const regionField = form.elements.region;
    const regionLabel = regionField?.closest('label');
    if (!districtLabel || !regionField || !regionLabel) return;

    const cityLabel = document.createElement('label');
    cityLabel.innerHTML = `<span>城市 *</span><select name="city" required>${cityOptions(defaultCity)}</select>`;
    const countryLabel = document.createElement('label');
    countryLabel.innerHTML = `<span>国家／地区</span><input name="country" type="text" readonly value="${escapeHtml(CITIES[defaultCity].country)}" />`;
    districtLabel.parentNode.insertBefore(cityLabel, districtLabel);
    districtLabel.parentNode.insertBefore(countryLabel, districtLabel);
    if (!form.elements.country_code) {
      const countryCodeInput = document.createElement('input');
      countryCodeInput.type = 'hidden';
      countryCodeInput.name = 'country_code';
      countryCodeInput.value = CITIES[defaultCity].countryCode;
      form.appendChild(countryCodeInput);
    }

    const regionSelect = document.createElement('select');
    regionSelect.name = 'region';
    regionSelect.required = true;
    regionField.replaceWith(regionSelect);
    form.dataset.multicityEnhanced = 'true';
    fillRegionSelect(regionSelect, defaultCity);
    syncFormLocation(form, defaultCity);
    cityLabel.querySelector('select').addEventListener('change', event => syncFormLocation(form, event.currentTarget.value, { clearRegion: true }));
  }

  function syncFormLocation(form, city, { clearRegion = false } = {}) {
    if (!form || !CITIES[city]) return;
    const citySelect = form.elements.city;
    const countryInput = form.elements.country;
    const countryCodeInput = form.elements.country_code;
    const regionSelect = form.elements.region;
    const currentRegion = clearRegion ? '' : String(regionSelect?.value || '');
    const inferredRegion = city === 'Tokyo'
      ? inferTokyoRegion(form.elements.address?.value)
      : city === 'Beijing' ? inferBeijingRegion(form.elements.address?.value) : currentRegion;
    const targetRegion = validRegion(city, currentRegion)
      ? currentRegion
      : (validRegion(city, inferredRegion) ? inferredRegion : '');

    if (citySelect) citySelect.value = city;
    if (countryInput) countryInput.value = CITIES[city].country;
    if (countryCodeInput) countryCodeInput.value = CITIES[city].countryCode;
    if (regionSelect) fillRegionSelect(regionSelect, city, targetRegion);
    const regionLabel = regionSelect?.closest('label')?.querySelector('span');
    if (regionLabel) regionLabel.textContent = city === 'Hong Kong' ? '大区 *' : '行政区 *';
    syncMapProviderFields(form, city);
  }

  function syncMapProviderFields(form, city) {
    const activeProvider = getMapProvider(city);
    Object.entries(PROVIDERS).forEach(([providerKey, provider]) => {
      const input = form.elements[provider.field];
      const label = input?.closest('[data-map-provider-field]') || input?.closest('label');
      if (!input || !label) return;
      const isActive = providerKey === activeProvider;
      label.hidden = !isActive;
      input.disabled = !isActive;
      input.required = isActive;
      if (isActive) input.placeholder = provider.placeholder;
    });
    form.dataset.mapProvider = activeProvider;

    const parseState = form.querySelector('#parseState');
    if (parseState && !parseState.classList.contains('success')) {
      parseState.textContent = `粘贴具体 ${PROVIDERS[activeProvider].label} 商户链接后解析`;
    }
  }

  function fillRegionSelect(select, city, selected = '') {
    if (!select || !CITIES[city]) return;
    select.innerHTML = '<option value="">请选择</option>' + CITIES[city].regions.map(region => `<option value="${escapeHtml(region)}">${escapeHtml(region)}</option>`).join('');
    if (selected && !CITIES[city].regions.includes(selected)) {
      select.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(selected)}">${escapeHtml(selected)}</option>`);
    }
    select.value = selected || '';
  }

  function cityOptions(selected) {
    return Object.keys(CITIES).map(city => `<option value="${escapeHtml(city)}"${city === selected ? ' selected' : ''}>${escapeHtml(CITIES[city].label)}</option>`).join('');
  }

  function patchDialogOpen() {
    const proto = window.HTMLDialogElement?.prototype;
    if (!proto || proto.showModal.__coffeeMapCityAware) return;
    const nativeShowModal = proto.showModal;
    const cityAwareShowModal = function (...args) {
      const form = this.querySelector('form');
      if (form?.dataset.multicityEnhanced === 'true') {
        const city = this.id === 'addDialog' ? activeCity : inferCity(readFormLocation(form));
        syncFormLocation(form, city);
      }
      return nativeShowModal.apply(this, args);
    };
    cityAwareShowModal.__coffeeMapCityAware = true;
    proto.showModal = cityAwareShowModal;
  }

  function readFormLocation(form) {
    return {
      city: form.elements.city?.value,
      address: form.elements.address?.value,
      latitude: form.elements.latitude?.value,
      longitude: form.elements.longitude?.value
    };
  }

  function updateDocumentMetadata() {
    document.documentElement.dataset.city = activeCity.toLowerCase().replace(/\s+/g, '-');
    document.documentElement.dataset.country = activeCountryCode.toLowerCase();
    document.title = `${COUNTRIES[activeCountryCode].label} · Coffee Shops`;
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', 'Coffee Shops');
  }

  function openSheet(sheet) {
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
  }

  function closeSheet(sheet) {
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }
})();
