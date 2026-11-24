/**
 * Coffee Shops Map API v7 — Dynamic Location Parser
 * Google Apps Script bound to the Coffee Shops database.
 *
 * Provider policy is defined at country/region level:
 * - Regions other than mainland China use Google Maps.
 * - Mainland China uses Apple Maps only.
 */

const CONFIG = Object.freeze({
  SPREADSHEET_ID: '1HL91cIBqeZI1V6kB4uElvxuomgrhfnqajDjTvFxaxcQ',
  SHEET_NAME: 'Coffee Shops',
  TIME_ZONE: 'Asia/Hong_Kong',
  HEADERS: [
    'id', 'google_maps', 'name', 'address', 'region', 'district',
    'latitude', 'longitude', 'apple_maps', 'category', 'status',
    'source', 'notes', 'created_at', 'updated_at', 'active', 'city', 'country', 'favorite',
    'country_code'
  ],
  COUNTRY_CONFIG: {
    'HK': {
      country: 'Hong Kong SAR', label: 'Hong Kong SAR', mapProvider: 'google',
      regionCode: 'hk', language: 'en'
    },
    'JP': {
      country: 'Japan', label: 'Japan', mapProvider: 'google',
      regionCode: 'jp', language: 'en'
    },
    'CN': {
      country: 'China', label: 'China', mapProvider: 'apple', sourceCoordinateSystem: 'gcj02'
    },
    'US': {
      country: 'United States', label: 'United States', mapProvider: 'google',
      regionCode: 'us', language: 'en'
    },
    'KR': {
      country: 'South Korea', label: 'South Korea', mapProvider: 'google',
      regionCode: 'kr', language: 'en'
    }
  },
  CITY_CONFIG: {
    'Hong Kong': {
      countryCode: 'HK', regionCode: 'hk', language: 'en', querySuffix: 'Hong Kong',
      bounds: { south: 22.13, west: 113.82, north: 22.57, east: 114.51 }
    },
    'Tokyo': {
      countryCode: 'JP', regionCode: 'jp', language: 'en', querySuffix: 'Tokyo, Japan',
      bounds: { south: 35.45, west: 139.35, north: 35.95, east: 140.10 }
    },
    'Beijing': {
      countryCode: 'CN', regionCode: 'cn', language: 'zh-CN', querySuffix: 'Beijing, China',
      bounds: { south: 39.40, west: 115.40, north: 41.10, east: 117.60 }
    }
  }
});

const COUNTRY_ALIASES = Object.freeze({
  'HK': 'HK',
  'HONG KONG': 'HK',
  'HONG KONG SAR': 'HK',
  'JP': 'JP',
  'JAPAN': 'JP',
  'CN': 'CN',
  'CHINA': 'CN',
  'MAINLAND CHINA': 'CN',
  '中国': 'CN',
  '中国内地': 'CN',
  'US': 'US',
  'USA': 'US',
  'UNITED STATES': 'US',
  'KR': 'KR',
  'KOREA': 'KR',
  'SOUTH KOREA': 'KR'
});

/**
 * One-time v6 migration.
 * Appends country_code without moving or overwriting existing columns, then
 * backfills the current Hong Kong, Tokyo and Beijing rows.
 */
function migrateToCountryRegionSchema() {
  return withWriteLock_(function () {
    const sheet = getSheet_();
    ensureCountryCodeHeader_(sheet);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
      .map(function (value) { return cleanText_(value); });
    const cityIndex = headers.indexOf('city');
    const countryIndex = headers.indexOf('country');
    const countryCodeIndex = headers.indexOf('country_code');
    if (cityIndex < 0 || countryIndex < 0 || countryCodeIndex < 0) {
      throw new Error('缺少 city、country 或 country_code 表头。');
    }

    const rowCount = Math.max(0, sheet.getLastRow() - 1);
    const report = { checked: rowCount, updated: 0, unresolved: [] };
    if (!rowCount) return report;

    const values = sheet.getRange(2, 1, rowCount, sheet.getLastColumn()).getValues();
    values.forEach(function (row, index) {
      const city = cleanText_(row[cityIndex]);
      const originalCountry = cleanText_(row[countryIndex]);
      const originalCode = normalizeCountryCode_(row[countryCodeIndex], originalCountry, city);
      const code = originalCode || countryCodeForCity_(city);
      const countryConfig = CONFIG.COUNTRY_CONFIG[code];

      if (!countryConfig) {
        report.unresolved.push({ row: index + 2, city: city, country: originalCountry });
        return;
      }

      let changed = false;
      if (cleanText_(row[countryCodeIndex]).toUpperCase() !== code) {
        row[countryCodeIndex] = code;
        changed = true;
      }
      if (cleanText_(row[countryIndex]) !== countryConfig.country) {
        row[countryIndex] = countryConfig.country;
        changed = true;
      }
      if (changed) report.updated++;
    });

    sheet.getRange(2, 1, rowCount, sheet.getLastColumn()).setValues(values);
    ensureHeaders_(sheet);
    console.log(JSON.stringify(report, null, 2));
    return report;
  });
}

/** Legacy migration. Adds city/country headers and backfills legacy Hong Kong rows. */
function migrateToMultiCitySchema() {
  const sheet = getSheet_();
  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  if (headers.indexOf('city') === -1) sheet.getRange(1, lastColumn + 1).setValue('city');
  const refreshedLastColumn = sheet.getLastColumn();
  const refreshedHeaders = sheet.getRange(1, 1, 1, refreshedLastColumn).getDisplayValues()[0];
  if (refreshedHeaders.indexOf('country') === -1) sheet.getRange(1, refreshedLastColumn + 1).setValue('country');
  const finalHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const cityColumn = finalHeaders.indexOf('city') + 1;
  const countryColumn = finalHeaders.indexOf('country') + 1;
  const rowCount = Math.max(0, sheet.getLastRow() - 1);
  if (rowCount) {
    const cities = sheet.getRange(2, cityColumn, rowCount, 1).getValues();
    const countries = sheet.getRange(2, countryColumn, rowCount, 1).getValues();
    for (let i = 0; i < rowCount; i++) {
      if (!cities[i][0]) cities[i][0] = 'Hong Kong';
      if (!countries[i][0] || countries[i][0] === 'Hong Kong') countries[i][0] = 'Hong Kong SAR';
    }
    sheet.getRange(2, cityColumn, rowCount, 1).setValues(cities);
    sheet.getRange(2, countryColumn, rowCount, 1).setValues(countries);
  }
  ensureHeaders_(sheet);
  console.log('Multi-city migration complete.');
}

/**
 * Run this once from the Apps Script editor.
 * It validates the sheet and creates a private administrator key.
 */
function setupProject() {
  const sheet = getSheet_();
  ensureHeaders_(sheet);

  const properties = PropertiesService.getScriptProperties();
  let adminKey = properties.getProperty('ADMIN_KEY');

  if (!adminKey) {
    adminKey = createSecureKey_();
    properties.setProperty('ADMIN_KEY', adminKey);
  }

  console.log('Setup complete.');
  console.log('ADMIN_KEY=' + adminKey);
  console.log('Keep this key private. Do not put it in the public GitHub repository.');
}

