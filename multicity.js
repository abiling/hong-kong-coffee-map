(() => {
  'use strict';

  const Catalog = window.CoffeeMapLocationCatalog;
  if (!Catalog) throw new Error('CoffeeMapLocationCatalog must load before multicity.js');

  const CITY_STORAGE_KEY = 'coffee-map-active-city-v1';
  const COUNTRY_STORAGE_KEY = 'coffee-map-active-country-v1';
  const COUNTRY_CITY_STORAGE_PREFIX = 'coffee-map-country-city-v1:';
  const ALL_DATA_CACHE_KEY = 'coffee-map-all-data-v3';
  const API_MARKER = 'script.google.com/macros/s/AKfycby0EnuIMDygemCzD522FkMgdYylRcr-UZef_KZUuiboBa5kT73PpDXrdHK8nqoAlsgxVg/exec';
  const PROVIDERS = Object.freeze({
    google: Object.freeze({ field: 'google_maps', label: 'Google Maps', placeholder: 'https://maps.app.goo.gl/…' }),
    apple: Object.freeze({ field: 'apple_maps', label: 'Apple Maps', placeholder: 'https://maps.apple.com/place?…' })
  });

  // Display/camera metadata only. These entries never decide which locations
  // exist: the complete shops dataset remains the catalog source of truth.
  const DISPLAY_OVERRIDES = Object.freeze({
    countries: Object.freeze({
      HK: Object.freeze({ label: 'Hong Kong SAR', localLabel: '香港特别行政区', order: 10 }),
      JP: Object.freeze({ label: 'Japan', localLabel: '日本', order: 20 }),
      CN: Object.freeze({ label: 'China', localLabel: '中国', order: 30 })
    }),
    cities: Object.freeze({
      'HK::Hong Kong': Object.freeze({
        localLabel: '香港', order: 10,
        camera: Object.freeze({ center: [114.1588, 22.2857], zoom: 11.25 }),
        regionOrder: Object.freeze(['港岛', '九龙', '新界', '离岛'])
      }),
      'JP::Tokyo': Object.freeze({
        localLabel: '东京', order: 10,
        camera: Object.freeze({ center: [139.6917, 35.6895], zoom: 10.6 })
      }),
      'CN::Beijing': Object.freeze({
        localLabel: '北京', order: 10,
        camera: Object.freeze({ center: [116.4074, 39.9042], zoom: 10.6 })
      }),
      "CN::Xi'an": Object.freeze({ localLabel: '西安', order: 20 })
    })
  });

  let catalogRecords = readCachedRecords();
  let catalog = Catalog.buildCatalog(catalogRecords, DISPLAY_OVERRIDES);
  let activeLocationKey = resolveInitialLocationKey();
  let activeConfig = catalog.locations[activeLocationKey] || provisionalLocation();
  let activeCity = activeConfig.city;
  let activeCountryCode = activeConfig.countryCode;

  window.CoffeeMapCities = Object.freeze({
    get activeCity() { return activeCity; },
    get activeConfig() { return activeConfig; },
    get activeCountryCode() { return activeCountryCode; },
    get activeCountry() { return catalog.countries[activeCountryCode] || null; },
    get activeLocationKey() { return activeLocationKey; },
    get catalog() { return catalog; },
    get countries() { return catalog.countries; },
    get cities() { return cityCompatibilityIndex(); },
    providers: PROVIDERS,
    applyMapProviderRule,
    citiesForCountry,
    getCity,
    getLocation,
    getMapField,
    getMapProvider,
    normalizeLocationFields,
    renderRegionRail,
    setActiveCity,
    setActiveCountry,
    setActiveLocation,
    syncForm: syncFormLocation,
    updateCatalog,
    validateMapUrl
  });

  patchMapDefaults();
  patchApiResponses();
  installCitySelector();
  renderRegionRail();
  enhanceAddForm();
  watchForEditForm();
  patchDialogOpen();
  updateDocumentMetadata();

  function readCachedRecords() {
    try {
      const payload = JSON.parse(localStorage.getItem(ALL_DATA_CACHE_KEY) || 'null');
      return Array.isArray(payload?.shops) ? payload.shops : [];
    } catch (_) {
      return [];
    }
  }

  function provisionalLocation() {
    const storedCity = String(localStorage.getItem(CITY_STORAGE_KEY) || '').trim();
    const storedCountryCode = String(localStorage.getItem(COUNTRY_STORAGE_KEY) || '').trim().toUpperCase();
    const key = Catalog.locationKey(storedCountryCode, storedCity);
    const enhancement = DISPLAY_OVERRIDES.cities[key] || {};
    const countryEnhancement = DISPLAY_OVERRIDES.countries[storedCountryCode] || {};
    return {
      key, city: storedCity, label: enhancement.label || storedCity || 'Coffee Shops',
      localLabel: enhancement.localLabel || storedCity || 'Coffee Shops',
      country: countryEnhancement.label || '', countryCode: storedCountryCode,
      camera: enhancement.camera || null, regionOrder: enhancement.regionOrder || [],
      regions: [], districts: [], shops: [], bounds: null,
      provider: Catalog.providerForCountryCode(storedCountryCode)
    };
  }

  function resolveInitialLocationKey() {
    const storedCity = String(localStorage.getItem(CITY_STORAGE_KEY) || '').trim();
    const storedCountryCode = String(localStorage.getItem(COUNTRY_STORAGE_KEY) || '').trim().toUpperCase();
    const exact = Catalog.locationKey(storedCountryCode, storedCity);
    if (catalog.locations[exact]) return exact;
    const matchingCity = Object.values(catalog.locations).find(location => location.city === storedCity);
    if (matchingCity) return matchingCity.key;
    return catalog.countryCodes.flatMap(code => catalog.countries[code].locationKeys)[0] || exact;
  }

  function updateCatalog(records = [], { dispatch = true } = {}) {
    catalogRecords = Array.isArray(records) ? records.map(Catalog.canonicalLocation) : [];
    catalog = Catalog.buildCatalog(catalogRecords, DISPLAY_OVERRIDES);
    const previousKey = activeLocationKey;

    if (!catalog.locations[activeLocationKey]) {
      const storedCity = String(localStorage.getItem(CITY_STORAGE_KEY) || '').trim();
      const storedCode = String(localStorage.getItem(COUNTRY_STORAGE_KEY) || '').trim().toUpperCase();
      const storedKey = Catalog.locationKey(storedCode, storedCity);
      const storedCityMatch = Object.values(catalog.locations).find(location => location.city === storedCity);
      activeLocationKey = catalog.locations[storedKey]
        ? storedKey
        : storedCityMatch?.key || catalog.countryCodes.flatMap(code => catalog.countries[code].locationKeys)[0];
    }

    if (activeLocationKey && catalog.locations[activeLocationKey]) applyActiveConfig(catalog.locations[activeLocationKey], { persist: false });
    renderCountryList();
    syncCitySelector();
    refreshEnhancedForms();
    updateDocumentMetadata();

    if (dispatch) {
      window.dispatchEvent(new CustomEvent('coffee-map:catalog-change', { detail: { catalog } }));
      if (previousKey !== activeLocationKey) dispatchCityChange();
    }
    return catalog;
  }

  function normalizeLocationFields(raw = {}) {
    return Catalog.canonicalLocation(raw);
  }

  function getLocation(city = activeCity, countryCode = '') {
    const code = String(countryCode || '').trim().toUpperCase();
    if (code) return catalog.locations[Catalog.locationKey(code, city)] || null;
    const activeMatch = catalog.locations[Catalog.locationKey(activeCountryCode, city)];
    return activeMatch || Object.values(catalog.locations).find(location => location.city === city) || null;
  }

  function getCity(city = activeCity, countryCode = '') {
    return getLocation(city, countryCode);
  }

  function cityCompatibilityIndex() {
    return Object.values(catalog.locations).reduce((index, location) => {
      if (!index[location.city] || location.countryCode === activeCountryCode) index[location.city] = location;
      return index;
    }, {});
  }

  function countryCodeFor(location = activeConfig) {
    if (location && typeof location === 'object') return String(location.country_code || location.countryCode || '').trim().toUpperCase();
    return getLocation(String(location || ''))?.countryCode || activeCountryCode;
  }

  function getMapProvider(location = activeConfig) {
    return Catalog.providerForCountryCode(countryCodeFor(location));
  }

  function getMapField(location = activeConfig) {
    return PROVIDERS[getMapProvider(location)].field;
  }

  function applyMapProviderRule(target, location = target || activeConfig) {
    const provider = getMapProvider(location);
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
      return host === 'maps.app.goo.gl' || (host === 'goo.gl' && url.pathname.startsWith('/maps')) || googleHost;
    } catch (_) {
      return false;
    }
  }

  function patchMapDefaults() {
    const BaseMap = window.maplibregl?.Map;
    if (!BaseMap || BaseMap.__coffeeMapCityAware) return;
    class CityAwareMap extends BaseMap {
      constructor(options = {}) {
        const camera = activeConfig?.camera;
        super({ ...options, ...(camera || {}), minZoom: 0 });
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
      let requestedCity = '';
      let requestedCountryCode = '';
      try {
        const url = new URL(requestUrl, window.location.href);
        requestedCity = url.searchParams.get('city') || '';
        requestedCountryCode = (url.searchParams.get('country_code') || '').toUpperCase();
      } catch (_) {}
      try {
        const payload = await response.clone().json();
        if (Array.isArray(payload.shops)) {
          payload.shops = payload.shops.map(normalizeLocationFields);
          if (requestedCity) payload.shops = payload.shops.filter(shop => shop.city === requestedCity
            && (!requestedCountryCode || shop.country_code === requestedCountryCode));
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

  function applyActiveConfig(config, { persist = true } = {}) {
    activeConfig = config;
    activeLocationKey = config.key;
    activeCity = config.city;
    activeCountryCode = config.countryCode;
    if (!persist) return;
    localStorage.setItem(CITY_STORAGE_KEY, activeCity);
    localStorage.setItem(COUNTRY_STORAGE_KEY, activeCountryCode);
    localStorage.setItem(COUNTRY_CITY_STORAGE_PREFIX + activeCountryCode, activeCity);
  }

  function setActiveLocation(key) {
    const config = catalog.locations[key];
    if (!config) return false;
    const sheet = document.querySelector('#countrySheet');
    if (key === activeLocationKey) {
      if (sheet) closeSheet(sheet);
      return true;
    }
    applyActiveConfig(config);
    syncCitySelector();
    renderRegionRail([], '全部');
    refreshEnhancedForms();
    updateDocumentMetadata();
    if (sheet) closeSheet(sheet);
    dispatchCityChange();
    return true;
  }

  function setActiveCity(city, countryCode = '') {
    const location = getLocation(city, countryCode);
    return location ? setActiveLocation(location.key) : false;
  }

  function setActiveCountry(countryCode) {
    const country = catalog.countries[String(countryCode || '').toUpperCase()];
    if (!country?.locationKeys.length) return false;
    const rememberedCity = localStorage.getItem(COUNTRY_CITY_STORAGE_PREFIX + country.code);
    const targetKey = Catalog.preferredLocationKey(catalog, country.code, rememberedCity);
    return setActiveLocation(targetKey);
  }

  function citiesForCountry(countryCode = activeCountryCode) {
    const country = catalog.countries[String(countryCode || '').toUpperCase()];
    return country ? country.locationKeys.map(key => catalog.locations[key].city) : [];
  }

  function dispatchCityChange() {
    window.dispatchEvent(new CustomEvent('coffee-map:city-change', {
      detail: { city: activeCity, countryCode: activeCountryCode, locationKey: activeLocationKey, config: activeConfig }
    }));
  }

  function installCitySelector() {
    const button = document.querySelector('#cityButton');
    if (!button || document.querySelector('#countrySheet')) return;
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', 'countrySheet');
    const sheet = document.createElement('div');
    sheet.id = 'countrySheet';
    sheet.className = 'sheet';
    sheet.setAttribute('aria-hidden', 'true');
    sheet.innerHTML = `<div class="sheet-backdrop" data-close-country></div><article class="sheet-card compact-card city-sheet-card"><div class="sheet-grabber"></div><div class="sheet-title-row"><div><p class="list-kicker">Countries & Regions</p><h2>选择国家／地区</h2></div><button class="sheet-close" type="button" data-close-country aria-label="关闭"><svg class="material-symbol" viewBox="0 0 960 960"><use href="#ms-close"/></svg></button></div><div id="countryList" class="city-list"></div></article>`;
    document.body.appendChild(sheet);
    renderCountryList();
    syncCitySelector();
    button.addEventListener('click', () => openSheet(sheet));
    sheet.querySelectorAll('[data-close-country]').forEach(node => node.addEventListener('click', () => closeSheet(sheet)));
    sheet.querySelector('#countryList')?.addEventListener('click', event => {
      const cityOption = event.target.closest('[data-location-key]');
      if (cityOption) return setActiveLocation(cityOption.dataset.locationKey);
      const countryOption = event.target.closest('[data-country-code]');
      if (countryOption) setActiveCountry(countryOption.dataset.countryCode);
    });
  }

  function renderCountryList() {
    const list = document.querySelector('#countryList');
    if (!list) return;
    list.innerHTML = catalog.countryCodes.map(code => {
      const country = catalog.countries[code];
      const cityRows = country.locationKeys.length > 1
        ? `<div class="country-city-list">${country.locationKeys.map(key => {
          const location = catalog.locations[key];
          return `<button class="city-option country-city-option" type="button" data-location-key="${escapeHtml(key)}"><span><strong>${escapeHtml(location.label)}</strong>${location.localLabel ? `<small>${escapeHtml(location.localLabel)}</small>` : ''}</span><b aria-hidden="true"></b></button>`;
        }).join('')}</div>`
        : '';
      return `<section class="country-option-group"><button class="city-option country-option" type="button" data-country-code="${escapeHtml(code)}"><span><strong>${escapeHtml(country.label)}</strong><small>${escapeHtml(country.localLabel || code)}</small></span><b aria-hidden="true"></b></button>${cityRows}</section>`;
    }).join('');
  }

  function syncCitySelector() {
    const country = catalog.countries[activeCountryCode];
    const label = document.querySelector('[data-country-label]');
    if (label) label.textContent = country?.label || activeConfig?.country || 'Coffee Shops';
    document.querySelectorAll('#countryList [data-country-code]').forEach(option => {
      const selected = option.dataset.countryCode === activeCountryCode;
      option.classList.toggle('active', selected);
      option.setAttribute('aria-current', selected ? 'true' : 'false');
      setCheckmark(option, selected && (country?.locationKeys.length || 0) === 1);
    });
    document.querySelectorAll('#countryList [data-location-key]').forEach(option => {
      const selected = option.dataset.locationKey === activeLocationKey;
      option.classList.toggle('active', selected);
      option.setAttribute('aria-current', selected ? 'true' : 'false');
      setCheckmark(option, selected);
    });
  }

  function setCheckmark(option, selected) {
    const mark = option.querySelector('b');
    if (mark) mark.innerHTML = selected
      ? '<svg class="material-symbol" viewBox="0 0 960 960"><use href="#ms-check"/></svg>'
      : '';
  }

  function renderRegionRail(shops = [], activeRegion = '全部') {
    const rail = document.querySelector('#regionFilters');
    if (!rail) return;
    const cityShops = Array.isArray(shops)
      ? shops.filter(shop => shop.city === activeCity && String(shop.country_code || '').toUpperCase() === activeCountryCode)
      : [];
    const regions = Catalog.orderedValues(cityShops.map(shop => shop.region), activeConfig?.regionOrder || []);
    const count = cityShops.length ? cityShops.length : '—';
    const cityLabel = activeConfig?.localLabel || activeConfig?.label || activeCity;
    rail.innerHTML = `<button class="chip city-area-chip${activeRegion === '全部' ? ' active' : ''}" id="districtButton" type="button"><span class="city-area-label">${escapeHtml(cityLabel)}</span> <span id="allCount">${count}</span><svg class="material-symbol" viewBox="0 0 960 960" aria-hidden="true"><use href="#ms-expand-more"/></svg></button>${regions.map(region => `<button class="chip${activeRegion === region ? ' active' : ''}" data-region="${escapeHtml(region)}">${escapeHtml(region)}</button>`).join('')}`;
  }

  function enhanceAddForm() {
    const form = document.querySelector('#addForm');
    if (!form) return;
    enhanceLocationFields(form, activeConfig);
    const parseState = document.querySelector('#parseState');
    if (!parseState) return;
    new MutationObserver(() => {
      if (parseState.classList.contains('success')) syncFormLocation(form, readFormLocation(form));
    }).observe(parseState, { childList: true, attributes: true, subtree: true });
  }

  function watchForEditForm() {
    const enhanceExisting = () => {
      const form = document.querySelector('#editPlaceForm');
      if (form) enhanceLocationFields(form, activeConfig);
    };
    enhanceExisting();
    new MutationObserver(enhanceExisting).observe(document.body, { childList: true, subtree: true });
  }

  function enhanceLocationFields(form, defaultLocation) {
    if (form.dataset.multicityEnhanced === 'true') return;
    const districtLabel = form.elements.district?.closest('label');
    const regionField = form.elements.region;
    const regionLabel = regionField?.closest('label');
    if (!districtLabel || !regionField || !regionLabel) return;
    const cityLabel = document.createElement('label');
    cityLabel.innerHTML = `<span>城市 *</span><select name="city" required>${cityOptions(defaultLocation?.city)}</select>`;
    const countryLabel = document.createElement('label');
    countryLabel.innerHTML = `<span>国家／地区</span><input name="country" type="text" readonly value="${escapeHtml(defaultLocation?.country || '')}" />`;
    districtLabel.parentNode.insertBefore(cityLabel, districtLabel);
    districtLabel.parentNode.insertBefore(countryLabel, districtLabel);
    if (!form.elements.country_code) {
      const countryCodeInput = document.createElement('input');
      countryCodeInput.type = 'hidden';
      countryCodeInput.name = 'country_code';
      form.appendChild(countryCodeInput);
    }
    const regionSelect = document.createElement('select');
    regionSelect.name = 'region';
    regionSelect.required = true;
    regionField.replaceWith(regionSelect);
    form.dataset.multicityEnhanced = 'true';
    syncFormLocation(form, defaultLocation);
    cityLabel.querySelector('select').addEventListener('change', event => {
      const option = event.currentTarget.selectedOptions[0];
      syncFormLocation(form, getLocation(event.currentTarget.value, option?.dataset.countryCode), { clearRegion: true });
    });
  }

  function syncFormLocation(form, locationInput = activeConfig, { clearRegion = false } = {}) {
    if (!form) return;
    const inputIsObject = locationInput && typeof locationInput === 'object';
    const supplied = inputIsObject ? Catalog.canonicalLocation({
      ...locationInput,
      country_code: locationInput.country_code || locationInput.countryCode
    }) : null;
    const location = supplied && Catalog.isCompleteLocation(supplied)
      ? getLocation(supplied.city, supplied.country_code) || transientLocation(supplied)
      : getLocation(String(locationInput || '')) || activeConfig;
    if (!location) return;
    const citySelect = form.elements.city;
    const countryInput = form.elements.country;
    const countryCodeInput = form.elements.country_code;
    const regionSelect = form.elements.region;
    const currentRegion = clearRegion ? '' : String(supplied?.region || regionSelect?.value || '');
    if (citySelect) {
      citySelect.innerHTML = cityOptions(location.city, location.countryCode);
      let targetOption = [...citySelect.options].find(option => option.value === location.city
        && option.dataset.countryCode === location.countryCode);
      if (!targetOption) {
        const option = document.createElement('option');
        option.value = location.city;
        option.dataset.countryCode = location.countryCode;
        option.textContent = location.label || location.city;
        citySelect.appendChild(option);
        targetOption = option;
      }
      targetOption.selected = true;
    }
    if (countryInput) countryInput.value = location.country;
    if (countryCodeInput) countryCodeInput.value = location.countryCode;
    if (regionSelect) fillRegionSelect(regionSelect, location, currentRegion);
    const regionLabel = regionSelect?.closest('label')?.querySelector('span');
    if (regionLabel) regionLabel.textContent = location.countryCode === 'HK' ? '大区 *' : '行政区 *';
    syncMapProviderFields(form, location);
  }

  function transientLocation(record) {
    const key = Catalog.locationKey(record.country_code, record.city);
    const enhancement = DISPLAY_OVERRIDES.cities[key] || {};
    return {
      key, city: record.city, label: enhancement.label || record.city,
      localLabel: enhancement.localLabel || '', country: record.country,
      countryCode: record.country_code, regions: record.region ? [record.region] : [],
      districts: record.district ? [record.district] : [], regionOrder: enhancement.regionOrder || [],
      provider: Catalog.providerForCountryCode(record.country_code), camera: enhancement.camera || null
    };
  }

  function syncMapProviderFields(form, location) {
    const activeProvider = getMapProvider(location);
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
    if (parseState && !parseState.classList.contains('success')) parseState.textContent = `粘贴具体 ${PROVIDERS[activeProvider].label} 商户链接后解析`;
  }

  function fillRegionSelect(select, location, selected = '') {
    if (!select || !location) return;
    const regions = Catalog.orderedValues([...(location.regions || []), selected], location.regionOrder || []);
    select.innerHTML = '<option value="">请选择</option>' + regions.map(region => `<option value="${escapeHtml(region)}">${escapeHtml(region)}</option>`).join('');
    select.value = selected || '';
  }

  function cityOptions(selectedCity = activeCity, selectedCountryCode = activeCountryCode) {
    const groups = catalog.countryCodes.map(code => {
      const country = catalog.countries[code];
      const options = country.locationKeys.map(key => {
        const location = catalog.locations[key];
        const selected = location.city === selectedCity && code === selectedCountryCode;
        return `<option value="${escapeHtml(location.city)}" data-country-code="${escapeHtml(code)}"${selected ? ' selected' : ''}>${escapeHtml(location.label)}</option>`;
      }).join('');
      return `<optgroup label="${escapeHtml(country.label)}">${options}</optgroup>`;
    }).join('');
    if (groups) return groups;
    return selectedCity ? `<option value="${escapeHtml(selectedCity)}" data-country-code="${escapeHtml(selectedCountryCode)}" selected>${escapeHtml(selectedCity)}</option>` : '';
  }

  function refreshEnhancedForms() {
    document.querySelectorAll('form[data-multicity-enhanced="true"]').forEach(form => {
      const current = readFormLocation(form);
      syncFormLocation(form, getLocation(current.city, current.country_code) || activeConfig);
    });
  }

  function patchDialogOpen() {
    const proto = window.HTMLDialogElement?.prototype;
    if (!proto || proto.showModal.__coffeeMapCityAware) return;
    const nativeShowModal = proto.showModal;
    const cityAwareShowModal = function (...args) {
      const form = this.querySelector('form');
      if (form?.dataset.multicityEnhanced === 'true') syncFormLocation(form, this.id === 'addDialog' ? activeConfig : readFormLocation(form));
      return nativeShowModal.apply(this, args);
    };
    cityAwareShowModal.__coffeeMapCityAware = true;
    proto.showModal = cityAwareShowModal;
  }

  function readFormLocation(form) {
    return {
      city: form.elements.city?.value, country: form.elements.country?.value,
      country_code: form.elements.country_code?.value, region: form.elements.region?.value,
      district: form.elements.district?.value, address: form.elements.address?.value,
      latitude: form.elements.latitude?.value, longitude: form.elements.longitude?.value
    };
  }

  function updateDocumentMetadata() {
    if (!activeConfig) return;
    document.documentElement.dataset.city = activeCity.toLowerCase().replace(/\s+/g, '-');
    document.documentElement.dataset.country = activeCountryCode.toLowerCase();
    const countryLabel = catalog.countries[activeCountryCode]?.label || activeConfig.country || 'Coffee Shops';
    document.title = `${countryLabel} · Coffee Shops`;
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', 'Coffee Shops');
  }

  function openSheet(sheet) {
    if (!sheet) return;
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden', 'false');
  }

  function closeSheet(sheet) {
    if (!sheet) return;
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }
})();
