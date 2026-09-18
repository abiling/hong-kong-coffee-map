const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Catalog = require('../location-catalog.js');

const shop = (id, city, country, country_code, region, district, latitude, longitude, extra = {}) => ({
  id, city, country, country_code, region, district, latitude, longitude, active: true, ...extra
});

const fixtures = [
  shop('hk-1', 'Hong Kong', 'Hong Kong SAR', 'HK', '港岛', '上环', 22.286, 114.151),
  shop('tokyo-1', 'Tokyo', 'Japan', 'JP', '涩谷区', '神宫前', 35.667, 139.708),
  shop('beijing-1', 'Beijing', 'China', 'CN', '朝阳区', '朝外', 39.926, 116.431),

  // Exact canonical location fields from Coffee Shops!A88:T90.
  shop('xian-oops-shuyuanmen', "Xi'an", 'China', 'CN', '碑林区', '书院门', 34.2547094, 108.9450618),
  shop('xian-oops-xicang', "Xi'an", 'China', 'CN', '莲湖区', '西仓', 34.2676788, 108.9293583),
  shop('xian-ora-wanxiangtiandi', "Xi'an", 'China', 'CN', '雁塔区', '曲江新区', 34.2010435, 108.9468429),

  // Synthetic cities intentionally have no display/camera registry entries.
  shop('seoul-1', 'Seoul', 'South Korea', 'KR', 'Jongno-gu', 'Ikseon-dong', 37.574, 126.989, {
    google_maps: 'https://maps.app.goo.gl/seoul-fixture'
  }),
  shop('seoul-2', 'Seoul', 'South Korea', 'KR', 'Mapo-gu', 'Yeonnam-dong', 37.562, 126.925, {
    google_maps: 'https://maps.app.goo.gl/seoul-fixture-2'
  }),
  shop('shanghai-1', 'Shanghai', 'China', 'CN', '静安区', '南京西路', 31.231, 121.459, {
    apple_maps: 'https://maps.apple.com/place?name=ShanghaiFixture'
  }),

  // Incomplete records must remain incomplete and must not be reassigned.
  shop('incomplete-1', '', '', '', 'Unknown region', '', 1, 2)
];

const catalog = Catalog.buildCatalog(fixtures);

assert.ok(catalog.countries.KR, 'South Korea must be discovered from data');
assert.equal(catalog.countries.KR.label, 'South Korea');
assert.deepEqual(catalog.countries.KR.locationKeys, ['KR::Seoul']);

const seoul = catalog.locations['KR::Seoul'];
assert.ok(seoul, 'Seoul must be fully functional without an override');
assert.equal(seoul.city, 'Seoul');
assert.equal(seoul.country, 'South Korea');
assert.equal(seoul.countryCode, 'KR');
assert.equal(seoul.provider, 'google');
assert.equal(seoul.camera, null, 'an unknown city must not require a camera override');
assert.deepEqual(seoul.regions, ['Jongno-gu', 'Mapo-gu']);
assert.deepEqual(seoul.districts, ['Ikseon-dong', 'Yeonnam-dong']);
assert.equal(seoul.shops.length, 2);
assert.deepEqual(seoul.bounds, {
  points: [[126.989, 37.574], [126.925, 37.562]],
  west: 126.925, south: 37.562, east: 126.989, north: 37.574
});

const chinaCities = catalog.countries.CN.locationKeys.map(key => catalog.locations[key].city);
assert.deepEqual(chinaCities, ['Beijing', 'Shanghai', "Xi'an"]);
assert.equal(catalog.locations['CN::Shanghai'].provider, 'apple');
assert.equal(Catalog.providerForCountryCode('CN'), 'apple');
assert.equal(Catalog.providerForCountryCode('KR'), 'google');
assert.equal(Catalog.preferredLocationKey(catalog, 'CN', "Xi'an"), "CN::Xi'an", 'last city per country must be restored');
assert.equal(Catalog.preferredLocationKey(catalog, 'KR', 'Unknown'), 'KR::Seoul', 'a country without a remembered city must use its first data city');

const xian = catalog.locations["CN::Xi'an"];
assert.ok(xian, "Xi'an must be discovered from the real Sheet fixtures");
assert.equal(xian.shops.length, 3);
assert.deepEqual(xian.regions, ['碑林区', '莲湖区', '雁塔区']);
assert.deepEqual(xian.districts, ['曲江新区', '书院门', '西仓']);
assert.ok(xian.bounds && xian.bounds.west < xian.bounds.east && xian.bounds.south < xian.bounds.north);

assert.deepEqual(
  Catalog.shopsForLocation(fixtures, 'CN', 'Shanghai').map(item => item.id),
  ['shanghai-1'],
  'Shanghai shops must be isolated from Beijing and Xi\'an'
);
assert.deepEqual(
  Catalog.shopsForLocation(fixtures, 'KR', 'Seoul').map(item => item.id),
  ['seoul-1', 'seoul-2'],
  'Seoul shops must be isolated'
);

const canonicalSeoul = Catalog.canonicalLocation(fixtures.find(item => item.id === 'seoul-1'));
assert.equal(canonicalSeoul.city, 'Seoul');
assert.equal(canonicalSeoul.country, 'South Korea');
assert.equal(canonicalSeoul.country_code, 'KR');
assert.equal(catalog.incomplete.length, 1);
assert.equal(catalog.incomplete[0].city, '');
assert.equal(catalog.locations['HK::Hong Kong'].shops.some(item => item.id === 'incomplete-1'), false);

const root = path.join(__dirname, '..');
const multicitySource = fs.readFileSync(path.join(root, 'multicity.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
assert.doesNotMatch(multicitySource, /const\s+(COUNTRIES|CITIES)\s*=/, 'fixed location allowlists must not return');
assert.doesNotMatch(multicitySource, /function\s+inferCity\s*\(/, 'frontend city inference must not return');
assert.doesNotMatch(multicitySource, /Seoul|Shanghai/, 'synthetic cities must not be registered in production code');
assert.doesNotMatch(appSource, /shop\.city\s*\|\|\s*['"]Hong Kong['"]/, 'unknown city must not fall back to Hong Kong');

console.log(JSON.stringify({
  countries: catalog.countryCodes,
  chinaCities,
  seoul: { shops: seoul.shops.length, regions: seoul.regions, provider: seoul.provider, bounds: seoul.bounds },
  shanghai: { shops: catalog.locations['CN::Shanghai'].shops.length, provider: catalog.locations['CN::Shanghai'].provider },
  xian: { shops: xian.shops.length, regions: xian.regions, districts: xian.districts },
  incomplete: catalog.incomplete.map(item => item.id)
}, null, 2));