/**
 * Read-only audit. Run from the editor before deploying v6.
 * It reports provider-link and coordinate problems without changing the sheet.
 */
function auditMapProviderRules() {
  return auditCountryRegionSchema();
}

/** Read-only country/region, provider-link and coordinate audit. */
function auditCountryRegionSchema() {
  const shops = readShops_(false);
  const issues = [];

  shops.forEach(function (shop) {
    const city = cleanText_(shop.city) || inferCityFromCoordinates_(shop.latitude, shop.longitude);
    const code = getCountryCodeForShop_(shop);
    const countryConfig = CONFIG.COUNTRY_CONFIG[code];
    if (!/^[A-Z]{2}$/.test(code) || !city || !shop.country) {
      issues.push({ id: shop.id, name: shop.name, issue: 'incomplete_location', city: city, country_code: code });
      return;
    }
    if (cleanText_(shop.country_code).toUpperCase() !== code) {
      issues.push({ id: shop.id, name: shop.name, issue: 'missing_or_invalid_country_code', expected: code });
    }
    if (countryConfig && cleanText_(shop.country) !== countryConfig.country) {
      issues.push({ id: shop.id, name: shop.name, issue: 'country_name_mismatch', expected: countryConfig.country });
    }

    const requiredField = getMapFieldForShop_(shop);
    const blockedField = requiredField === 'apple_maps' ? 'google_maps' : 'apple_maps';
    if (!cleanText_(shop[requiredField])) {
      issues.push({ id: shop.id, name: shop.name, issue: 'missing_' + requiredField });
    } else {
      try {
        validateRequiredProviderLink_(shop);
      } catch (error) {
        issues.push({ id: shop.id, name: shop.name, issue: 'invalid_' + requiredField, detail: error.message });
      }
    }
    if (cleanText_(shop[blockedField])) {
      issues.push({ id: shop.id, name: shop.name, issue: 'legacy_' + blockedField, action: 'hidden_until_explicit_edit' });
    }

    const detectedCity = inferCityFromCoordinates_(shop.latitude, shop.longitude);
    if (detectedCity && detectedCity !== city) {
      issues.push({ id: shop.id, name: shop.name, issue: 'coordinate_city_mismatch', detectedCity: detectedCity });
    }
  });

  const report = { ok: issues.length === 0, checked: shops.length, issueCount: issues.length, issues: issues };
  console.log(JSON.stringify(report, null, 2));
  return report;
}

/** Read-only v6 provider, country and filter smoke test. */
function testV6CountryRegionRules() {
  const sample = 'https://maps.apple.com/place?address=Xiushui%20East%20Street%20No.1%20Embassy%20of%20the%20Cooperative%20Republic%20of%20Guyana%20Road%20Opposite,%20Chaoyang,%20Beijing%20China&coordinate=39.916336,116.449427&name=il%20gatto%20Coffee%20JL%20Gatto%20Caffe%20Coffee%20(Ritan%20Store)&place-id=H2710I3F94883AD1363&map=explore';
  const place = parseAppleMapsLink_(sample, 'Beijing', 'CN');
  if (place.city !== 'Beijing' || place.country !== 'China') throw new Error('Beijing city rule failed.');
  if (place.country_code !== 'CN') throw new Error('Country code rule failed.');
  if (!place.apple_maps || place.google_maps) throw new Error('Beijing provider field rule failed.');
  if (place.region !== '朝阳区' || place.district !== '日坛') throw new Error('Beijing area inference failed.');
  if (Math.abs(place.latitude - 39.9149684) > 0.00002 || Math.abs(place.longitude - 116.4432319) > 0.00002) {
    throw new Error('Beijing coordinate conversion failed.');
  }
  const sampleRows = [
    { city: 'Tokyo', country: 'Japan', country_code: 'JP', active: true },
    { city: 'Osaka', country: 'Japan', country_code: 'JP', active: true },
    { city: 'Beijing', country: 'China', country_code: 'CN', active: true }
  ];
  if (filterShops_(sampleRows, { country_code: 'JP', city: '' }).length !== 2) {
    throw new Error('Country list filter failed.');
  }
  if (filterShops_(sampleRows, { country_code: 'JP', city: 'Tokyo' }).length !== 1) {
    throw new Error('City list filter failed.');
  }
  console.log(JSON.stringify(place, null, 2));
  return { ok: true, place: place };
}

/** Public read-only API. */
function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || 'list').toLowerCase();

    if (action === 'health') {
      return jsonOutput_({
        ok: true,
        service: 'Coffee Shops Map API',
        version: 7,
        time: nowIso_()
      });
    }

    if (action === 'list') {
      const parameters = (e && e.parameter) || {};
      const filters = {
        country_code: normalizeCountryCode_(parameters.country_code || parameters.country, '', ''),
        city: cleanText_(parameters.city)
      };
      const shops = filterShops_(readShops_(true), filters);
      return jsonOutput_({
        ok: true,
        count: shops.length,
        filters: filters,
        updated_at: latestUpdatedAt_(shops),
        shops: shops
      });
    }

    return jsonOutput_({ ok: false, error: 'Unknown GET action.' });
  } catch (error) {
    return errorOutput_(error);
  }
}

/** Private write API. Send JSON as text/plain from the GitHub Pages app. */
function doPost(e) {
  try {
    const request = parseRequestBody_(e);
    requireAdminKey_(request.adminKey);

    const action = String(request.action || '').toLowerCase();
    const data = request.data || {};

    switch (action) {
      case 'parse':
        return jsonOutput_({ ok: true, place: parseMapLink_(data) });

      case 'add':
        return jsonOutput_({ ok: true, shop: addShop_(data) });

      case 'update':
        return jsonOutput_({ ok: true, shop: updateShop_(data) });

      case 'setstatus':
        return jsonOutput_({ ok: true, shop: setStatus_(data) });

      case 'setfavorite':
        return jsonOutput_({ ok: true, shop: setFavorite_(data) });

      case 'archive':
        return jsonOutput_({ ok: true, shop: archiveShop_(data) });

      default:
        return jsonOutput_({ ok: false, error: 'Unknown POST action.' });
    }
  } catch (error) {
    return errorOutput_(error);
  }
}

function parseMapLink_(data) {
  data = data || {};
  // hint_city / hint_country_code and older city / country_code are optional
  // parse hints. Do not use them to constrain or supply a canonical location.
  const apple = cleanText_(data.apple_maps);
  const google = cleanText_(data.google_maps);
  if (Boolean(apple) === Boolean(google)) throw new Error('请只提交一个地图商户链接。');
  return apple ? parseAppleMapsLink_(apple) : parseGoogleMapsLink_(google);
}

function parseGoogleMapsLink_(url) {
  validateGoogleMapsUrl_(url);
  const resolved = resolveRedirects_(url, validateGoogleMapsUrl_);
  const name = extractPlaceName_(resolved) || extractPlaceName_(url);
  let point = extractCoordinates_(resolved) || extractCoordinates_(url);
  const forward = !point && name ? geocodePlaceName_(name) : null;
  if (forward) point = geocoderPoint_(forward);
  if (!validPoint_(point)) throw new Error('无法确定商户坐标，请提供具体商户链接。');
  const result = reverseGeocode_(point.latitude, point.longitude);
  const location = canonicalLocation_(result);
  if (forward) {
    const check = canonicalLocation_(forward);
    if (check.city !== location.city || check.country_code !== location.country_code) throw new Error('名称与坐标归属不一致。');
  }
  requireCountryProvider_(location.country_code, 'google');
  const place = makeParsedPlace_(location, result, point, name || extractPremiseName_(result), result.formatted_address);
  return Object.assign(place, {google_maps:url, resolved_google_maps:resolved,
    parse_method:forward ? 'global_name_geocoding' : 'url_coordinates_reverse_geocoding'});
}

