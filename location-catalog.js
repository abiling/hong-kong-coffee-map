(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CoffeeMapLocationCatalog = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const UNKNOWN_LOCATION_KEY = 'unknown';

  function clean(value) {
    return String(value ?? '').trim();
  }

  function canonicalLocation(record = {}) {
    return {
      ...record,
      city: clean(record.city),
      country: clean(record.country),
      country_code: clean(record.country_code).toUpperCase(),
      region: clean(record.region),
      district: clean(record.district)
    };
  }

  function isCompleteLocation(record = {}) {
    const location = canonicalLocation(record);
    return Boolean(location.city && location.country && /^[A-Z]{2}$/.test(location.country_code));
  }

  function locationKey(countryCode, city) {
    const code = clean(countryCode).toUpperCase();
    const canonicalCity = clean(city);
    return code && canonicalCity ? `${code}::${canonicalCity}` : UNKNOWN_LOCATION_KEY;
  }

  function hasCoordinates(record = {}) {
    return Number.isFinite(Number(record.latitude)) && Number.isFinite(Number(record.longitude));
  }

  function uniqueSorted(values) {
    return [...new Set(values.map(clean).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hans'));
  }

  function orderedValues(values, preferred = []) {
    const actual = new Set(uniqueSorted(values));
    const ordered = preferred.map(clean).filter(value => actual.delete(value));
    return ordered.concat([...actual].sort((a, b) => a.localeCompare(b, 'zh-Hans')));
  }

  function boundsForShops(shops = []) {
    const points = shops.filter(hasCoordinates).map(shop => [Number(shop.longitude), Number(shop.latitude)]);
    if (!points.length) return null;
    const longitudes = points.map(point => point[0]);
    const latitudes = points.map(point => point[1]);
    return {
      points,
      west: Math.min(...longitudes),
      south: Math.min(...latitudes),
      east: Math.max(...longitudes),
      north: Math.max(...latitudes)
    };
  }

  function providerForCountryCode(countryCode) {
    return clean(countryCode).toUpperCase() === 'CN' ? 'apple' : 'google';
  }

  function preferredLocationKey(catalog, countryCode, rememberedCity = '') {
    const code = clean(countryCode).toUpperCase();
    const country = catalog?.countries?.[code];
    if (!country?.locationKeys?.length) return '';
    const rememberedKey = locationKey(code, rememberedCity);
    return country.locationKeys.includes(rememberedKey) ? rememberedKey : country.locationKeys[0];
  }

  function buildCatalog(records = [], overrides = {}) {
    const countryOverrides = overrides.countries || {};
    const cityOverrides = overrides.cities || {};
    const countries = {};
    const locations = {};
    const incomplete = [];

    records.forEach(source => {
      const shop = canonicalLocation(source);
      if (shop.active === false) return;
      if (!isCompleteLocation(shop)) {
        incomplete.push(shop);
        return;
      }

      const key = locationKey(shop.country_code, shop.city);
      if (!countries[shop.country_code]) {
        const enhancement = countryOverrides[shop.country_code] || {};
        countries[shop.country_code] = {
          code: shop.country_code,
          label: enhancement.label || shop.country,
          localLabel: enhancement.localLabel || '',
          canonicalCountry: shop.country,
          order: Number.isFinite(enhancement.order) ? enhancement.order : Number.MAX_SAFE_INTEGER,
          locationKeys: []
        };
      }

      if (!locations[key]) {
        const enhancement = cityOverrides[key] || {};
        locations[key] = {
          key,
          city: shop.city,
          label: enhancement.label || shop.city,
          localLabel: enhancement.localLabel || '',
          country: shop.country,
          countryCode: shop.country_code,
          order: Number.isFinite(enhancement.order) ? enhancement.order : Number.MAX_SAFE_INTEGER,
          regionOrder: Array.isArray(enhancement.regionOrder) ? enhancement.regionOrder.map(clean).filter(Boolean) : [],
          camera: enhancement.camera || null,
          shops: []
        };
        countries[shop.country_code].locationKeys.push(key);
      }
      locations[key].shops.push(shop);
    });

    Object.values(locations).forEach(location => {
      location.regions = orderedValues(location.shops.map(shop => shop.region), location.regionOrder);
      location.districts = uniqueSorted(location.shops.map(shop => shop.district));
      location.bounds = boundsForShops(location.shops);
      location.provider = providerForCountryCode(location.countryCode);
    });

    Object.values(countries).forEach(country => {
      country.locationKeys.sort((a, b) => {
        const left = locations[a];
        const right = locations[b];
        return left.order - right.order || left.label.localeCompare(right.label, 'en');
      });
      country.provider = providerForCountryCode(country.code);
    });

    const countryCodes = Object.keys(countries).sort((a, b) => {
      const left = countries[a];
      const right = countries[b];
      return left.order - right.order || left.label.localeCompare(right.label, 'en');
    });

    return { countries, locations, countryCodes, incomplete };
  }

  function shopsForLocation(records = [], countryCode, city) {
    const key = locationKey(countryCode, city);
    return records.map(canonicalLocation).filter(shop => isCompleteLocation(shop)
      && locationKey(shop.country_code, shop.city) === key);
  }

  return Object.freeze({
    UNKNOWN_LOCATION_KEY,
    boundsForShops,
    buildCatalog,
    canonicalLocation,
    hasCoordinates,
    isCompleteLocation,
    locationKey,
    orderedValues,
    preferredLocationKey,
    providerForCountryCode,
    shopsForLocation,
    uniqueSorted
  });
});