function parseAppleMapsLink_(url) {
  validateAppleMapsUrl_(url);
  const resolved = resolveRedirects_(url, validateAppleMapsUrl_);
  const source = extractAppleCoordinates_(resolved) || extractAppleCoordinates_(url);
  if (!validPoint_(source)) throw new Error('Apple Maps 商户链接缺少有效坐标。');
  const name = extractAppleTextParameter_(resolved,url,'name');
  const address = extractAppleTextParameter_(resolved,url,'address');
  if (!name) throw new Error('Apple Maps 商户链接缺少店铺名称。');
  const china = /(?:\bChina|中国|中國)[\s,，]*$/i.test(address) &&
    !/(?:Hong Kong|Macao|Macau|Taiwan|香港|澳门|澳門|台湾|臺灣)/i.test(address);
  if (!china) {
    // Discover jurisdiction first when the URL does not identify mainland China.
    requireCountryProvider_(canonicalLocation_(reverseGeocode_(source.latitude,source.longitude)).country_code,'apple');
  }
  const point = gcj02ToWgs84_(source.latitude,source.longitude);
  const result = reverseGeocode_(point.latitude,point.longitude);
  const location = canonicalLocation_(result);
  requireCountryProvider_(location.country_code,'apple');
  const place = makeParsedPlace_(location,result,point,name,address || result.formatted_address);
  return Object.assign(place,{apple_maps:url,resolved_apple_maps:resolved,
    parse_method:'apple_place_gcj02_to_wgs84_reverse_geocoding',
    source_coordinate:{latitude:roundCoordinate_(source.latitude),longitude:roundCoordinate_(source.longitude),system:'GCJ-02'}});
}

function validPoint_(p) {
  return Boolean(p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
    && Math.abs(p.latitude)<=90 && Math.abs(p.longitude)<=180);
}

function makeParsedPlace_(location,result,point,name,address) {
  address = cleanText_(address);
  let region = addressComponent_(result,['sublocality_level_1','administrative_area_level_2','administrative_area_level_1']);
  let district = addressComponent_(result,['sublocality_level_2','sublocality_level_3','neighborhood','sublocality','route']);
  const known = (value,fallback) => value && value !== '待确认' ? value : fallback;
  if (location.country_code === 'HK') {
    district = known(inferDistrict_(address),district);
    region = known(inferRegion_(district),region);
  } else if (location.country_code === 'JP' && location.city === 'Tokyo') {
    region = known(inferTokyoRegion_(result,address),region);
    district = known(inferTokyoDistrict_(result,address),district);
  } else if (location.country_code === 'CN' && location.city === 'Beijing') {
    region = known(inferBeijingRegion_(address),region);
    district = known(inferBeijingDistrict_(name,address),district);
  }
  return Object.assign({google_maps:'',apple_maps:'',name,address,region,district,
    latitude:roundCoordinate_(point.latitude),longitude:roundCoordinate_(point.longitude),
    category:'',status:'想去',source:'',notes:'',active:true,needs_review:true},location);
}

function addShop_(input) {
  const inputCity = cleanText_(input.city);
  const inputCode = normalizeCountryCode_(input.country_code, input.country, inputCity);
  if (!inputCity || !inputCode) throw new Error('请选择国家／地区和城市。');
  const parsed = parseMapLink_(input);
  if (inputCity !== parsed.city || inputCode !== parsed.country_code) throw new Error('地点归属与链接不一致，请重新解析。');
  const shop = normalizeShopInput_(Object.assign({}, parsed, input, {
    city:parsed.city,country:parsed.country,country_code:parsed.country_code
  }));

  applyMapProviderRule_(shop);
  validateShop_(shop);

  const duplicate = findDuplicate_(shop);
  if (duplicate) {
    throw new Error('这个地点可能已经存在：' + duplicate.name + '（' + duplicate.district + '）');
  }

  const now = nowIso_();
  shop.id = createShopId_(shop.city);
  shop.created_at = now;
  shop.updated_at = now;
  shop.active = true;

  withWriteLock_(function () {
    const sheet = getSheet_();
    sheet.appendRow(CONFIG.HEADERS.map(function (header) {
      return safeSheetValue_(shop[header]);
    }));
  });

  return shop;
}

function updateShop_(input) {
  const id = String(input.id || '').trim();
  if (!id) throw new Error('Missing shop id.');

  return withWriteLock_(function () {
    const sheet = getSheet_();
    const table = readSheetTable_(sheet);
    const rowIndex = findRowIndexById_(table, id);
    if (rowIndex < 0) throw new Error('Shop not found.');

    const current = rowToObject_(table.headers, table.rows[rowIndex]);
    const allowedFields = [
      'google_maps', 'name', 'address', 'region', 'district', 'latitude',
      'longitude', 'apple_maps', 'category', 'status', 'source', 'notes', 'active',
      'city', 'country', 'favorite', 'country_code'
    ];

    allowedFields.forEach(function (field) {
      if (Object.prototype.hasOwnProperty.call(input, field)) {
        current[field] = input[field];
      }
    });

    const updated = normalizeShopInput_(current);
    updated.id = id;
    updated.created_at = current.created_at;
    updated.updated_at = nowIso_();
    if (hasMapProviderEdit_(input)) applyMapProviderRule_(updated);
    validateShop_(updated);

    sheet.getRange(rowIndex + 2, 1, 1, CONFIG.HEADERS.length)
      .setValues([CONFIG.HEADERS.map(function (header) {
        return safeSheetValue_(updated[header]);
      })]);

    return updated;
  });
}

function setStatus_(input) {
  const status = String(input.status || '').trim();
  if (['想去', '优先去', '去过'].indexOf(status) === -1) {
    throw new Error('Invalid status.');
  }
  return updateShop_({ id: input.id, status: status });
}

function setFavorite_(input) {
  return updateShop_({ id: input.id, favorite: toBoolean_(input.favorite, false) });
}

function archiveShop_(input) {
  return updateShop_({ id: input.id, active: false });
}

function readShops_(activeOnly) {
  const table = readSheetTable_(getSheet_());

  return table.rows
    .filter(function (row) {
      return row.some(function (value) { return value !== '' && value !== null; });
    })
    .map(function (row) {
      return normalizeShopOutput_(rowToObject_(table.headers, row));
    })
    .filter(function (shop) {
      return !activeOnly || shop.active;
    });
}

function filterShops_(shops, filters) {
  const code = normalizeCountryCode_(filters && filters.country_code, '', '');
  const city = cleanText_(filters && filters.city);
  return shops.filter(function (shop) {
    if (code && getCountryCodeForShop_(shop) !== code) return false;
    if (city && cleanText_(shop.city).toLowerCase() !== city.toLowerCase()) return false;
    return true;
  });
}

function readSheetTable_(sheet) {
  ensureHeaders_(sheet);
  const values = sheet.getDataRange().getValues();
  if (!values.length) return { headers: [], rows: [] };

  return {
    headers: values[0].map(function (value) { return String(value).trim(); }),
    rows: values.slice(1)
  };
}

function normalizeShopInput_(input) {
  const latitude = toNumber_(input.latitude);
  const longitude = toNumber_(input.longitude);
  const name = cleanText_(input.name);
  const city = cleanText_(input.city);
  const countryCode = normalizeCountryCode_(
    input.country_code,
    input.country,
    city
  );
  const countryConfig = CONFIG.COUNTRY_CONFIG[countryCode] || null;

  return {
    id: cleanText_(input.id),
    google_maps: cleanText_(input.google_maps),
    name: name,
    address: cleanText_(input.address),
    region: cleanText_(input.region) || (city === 'Hong Kong' ? inferRegion_(cleanText_(input.district)) : ''),
    district: cleanText_(input.district),
    latitude: latitude,
    longitude: longitude,
    apple_maps: cleanText_(input.apple_maps),
    category: cleanText_(input.category),
    status: cleanText_(input.status) || '想去',
    source: cleanText_(input.source),
    notes: cleanText_(input.notes),
    created_at: cleanText_(input.created_at),
    updated_at: cleanText_(input.updated_at),
    active: toBoolean_(input.active, true),
    city: city,
    country: cleanText_(input.country) || (countryConfig ? countryConfig.country : ''),
    favorite: toBoolean_(input.favorite, false),
    country_code: countryCode
  };
}
function normalizeShopOutput_(shop) {
  shop.latitude = toNumber_(shop.latitude);
  shop.longitude = toNumber_(shop.longitude);
  shop.active = toBoolean_(shop.active, false);
  shop.favorite = toBoolean_(shop.favorite, false);
  shop.country_code = normalizeCountryCode_(shop.country_code, shop.country, shop.city);
  const countryConfig = CONFIG.COUNTRY_CONFIG[shop.country_code];
  if (!cleanText_(shop.country) && countryConfig) shop.country = countryConfig.country;
  return shop;
}

function validateShop_(shop) {
  if (!shop.name) throw new Error('店铺名称不能为空。');
  if (!shop.address) throw new Error('店铺地址不能为空。');
  if (!validPoint_({latitude:shop.latitude,longitude:shop.longitude})) {
    throw new Error('缺少有效的经纬度。');
  }
  if (!shop.city) throw new Error('城市不能为空。');
  if (!shop.country || !/^[A-Z]{2}$/.test(shop.country_code)) throw new Error('请确认国家／地区与代码。');
  validateRequiredProviderLink_(shop);
  if (!shop.region) throw new Error('请选择大区／行政区。');
  if (!shop.district) throw new Error('请填写具体地区。');
  if (['想去', '优先去', '去过'].indexOf(shop.status) === -1) {
    throw new Error('状态必须是：想去、优先去或去过。');
  }
}
function findDuplicate_(candidate) {
  const shops = readShops_(false);
  const mapField = getMapFieldForShop_(candidate);
  const normalizedUrl = normalizeUrl_(candidate[mapField]);
  const normalizedName = normalizeName_(candidate.name);

  for (let i = 0; i < shops.length; i++) {
    const existing = shops[i];

    if (normalizedUrl && normalizeUrl_(existing[mapField]) === normalizedUrl) {
      return existing;
    }

    if (normalizedName && normalizeName_(existing.name) === normalizedName) {
      const distance = haversineMeters_(
        candidate.latitude,
        candidate.longitude,
        existing.latitude,
        existing.longitude
      );
      if (distance < 100) return existing;
    }
  }

  return null;
}

function resolveRedirects_(url, validator) {
  let current = url;

  for (let i = 0; i < 8; i++) {
    if (validator) validator(current);
    const response = UrlFetchApp.fetch(current, {
      method: 'get',
      followRedirects: false,
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CoffeeShopsMap/4.0)'
      }
    });

    const status = response.getResponseCode();
    const headers = response.getAllHeaders();
    const location = headers.Location || headers.location;

    if (status >= 300 && status < 400 && location) {
      current = resolveRelativeUrl_(current, String(location));
      continue;
    }

    break;
  }

  if (validator) validator(current);
  return current;
}

function resolveRelativeUrl_(baseUrl, location) {
  if (/^https?:\/\//i.test(location)) return location;
  if (/^\/\//.test(location)) return 'https:' + location;

  const originMatch = baseUrl.match(/^(https?:\/\/[^/]+)/i);
  const origin = originMatch ? originMatch[1] : '';

  if (location.charAt(0) === '/') return origin + location;

  return baseUrl.replace(/[^/]*$/, '') + location;
}

function extractCoordinates_(url) {
  const candidates = [url, safeDecode_(url)];

  // @lat,lng and ll/center are viewport coordinates, not merchant pins.
  const patterns = [
    /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
    /[?&](?:query|q)=(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)(?=[&#]|$)/i
  ];

  for (let i = 0; i < candidates.length; i++) {
    for (let j = 0; j < patterns.length; j++) {
      const match = candidates[i].match(patterns[j]);
      if (match) {
        return {
          latitude: Number(match[1]),
          longitude: Number(match[2])
        };
      }
    }
  }

  return null;
}

function extractPlaceName_(url) {
  const decodedUrl = safeDecode_(url);
  const placeMatch = decodedUrl.match(/\/(?:maps\/)?place\/([^/?#]+)/i);

  if (placeMatch) {
    return cleanPlaceName_(placeMatch[1]);
  }

  const query = getQueryParameter_(decodedUrl, 'query') || getQueryParameter_(decodedUrl, 'q');
  if (query && !/^\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*$/.test(query)) {
    return cleanPlaceName_(query);
  }

  return '';
}

function cleanPlaceName_(value) {
  return safeDecode_(String(value || ''))
    .replace(/\+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getQueryParameter_(url, name) {
  const match = url.match(new RegExp('[?&]' + name + '=([^&#]+)', 'i'));
  return match ? safeDecode_(match[1].replace(/\+/g, ' ')) : '';
}

function extractAppleCoordinates_(url) {
  const value = getQueryParameter_(url, 'coordinate') ||
    getQueryParameter_(url, 'll') ||
    getQueryParameter_(url, 'center');
  const match = String(value || '').match(/^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  return isFinite(latitude) && isFinite(longitude) ? { latitude: latitude, longitude: longitude } : null;
}

function extractAppleTextParameter_(resolvedUrl, originalUrl, name) {
  return cleanText_(getQueryParameter_(resolvedUrl, name) || getQueryParameter_(originalUrl, name));
}

function inferBeijingRegion_(address) {
  const text = String(address || '').toLowerCase();
  const districts = [
    ['东城区', ['东城区', 'dongcheng']], ['西城区', ['西城区', 'xicheng']],
    ['朝阳区', ['朝阳区', 'chaoyang']], ['海淀区', ['海淀区', 'haidian']],
    ['丰台区', ['丰台区', 'fengtai']], ['石景山区', ['石景山区', 'shijingshan']],
    ['通州区', ['通州区', 'tongzhou']], ['昌平区', ['昌平区', 'changping']],
    ['大兴区', ['大兴区', 'daxing']], ['顺义区', ['顺义区', 'shunyi']],
    ['房山区', ['房山区', 'fangshan']], ['门头沟区', ['门头沟区', 'mentougou']],
    ['怀柔区', ['怀柔区', 'huairou']], ['平谷区', ['平谷区', 'pinggu']],
    ['密云区', ['密云区', 'miyun']], ['延庆区', ['延庆区', 'yanqing']]
  ];
  for (let i = 0; i < districts.length; i++) {
    if (districts[i][1].some(function (alias) { return text.indexOf(alias.toLowerCase()) !== -1; })) {
      return districts[i][0];
    }
  }
  return '待确认';
}

function inferBeijingDistrict_(name, address) {
  const text = (String(name || '') + ' ' + String(address || '')).toLowerCase();
  const areas = [
    ['日坛', ['日坛', 'ritan']], ['三里屯', ['三里屯', 'sanlitun']],
    ['国贸', ['国贸', 'guomao', 'cbd']], ['望京', ['望京', 'wangjing']],
    ['亮马桥', ['亮马桥', 'liangmaqiao']], ['建国门', ['建国门', 'jianguomen']],
    ['鼓楼', ['鼓楼', 'gulou']], ['南锣鼓巷', ['南锣鼓巷', 'nanluoguxiang']],
    ['五道营', ['五道营', 'wudaoying']], ['什刹海', ['什刹海', 'shichahai']],
    ['五道口', ['五道口', 'wudaokou']], ['中关村', ['中关村', 'zhongguancun']]
  ];
  for (let i = 0; i < areas.length; i++) {
    if (areas[i][1].some(function (alias) { return text.indexOf(alias.toLowerCase()) !== -1; })) {
      return areas[i][0];
    }
  }
  return '待确认';
}

function geocoderResults_(response) {
  if (!response || (response.status && !['OK','ZERO_RESULTS'].includes(response.status))) {
    throw new Error('地理编码暂不可用或配额不足。');
  }
  return Array.isArray(response.results) ? response.results : [];
}

function geocoderPoint_(result) {
  const point = result && result.geometry && result.geometry.location;
  return point && {latitude:point.lat,longitude:point.lng};
}

function canonicalLocation_(result) {
  const country = ((result && result.address_components) || []).find(x=>(x.types || []).includes('country'));
  const code = cleanText_(country && country.short_name).toUpperCase();
  const name = cleanText_(country && country.long_name);
  if (!/^[A-Z]{2}$/.test(code) || !name) throw new Error('无法可靠确定国家／地区。');
  const admin1 = addressComponent_(result,['administrative_area_level_1']);
  let city = addressComponent_(result,['locality','postal_town']);
  if (code === 'HK') city = 'Hong Kong';
  // Distinguish central Tokyo wards from independent cities in the metropolis.
  if (code === 'JP' && /^(?:Tokyo(?: Metropolis)?|東京都|東京)$/i.test(admin1)) {
    const ward = /^(?:Chiyoda|Chuo|Minato|Shinjuku|Bunkyo|Taito|Sumida|Koto|Shinagawa|Meguro|Ota|Setagaya|Shibuya|Nakano|Suginami|Toshima|Kita|Arakawa|Itabashi|Nerima|Adachi|Katsushika|Edogawa)(?:[- ](?:ku|City|Ward))?$/i;
    if (!city || ward.test(city) || /区$/.test(city)) city = 'Tokyo';
  }
  if (!city && code === 'CN' && /^(?:Shanghai|Beijing|Tianjin|Chongqing)(?: Shi| Municipality)?$/i.test(admin1)) city = admin1;
  if (!city) city = addressComponent_(result,['administrative_area_level_2','sublocality_level_1','sublocality']);
  if (code === 'CN') {
    city = city.replace(/(?: Shi| Municipality)$/i,'');
    const aliases = {'北京':'Beijing','北京市':'Beijing','上海':'Shanghai','上海市':'Shanghai','西安':"Xi'an",'西安市':"Xi'an",'Xian':"Xi'an",'Xi’an':"Xi'an"};
    if (Object.prototype.hasOwnProperty.call(aliases,city)) city = aliases[city];
  }
  if (!city) throw new Error('无法可靠确定城市，请提供更完整的商户链接。');
  const config = CONFIG.COUNTRY_CONFIG[code];
  return {city:city,country:config ? config.country : name,country_code:code};
}

function geocodePlaceName_(name) {
  const results = geocoderResults_(Maps.newGeocoder().setLanguage('en').geocode(name))
    .filter(x=>!x.partial_match && validPoint_(geocoderPoint_(x)) &&
      !(x.types || []).some(t=>['country','locality','postal_town','route','postal_code'].includes(t) || /^administrative_area_level_/.test(t)));
  if (!results.length) return null;
  const first = results[0];
  const location = canonicalLocation_(first);
  const point = geocoderPoint_(first);
  results.slice(1).forEach(x=>{
    const next = canonicalLocation_(x);
    const n = geocoderPoint_(x);
    if (next.city !== location.city || next.country_code !== location.country_code ||
      haversineMeters_(point.latitude,point.longitude,n.latitude,n.longitude)>100) throw new Error('名称对应多个地点，请提供含坐标的商户链接。');
  });
  return first;
}

function reverseGeocode_(latitude,longitude) {
  const results = geocoderResults_(Maps.newGeocoder().setLanguage('en').reverseGeocode(latitude,longitude));
  let best = null;
  let rank = -1;
  results.forEach(result=>{
    try { canonicalLocation_(result); } catch (_) { return; }
    const candidateRank = addressComponent_(result,['locality','postal_town']) ? 2 : 1;
    if (candidateRank > rank) { best=result; rank=candidateRank; }
  });
  if (!best) throw new Error('无法可靠确定完整国家／城市。');
  return best;
}

function addressComponent_(result, types) {
  const components = (result && result.address_components) || [];
  for (let i = 0; i < types.length; i++) {
    for (let j = 0; j < components.length; j++) {
      if (components[j].types && components[j].types.indexOf(types[i]) !== -1) {
        return components[j].long_name || components[j].short_name || '';
      }
    }
  }
  return '';
}

function inferTokyoRegion_(result, address) {
  const ward = addressComponent_(result, ['administrative_area_level_2', 'locality', 'sublocality_level_1']);
  const source = ward + ' ' + String(address || '');
  const wards = [
    ['千代田区', ['Chiyoda', '千代田区']], ['中央区', ['Chuo', '中央区']], ['港区', ['Minato', '港区']],
    ['新宿区', ['Shinjuku', '新宿区']], ['文京区', ['Bunkyo', '文京区']], ['台东区', ['Taito', '台東区', '台东区']],
    ['墨田区', ['Sumida', '墨田区']], ['江东区', ['Koto', '江東区', '江东区']], ['品川区', ['Shinagawa', '品川区']],
    ['目黑区', ['Meguro', '目黒区', '目黑区']], ['大田区', ['Ota', '大田区']], ['世田谷区', ['Setagaya', '世田谷区']],
    ['涩谷区', ['Shibuya', '渋谷区', '涩谷区']], ['中野区', ['Nakano', '中野区']], ['杉并区', ['Suginami', '杉並区', '杉并区']],
    ['丰岛区', ['Toshima', '豊島区', '丰岛区']], ['北区', ['Kita', '北区']], ['荒川区', ['Arakawa', '荒川区']],
    ['板桥区', ['Itabashi', '板橋区', '板桥区']], ['练马区', ['Nerima', '練馬区', '练马区']], ['足立区', ['Adachi', '足立区']],
    ['葛饰区', ['Katsushika', '葛飾区', '葛饰区']], ['江户川区', ['Edogawa', '江戸川区', '江户川区']]
  ];
  const lower = source.toLowerCase();
  for (let i = 0; i < wards.length; i++) {
    if (wards[i][1].some(function (alias) { return lower.indexOf(alias.toLowerCase()) !== -1; })) return wards[i][0];
  }
  return '待确认';
}

function inferTokyoDistrict_(result, address) {
  const value = addressComponent_(result, ['sublocality_level_2', 'sublocality_level_3', 'neighborhood', 'premise']);
  if (value) return value;
  const parts = String(address || '').split(',').map(function (part) { return part.trim(); }).filter(Boolean);
  return parts.length > 2 ? parts[parts.length - 3] : '待确认';
}
function extractPremiseName_(result) {
  const components = (result && result.address_components) || [];
  const preferredTypes = ['premise', 'establishment', 'point_of_interest'];

  for (let i = 0; i < preferredTypes.length; i++) {
    for (let j = 0; j < components.length; j++) {
      if (components[j].types && components[j].types.indexOf(preferredTypes[i]) !== -1) {
        return components[j].long_name || '';
      }
    }
  }

  return '';
}

function inferDistrict_(address) {
  const text = String(address || '').toLowerCase();
  const areas = [
    ['坚尼地城', ['kennedy town', '堅尼地城', '坚尼地城']],
    ['石塘咀', ['shek tong tsui', '石塘咀']],
    ['西营盘', ['sai ying pun', '西營盤', '西营盘']],
    ['上环', ['sheung wan', '上環', '上环']],
    ['中环', ['central', '中環', '中环']],
    ['金钟', ['admiralty', '金鐘', '金钟']],
    ['湾仔', ['wan chai', '灣仔', '湾仔']],
    ['铜锣湾', ['causeway bay', '銅鑼灣', '铜锣湾']],
    ['大坑', ['tai hang', '大坑']],
    ['跑马地', ['happy valley', '跑馬地', '跑马地']],
    ['北角', ['north point', '北角']],
    ['鲗鱼涌', ['quarry bay', '鰂魚涌', '鲗鱼涌']],
    ['西湾河', ['sai wan ho', '西灣河', '西湾河']],
    ['筲箕湾', ['shau kei wan', '筲箕灣', '筲箕湾']],
    ['柴湾', ['chai wan', '柴灣', '柴湾']],
    ['香港仔', ['aberdeen', '香港仔']],
    ['黄竹坑', ['wong chuk hang', '黃竹坑', '黄竹坑']],
    ['鸭脷洲', ['ap lei chau', '鴨脷洲', '鸭脷洲']],
    ['赤柱', ['stanley', '赤柱']],

    ['尖沙咀', ['tsim sha tsui', '尖沙咀']],
    ['佐敦', ['jordan', '佐敦']],
    ['油麻地', ['yau ma tei', '油麻地']],
    ['旺角', ['mong kok', '旺角']],
    ['太子', ['prince edward', '太子']],
    ['深水埗', ['sham shui po', '深水埗']],
    ['长沙湾', ['cheung sha wan', '長沙灣', '长沙湾']],
    ['荔枝角', ['lai chi kok', '荔枝角']],
    ['大角咀', ['tai kok tsui', '大角咀']],
    ['土瓜湾', ['to kwa wan', '土瓜灣', '土瓜湾']],
    ['马头角', ['ma tau kok', '馬頭角', '马头角']],
    ['红磡', ['hung hom', '紅磡', '红磡']],
    ['黄埔', ['whampoa', '黃埔', '黄埔']],
    ['何文田', ['ho man tin', '何文田']],
    ['九龙城', ['kowloon city', '九龍城', '九龙城']],
    ['启德', ['kai tak', '啟德', '启德']],
    ['新蒲岗', ['san po kong', '新蒲崗', '新蒲岗']],
    ['黄大仙', ['wong tai sin', '黃大仙', '黄大仙']],
    ['钻石山', ['diamond hill', '鑽石山', '钻石山']],
    ['观塘', ['kwun tong', '觀塘', '观塘']],
    ['牛头角', ['ngau tau kok', '牛頭角', '牛头角']],
    ['九龙湾', ['kowloon bay', '九龍灣', '九龙湾']],

    ['荃湾', ['tsuen wan', '荃灣', '荃湾']],
    ['葵涌', ['kwai chung', '葵涌']],
    ['沙田', ['sha tin', '沙田']],
    ['大围', ['tai wai', '大圍', '大围']],
    ['火炭', ['fo tan', '火炭']],
    ['马鞍山', ['ma on shan', '馬鞍山', '马鞍山']],
    ['大埔', ['tai po', '大埔']],
    ['粉岭', ['fanling', '粉嶺', '粉岭']],
    ['上水', ['sheung shui', '上水']],
    ['元朗', ['yuen long', '元朗']],
    ['屯门', ['tuen mun', '屯門', '屯门']],
    ['将军澳', ['tseung kwan o', '將軍澳', '将军澳']],
    ['西贡', ['sai kung', '西貢', '西贡']],

    ['大澳', ['tai o', '大澳']],
    ['东涌', ['tung chung', '東涌', '东涌']],
    ['梅窝', ['mui wo', '梅窩', '梅窝']],
    ['长洲', ['cheung chau', '長洲', '长洲']],
    ['南丫岛', ['lamma island', '南丫島', '南丫岛']],
    ['坪洲', ['peng chau', '坪洲']],

    ['中西区', ['central and western district', '中西區', '中西区']],
    ['东区', ['eastern district', '東區', '东区']],
    ['南区', ['southern district', '南區', '南区']],
    ['油尖旺区', ['yau tsim mong district', '油尖旺區', '油尖旺区']],
    ['离岛', ['islands district', '離島區', '离岛区']]
  ];

  for (let i = 0; i < areas.length; i++) {
    for (let j = 0; j < areas[i][1].length; j++) {
      if (text.indexOf(areas[i][1][j].toLowerCase()) !== -1) {
        return areas[i][0];
      }
    }
  }

  return '待确认';
}

function inferRegion_(district) {
  const area = String(district || '');

  const island = [
    '坚尼地城', '石塘咀', '西营盘', '上环', '中环', '金钟', '湾仔',
    '铜锣湾', '大坑', '跑马地', '北角', '鲗鱼涌', '西湾河', '筲箕湾',
    '柴湾', '香港仔', '黄竹坑', '鸭脷洲', '赤柱', '中西区', '东区', '南区'
  ];
  const kowloon = [
    '尖沙咀', '佐敦', '油麻地', '旺角', '太子', '深水埗', '长沙湾',
    '荔枝角', '大角咀', '土瓜湾', '马头角', '红磡', '黄埔', '何文田',
    '九龙城', '启德', '新蒲岗', '黄大仙', '钻石山', '观塘', '牛头角',
    '九龙湾', '油尖旺区'
  ];
  const newTerritories = [
    '荃湾', '葵涌', '沙田', '大围', '火炭', '马鞍山', '大埔', '粉岭',
    '上水', '元朗', '屯门', '将军澳', '西贡'
  ];
  const islands = ['大澳', '东涌', '梅窝', '长洲', '南丫岛', '坪洲', '离岛'];

  if (island.indexOf(area) !== -1) return '港岛';
  if (kowloon.indexOf(area) !== -1) return '九龙';
  if (newTerritories.indexOf(area) !== -1) return '新界';
  if (islands.indexOf(area) !== -1) return '离岛';
  return '待确认';
}

function getSheet_() {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + CONFIG.SHEET_NAME);
  return sheet;
}

function ensureHeaders_(sheet) {
  ensureCountryCodeHeader_(sheet);
  const current = sheet.getRange(1, 1, 1, CONFIG.HEADERS.length).getDisplayValues()[0];
  const favoriteIndex = CONFIG.HEADERS.indexOf('favorite');
  const legacyHeadersValid = CONFIG.HEADERS.slice(0, favoriteIndex).every(function (header, index) {
    return current[index] === header;
  });

  if (legacyHeadersValid && !current[favoriteIndex]) {
    sheet.getRange(1, favoriteIndex + 1).setValue('favorite');
    const rowCount = Math.max(0, sheet.getLastRow() - 1);
    if (rowCount) {
      const statusIndex = CONFIG.HEADERS.indexOf('status');
      const legacyStatuses = sheet.getRange(2, statusIndex + 1, rowCount, 1).getDisplayValues();
      sheet.getRange(2, favoriteIndex + 1, rowCount, 1)
        .setValues(legacyStatuses.map(function (row) {
          return [String(row[0] || '').trim() === '优先去'];
        }));
    }
    current[favoriteIndex] = 'favorite';
  }
  const valid = CONFIG.HEADERS.every(function (header, index) {
    return current[index] === header;
  });

  if (!valid) {
    throw new Error('The Coffee Shops header row does not match the API schema.');
  }
}

function ensureCountryCodeHeader_(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]
    .map(function (value) { return cleanText_(value); });
  const existingIndex = headers.indexOf('country_code');
  if (existingIndex >= 0) {
    if (existingIndex !== CONFIG.HEADERS.indexOf('country_code')) {
      throw new Error('country_code 必须位于表格最后一列。');
    }
    return;
  }

  const legacyHeaders = CONFIG.HEADERS.slice(0, -1);
  const legacyValid = legacyHeaders.every(function (header, index) {
    return headers[index] === header;
  });
  if (!legacyValid) {
    throw new Error('The Coffee Shops header row does not match the API schema.');
  }
  sheet.getRange(1, CONFIG.HEADERS.length).setValue('country_code');
}

function parseRequestBody_(e) {
  if (!e) return {};

  if (e.postData && e.postData.contents) {
    try {
      return JSON.parse(e.postData.contents);
    } catch (ignore) {
      // Fall through to normal form parameters.
    }
  }

  return e.parameter || {};
}

function requireAdminKey_(providedKey) {
  const expectedKey = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!expectedKey) throw new Error('ADMIN_KEY is not configured. Run setupProject first.');
  if (!providedKey || String(providedKey) !== expectedKey) {
    throw new Error('Unauthorized.');
  }
}

function findRowIndexById_(table, id) {
  const idColumn = table.headers.indexOf('id');
  if (idColumn < 0) return -1;

  for (let i = 0; i < table.rows.length; i++) {
    if (String(table.rows[i][idColumn]) === id) return i;
  }

  return -1;
}

function rowToObject_(headers, row) {
  const object = {};
  headers.forEach(function (header, index) {
    object[header] = row[index];
  });
  return object;
}

function latestUpdatedAt_(shops) {
  return shops.reduce(function (latest, shop) {
    return String(shop.updated_at || '') > latest ? String(shop.updated_at) : latest;
  }, '');
}

function withWriteLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw new Error('数据库正在被其他操作更新，请稍后重试。');
  }

  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function validateGoogleMapsUrl_(url) {
  const value = String(url || '').trim();
  if (!/^https:\/\//i.test(value)) {
    throw new Error('请填写完整的 HTTPS Google Maps 链接。');
  }

  const allowed = /^https:\/\/(?:maps\.app\.goo\.gl\/|goo\.gl\/maps(?:\/|[?#]|$)|(?:(?:www|maps)\.)?google\.(?:com|[a-z]{2}|(?:co|com)\.[a-z]{2})\/maps(?:\/|[?#]|$))/i;
  if (!allowed.test(value)) {
    throw new Error('这不是有效的 Google Maps 链接。');
  }
}

function validateAppleMapsUrl_(url) {
  const value = String(url || '').trim();
  if (!/^https:\/\/maps\.apple\.com(?:\/|\?)/i.test(value)) {
    throw new Error('这不是有效的 HTTPS Apple Maps 链接。');
  }
  const hasPlacePath = /^https:\/\/maps\.apple\.com\/place(?:\?|\/|$)/i.test(value);
  const hasPlaceId = /[?&]place-id=[^&#]+/i.test(value);
  if (!hasPlacePath && !hasPlaceId) {
    throw new Error('请使用 Apple Maps 的具体商户资料链接，而不是普通搜索链接。');
  }
}

function requireCityProvider_(city, provider) {
  const code = countryCodeForCity_(city);
  if (!code) throw new Error('目前不支持这个城市。');
  requireCountryProvider_(code, provider);
}

function providerForCode_(code) {
  if (!/^[A-Z]{2}$/.test(code)) throw new Error('缺少有效的国家／地区代码。');
  return code === 'CN' ? 'apple' : 'google';
}
function requireCountryProvider_(code,provider) {
  if (providerForCode_(code) !== provider) throw new Error(code + ' 不支持此地图来源。');
}
function getMapFieldForCity_(city) {
  return providerForCode_(countryCodeForCity_(city)) === 'apple' ? 'apple_maps' : 'google_maps';
}
function getMapFieldForShop_(shop) {
  return providerForCode_(getCountryCodeForShop_(shop)) === 'apple' ? 'apple_maps' : 'google_maps';
}
function validateRequiredProviderLink_(shop) {
  if (getMapFieldForShop_(shop) === 'apple_maps') validateAppleMapsUrl_(shop.apple_maps);
  else validateGoogleMapsUrl_(shop.google_maps);
}
function applyMapProviderRule_(shop) {
  validateRequiredProviderLink_(shop);
  const required = getMapFieldForShop_(shop);
  shop[required === 'apple_maps' ? 'google_maps' : 'apple_maps'] = '';
  return shop;
}

function hasMapProviderEdit_(input) {
  return Object.prototype.hasOwnProperty.call(input, 'city') ||
    Object.prototype.hasOwnProperty.call(input, 'country') ||
    Object.prototype.hasOwnProperty.call(input, 'country_code') ||
    Object.prototype.hasOwnProperty.call(input, 'google_maps') ||
    Object.prototype.hasOwnProperty.call(input, 'apple_maps');
}

function countryCodeForCity_(city) {
  const config = CONFIG.CITY_CONFIG[cleanText_(city)];
  return config ? config.countryCode : '';
}

function normalizeCountryCode_(countryCode,country,city) {
  const raw = cleanText_(countryCode).toUpperCase() || cleanText_(country).toUpperCase();
  if (/^[A-Z]{2}$/.test(raw)) return raw;
  return (Object.prototype.hasOwnProperty.call(COUNTRY_ALIASES,raw) && COUNTRY_ALIASES[raw]) || (!countryCode && !raw ? countryCodeForCity_(city) : '');
}

function getCountryCodeForShop_(shop) {
  return normalizeCountryCode_(shop && shop.country_code, shop && shop.country, shop && shop.city);
}

function isInsideBounds_(latitude, longitude, bounds) {
  return latitude >= bounds.south && latitude <= bounds.north &&
    longitude >= bounds.west && longitude <= bounds.east;
}

function inferCityFromCoordinates_(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!isFinite(lat) || !isFinite(lng)) return '';
  const cities = Object.keys(CONFIG.CITY_CONFIG);
  for (let i = 0; i < cities.length; i++) {
    if (isInsideBounds_(lat, lng, CONFIG.CITY_CONFIG[cities[i]].bounds)) return cities[i];
  }
  return '';
}

function gcj02ToWgs84_(latitude, longitude) {
  const sourceLatitude = Number(latitude);
  const sourceLongitude = Number(longitude);
  if (!isFinite(sourceLatitude) || !isFinite(sourceLongitude) || outsideChina_(sourceLatitude, sourceLongitude)) {
    return { latitude: sourceLatitude, longitude: sourceLongitude };
  }

  let latitudeGuess = sourceLatitude;
  let longitudeGuess = sourceLongitude;
  for (let i = 0; i < 10; i++) {
    const projected = wgs84ToGcj02_(latitudeGuess, longitudeGuess);
    const latitudeError = projected.latitude - sourceLatitude;
    const longitudeError = projected.longitude - sourceLongitude;
    latitudeGuess -= latitudeError;
    longitudeGuess -= longitudeError;
    if (Math.max(Math.abs(latitudeError), Math.abs(longitudeError)) < 0.0000001) break;
  }
  return { latitude: latitudeGuess, longitude: longitudeGuess };
}

function wgs84ToGcj02_(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (outsideChina_(lat, lng)) return { latitude: lat, longitude: lng };

  const pi = Math.PI;
  const semiMajorAxis = 6378245.0;
  const eccentricitySquared = 0.00669342162296594323;
  let latitudeDelta = transformLatitude_(lng - 105.0, lat - 35.0);
  let longitudeDelta = transformLongitude_(lng - 105.0, lat - 35.0);
  const radianLatitude = lat / 180.0 * pi;
  let magic = Math.sin(radianLatitude);
  magic = 1 - eccentricitySquared * magic * magic;
  const squareRootMagic = Math.sqrt(magic);
  latitudeDelta = latitudeDelta * 180.0 /
    ((semiMajorAxis * (1 - eccentricitySquared)) / (magic * squareRootMagic) * pi);
  longitudeDelta = longitudeDelta * 180.0 /
    (semiMajorAxis / squareRootMagic * Math.cos(radianLatitude) * pi);
  return { latitude: lat + latitudeDelta, longitude: lng + longitudeDelta };
}

function transformLatitude_(x, y) {
  const pi = Math.PI;
  let result = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y +
    0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  result += (20.0 * Math.sin(6.0 * x * pi) + 20.0 * Math.sin(2.0 * x * pi)) * 2.0 / 3.0;
  result += (20.0 * Math.sin(y * pi) + 40.0 * Math.sin(y / 3.0 * pi)) * 2.0 / 3.0;
  result += (160.0 * Math.sin(y / 12.0 * pi) + 320 * Math.sin(y * pi / 30.0)) * 2.0 / 3.0;
  return result;
}

function transformLongitude_(x, y) {
  const pi = Math.PI;
  let result = 300.0 + x + 2.0 * y + 0.1 * x * x +
    0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  result += (20.0 * Math.sin(6.0 * x * pi) + 20.0 * Math.sin(2.0 * x * pi)) * 2.0 / 3.0;
  result += (20.0 * Math.sin(x * pi) + 40.0 * Math.sin(x / 3.0 * pi)) * 2.0 / 3.0;
  result += (150.0 * Math.sin(x / 12.0 * pi) + 300.0 * Math.sin(x / 30.0 * pi)) * 2.0 / 3.0;
  return result;
}

function outsideChina_(latitude, longitude) {
  return longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271;
}

function createShopId_(city) {
  let prefix = city === 'Tokyo' ? 'tyo-' : city === 'Beijing' ? 'bj-' : city === 'Hong Kong' ? 'hk-' : '';
  if (!prefix) {
    const code = countryCodeForCity_(city) || 'xx';
    const citySlug = cleanText_(city).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'city';
    prefix = code.toLowerCase() + '-' + citySlug + '-';
  }
  return prefix + Utilities.getUuid().split('-')[0];
}

function createSecureKey_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

function nowIso_() {
  const raw = Utilities.formatDate(new Date(), CONFIG.TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssZ");
  return raw.slice(0, -2) + ':' + raw.slice(-2);
}

function roundCoordinate_(value) {
  return Math.round(Number(value) * 10000000) / 10000000;
}

function toNumber_(value) {
  if (value === '' || value === null || typeof value === 'undefined') return NaN;
  return Number(value);
}

function toBoolean_(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === null || typeof value === 'undefined' || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function cleanText_(value) {
  if (value === null || typeof value === 'undefined') return '';
  return String(value).trim();
}

function safeSheetValue_(value) {
  if (value === null || typeof value === 'undefined' || (typeof value === 'number' && isNaN(value))) {
    return '';
  }

  if (typeof value === 'string' && /^[=+@]/.test(value)) {
    return "'" + value;
  }

  return value;
}

function safeDecode_(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch (error) {
    return String(value || '');
  }
}

function normalizeUrl_(url) {
  if (/^https:\/\/maps\.apple\.com(?:\/|\?)/i.test(String(url || ''))) {
    const id = getQueryParameter_(String(url), 'place-id');
    if (id) return 'apple-place:' + id;
    const point = extractAppleCoordinates_(String(url));
    if (point) return 'apple-point:' + point.latitude + ',' + point.longitude;
    return String(url || '').trim().replace(/#.*$/, '');
  }
  return String(url || '').trim().replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
}

function normalizeName_(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g, '');
}

function haversineMeters_(lat1, lon1, lat2, lon2) {
  const radius = 6371000;
  const toRadians = function (degrees) { return degrees * Math.PI / 180; };
  const deltaLat = toRadians(Number(lat2) - Number(lat1));
  const deltaLon = toRadians(Number(lon2) - Number(lon1));
  const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRadians(Number(lat1))) * Math.cos(toRadians(Number(lat2))) *
    Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function jsonOutput_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorOutput_(error) {
  console.error(error && error.stack ? error.stack : error);
  return jsonOutput_({
    ok: false,
    error: error && error.message ? error.message : String(error)
  });
}
