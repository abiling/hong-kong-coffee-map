// All tests in this file mock Apps Script services and map-provider redirects.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../apps-script/Coffee_Shops_Map_API_v7.gs'), 'utf8');
const component = (type, long_name, short_name = long_name) => ({ types: [type], long_name, short_name });
const response = (...results) => ({ status: 'OK', results });
const fixtures = [
  ['Hong Kong', 'HK', 'Hong Kong', 22.286, 114.151, [
    ['locality', 'Hong Kong'], ['sublocality_level_1', 'Central'], ['neighborhood', 'Sheung Wan']
  ]],
  ['Tokyo', 'JP', 'Japan', 35.667, 139.708, [
    ['locality', 'Shibuya City'], ['administrative_area_level_1', 'Tokyo'], ['neighborhood', 'Jingumae']
  ]],
  ['Beijing', 'CN', 'China', 39.916336, 116.449427, [
    ['administrative_area_level_1', '北京市'], ['locality', 'Chaoyang District'],
    ['administrative_area_level_2', '朝阳区'], ['neighborhood', '日坛']
  ]],
  ["Xi'an", 'CN', 'China', 34.253125, 108.949725, [
    ['administrative_area_level_1', 'Shaanxi'], ['administrative_area_level_2', 'Xian'],
    ['sublocality_level_1', '碑林区'], ['neighborhood', '书院门']
  ]],
  ['Shanghai', 'CN', 'China', 31.23, 121.46, [
    ['administrative_area_level_1', 'Shanghai Municipality'], ['locality', 'Jing’an District'],
    ['administrative_area_level_2', 'Jing’an District'], ['neighborhood', '南京西路']
  ]],
  ['Seoul', 'KR', 'South Korea', 37.574, 126.989, [
    ['administrative_area_level_1', 'Seoul Special City'], ['administrative_area_level_2', 'Jongno-gu'],
    ['neighborhood', 'Ikseon-dong']
  ]],
  ['Paris', 'FR', 'France', 48.8566, 2.3522, [
    ['postal_town', 'Paris'], ['administrative_area_level_2', 'Paris'],
    ['administrative_area_level_1', 'Île-de-France'], ['sublocality_level_1', '4th arrondissement'],
    ['neighborhood', 'Le Marais']
  ]]
];
const [hk, tokyo, beijing, xian, shanghai, seoul, paris] = fixtures;
const geo = ([city, code, country, lat, lng, components]) => ({
  geometry: { location: {lat, lng} },
  formatted_address: ['Cafe', ...components.map(([,name]) => name), city, country].join(', '),
  address_components: [component('country', country, code), ...components.map(args => component(...args))]
});
const googleUrl = ([city,,,lat,lng]) =>
  'https://www.google.com/maps/place/' + encodeURIComponent(city + ' Cafe') +
  '/@35,139,12z/data=!3d' + lat + '!4d' + lng;
const appleUrl = ([city,,,lat,lng]) =>
  'https://maps.apple.com/place?name=' + encodeURIComponent(city + ' Cafe') +
  '&coordinate=' + lat + ',' + lng + '&address=' + encodeURIComponent('Cafe, ' + city + ' China');
const linkFor = f => f[1] === 'CN' ? { apple_maps: appleUrl(f) } : { google_maps: googleUrl(f) };

function mockAppsScript() {
  const rows = [];
  const events = [];
  const redirects = new Map();
  const properties = { SPREADSHEET_ID: 'mock-copied-sheet', DATABASE_ENVIRONMENT: 'candidate', ADMIN_KEY: 'mock-admin' };
  let headers, locked = false, pending, reverseOverride, seq = 0;
  const write = cb => {
    assert.ok(locked, 'writes must hold the Apps Script lock');
    assert.equal(pending, undefined);
    pending = cb;
  };
  const sheet = {
    getDataRange: () => ({
      getValues: () => {
        events.push(locked ? 'read-locked' : 'read');
        return [headers, ...rows].map(row => row.slice());
      }
    }),
    appendRow: row => write(() => rows.push(Array.from(row))),
    getRange: (row, col, height, width) => {
      assert.deepEqual([col, height, width], [1, 1, headers.length]);
      return {
        getFormulas: () => [Array(headers.length).fill('')],
        setValues: ([values]) => write(() => { rows[row - 2] = Array.from(values); })
      };
    }
  };
  const ctx = vm.createContext({
    console: {error() {}},
    Maps: {
      newGeocoder: () => ({
        setLanguage: language => {
          assert.equal(language, 'en');
          return {
            geocode: () => assert.fail('a name-only lookup does not establish merchant identity'),
            reverseGeocode: (lat, lng) => {
              events.push(['reverse', lat, lng]);
              if (reverseOverride) return reverseOverride;
              const f = fixtures.find(x => Math.abs(x[3] - lat) < .02 && Math.abs(x[4] - lng) < .02);
              assert.ok(f, 'unexpected mock coordinates ' + lat + ',' + lng);
              return response(geo(f));
            }
          };
        }
      })
    },
    UrlFetchApp: {
      fetch: url => {
        events.push(['fetch', url]);
        const target = redirects.get(url);
        return {getResponseCode: () => target ? 302 : 200, getAllHeaders: () => target ? {Location: target} : {}};
      }
    },
    PropertiesService: {getScriptProperties: () => ({getProperty: name => properties[name]})},
    SpreadsheetApp: {
      openById: id => {
        events.push(['open', id]);
        return {getSheetByName: name => name === 'Coffee Shops' ? sheet : null};
      },
      flush: () => {
        assert.ok(locked);
        assert.ok(pending);
        pending();
        pending = undefined;
        events.push('flush');
      }
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          assert.equal(locked, false);
          locked = true;
          events.push('lock');
          return true;
        },
        releaseLock: () => {
          assert.ok(locked);
          assert.equal(pending, undefined, 'flush must happen before lock release');
          locked = false;
          events.push('unlock');
        }
      })
    },
    ContentService: {MimeType: {JSON: 'json'}, createTextOutput: value => ({value, setMimeType() { return this; }})},
    Utilities: {
      getUuid: () => String(++seq).padStart(8, '0') + '-mock',
      formatDate: () => '2026-11-24T17:00:00+0800'
    }
  });
  vm.runInContext(source, ctx);
  headers = Array.from(vm.runInContext('CONFIG.HEADERS', ctx));
  function post(action, data, adminKey = 'mock-admin') {
    return JSON.parse(ctx.doPost({postData: {contents: JSON.stringify({action, adminKey, data})}}).value);
  }
  return {
    ctx, rows, headers, events, redirects, properties, post,
    overrideReverse: value => { reverseOverride = value; },
    parse: (fixture, hints) => ctx.parseMapLink_({ ...hints, ...linkFor(fixture) }),
    geocodes: () => events.filter(event => Array.isArray(event) && event[0] === 'reverse'),
    fetches: () => events.filter(event => Array.isArray(event) && event[0] === 'fetch')
  };
}

function v39Form(place) {
  const fields = ['name', 'address', 'region', 'district', 'category', 'source', 'notes', 'city', 'country', 'country_code'];
  return Object.assign(Object.fromEntries(fields.map(field => [field, place[field] || ''])), {
    google_maps: place.google_maps || '', apple_maps: place.apple_maps || '',
    latitude: Number(place.latitude), longitude: Number(place.longitude), active: true, status: '想去'
  });
}

for (const fixture of fixtures) {
  test('mock parse canonicalizes ' + fixture[0], () => {
    const mock = mockAppsScript();
    const place = mock.parse(fixture, { hint_city: 'Wrong city', hint_country_code: 'US', city: 'Tokyo', country_code: 'JP' });
    assert.equal(place.city, fixture[0]);
    assert.equal(place.country_code, fixture[1]);
    assert.equal(place.country, fixture === hk ? 'Hong Kong SAR' : fixture[2]);
    assert.ok(place.region && place.district);
    assert.notEqual(place.region, place.district);
    assert.equal(Boolean(place.apple_maps), fixture[1] === 'CN');
    assert.equal(Boolean(place.google_maps), fixture[1] !== 'CN');
  });
}

test('mock legacy region labels and dynamic administrative structures', () => {
  const mock = mockAppsScript();
  for (const [fixture, region] of [[tokyo, '涩谷区'], [beijing, '朝阳区'], [xian, '碑林区'],
    [shanghai, 'Jing’an District'], [seoul, 'Jongno-gu'], [paris, '4th arrondissement']]) {
    assert.equal(mock.parse(fixture).region, region);
  }
  assert.equal(vm.runInContext('CONFIG.CITY_CONFIG.Paris || CONFIG.COUNTRY_CONFIG.FR', mock.ctx), undefined);
  const jp = component('country', 'Japan', 'JP');
  const metro = component('administrative_area_level_1', '東京都');
  const city = parts => mock.ctx.canonicalLocation_({address_components: [jp, metro, ...parts]}).city;
  assert.equal(city([component('administrative_area_level_2', '渋谷区')]), 'Tokyo');
  assert.equal(city([component('locality', 'Hachioji')]), 'Hachioji');
  assert.throws(() => city([]), /无法可靠确定城市/);
  const cn = component('country', 'China', 'CN');
  const cityInChina = name => mock.ctx.canonicalLocation_({address_components: [cn, component('locality', name)]}).city;
  assert.equal(cityInChina('Xi’an'), "Xi'an");
  assert.equal(cityInChina('西安市'), "Xi'an");
});

test('mock Paris without subdivisions can be completed manually before saving', () => {
  const mock = mockAppsScript();
  const base = geo(paris);
  base.address_components = [component('country', 'France', 'FR'), component('locality', 'Paris'),
    component('administrative_area_level_1', 'Île-de-France'), component('route', 'Rue de Rivoli')];
  mock.overrideReverse(response(base));
  const place = mock.parse(paris);
  assert.equal(place.region, '');
  assert.equal(place.district, '');
  const saved = mock.ctx.addShop_({...place, region: '4th arrondissement', district: 'Le Marais'});
  assert.equal(saved.district, 'Le Marais');
});

test('mock missing city, country, partial and conflicting geocoder results fail closed', () => {
  const mock = mockAppsScript();
  const base = geo(paris);
  const country = base.address_components[0];
  const france = [country, component('administrative_area_level_1', 'Île-de-France'),
    component('administrative_area_level_2', 'Val-de-Marne'), component('sublocality_level_1', 'Le Marais'),
    component('route', 'Rue de Rivoli')];
  for (const lookup of [
    {status: 'ZERO_RESULTS', results: []},
    response({address_components: france}),
    response({address_components: [...france, component('locality', '4th arrondissement')]}),
    response({address_components: [component('locality', 'Paris')]}),
    response({...base, partial_match: true}),
    response(geo(hk), geo(tokyo))
  ]) {
    mock.overrideReverse(lookup);
    assert.throws(() => mock.parse(paris), /无法可靠/);
  }
  mock.overrideReverse(response({...geo(tokyo), partial_match: true}, base));
  assert.equal(mock.parse(paris).city, 'Paris');
});

test('mock quota errors surface without a save', () => {
  const mock = mockAppsScript();
  mock.overrideReverse({status: 'OVER_QUERY_LIMIT', results: []});
  assert.match(mock.post('parse', linkFor(paris)).error, /配额/);
  assert.equal(mock.rows.length, 0);
});

test('mock Google viewport and Apple ll/center do not identify merchant pins', () => {
  const mock = mockAppsScript();
  for (const url of [
    'https://www.google.com/maps/place/Cafe+Seoul/@37.574,126.989,12z',
    'https://www.google.com/maps/search/?api=1&query=Cafe+Seoul',
    'https://www.google.com/maps/search/?api=1&query=37.574,126.989&query_place_id=ChIJother',
    'https://www.google.com/maps/dir/?q=37.574,126.989',
    'https://www.google.com/maps/place/Fake!3d37.574!4d126.989'
  ]) {
    assert.throws(() => mock.ctx.parseMapLink_({google_maps: url}), /商户坐标/);
  }
  for (const field of ['ll', 'center']) {
    const url = 'https://maps.apple.com/place?name=Cafe&place-id=Mock&' + field + '=31.23,121.46';
    assert.throws(() => mock.ctx.parseMapLink_({apple_maps: url}), /有效坐标/);
  }
  assert.equal(mock.geocodes().length, 0);
  assert.throws(() => mock.ctx.parseMapLink_({google_maps: googleUrl(seoul) + '!3d37.576!4d126.99'}), /冲突/);
  assert.throws(() => mock.ctx.parseMapLink_({
    google_maps: 'https://www.google.com/maps?q=37.574,126.989&q=37.575,126.989'
  }), /冲突/);
  assert.throws(() => mock.ctx.parseMapLink_({
    apple_maps: appleUrl(shanghai) + '&coordinate=31.231,121.461'
  }), /冲突/);
  assert.equal(mock.parse(seoul).latitude, 37.574);
  assert.equal(mock.ctx.parseMapLink_({google_maps: 'https://www.google.com/maps?q=37.574%2C126.989'}).latitude, 37.574);
  assert.equal(mock.ctx.parseMapLink_({apple_maps: 'https://maps.apple.com/place?place-id=Mock&coordinate=31.23,121.46&center=1,2'}).city, 'Shanghai');
});

test('mock enforces CN provider and converts Apple GCJ-02 coordinates once per parse or save', () => {
  const mock = mockAppsScript();
  for (const [fixture, latitude, longitude] of [
    [beijing, 39.9149684, 116.4432319], [xian, 34.2547094, 108.9450618]
  ]) {
    const place = mock.parse(fixture);
    assert.equal(place.source_coordinate.system, 'GCJ-02');
    assert.equal(place.source_coordinate.latitude, fixture[3]);
    assert.ok(Math.abs(place.latitude - latitude) < .00002);
    assert.ok(Math.abs(place.longitude - longitude) < .00002);
    const saved = mock.ctx.addShop_(v39Form(place));
    assert.equal(saved.latitude, place.latitude);
    assert.equal(saved.longitude, place.longitude);
    assert.throws(() => mock.ctx.addShop_({...v39Form(place), latitude: fixture[3], longitude: fixture[4]}), /经纬度.*不一致/);
  }
  assert.throws(() => mock.ctx.parseMapLink_({google_maps: googleUrl(shanghai)}), /CN 不支持此地图来源/);
  assert.throws(() => mock.ctx.parseMapLink_({apple_maps: appleUrl(hk)}), /HK 不支持此地图来源/);
});

test('mock redirect resolution retains the source link and checks the target provider', () => {
  const mock = mockAppsScript();
  const short = 'https://maps.app.goo.gl/mock';
  mock.redirects.set(short, googleUrl(seoul));
  const place = mock.ctx.parseMapLink_({google_maps: short});
  assert.equal(place.google_maps, short);
  assert.equal(place.resolved_google_maps, googleUrl(seoul));
  mock.ctx.addShop_(mock.parse(seoul));
  assert.throws(() => mock.ctx.addShop_(place), /已经存在/);
  const before = mock.fetches().length;
  mock.redirects.set(short, 'https://example.invalid/unsupported');
  assert.throws(() => mock.ctx.parseMapLink_({google_maps: short}), /Google Maps/);
  assert.equal(mock.fetches().length - before, 1);
});

test('mock add rejects country, city and coordinate overrides', () => {
  const mock = mockAppsScript();
  const place = v39Form(mock.parse(shanghai));
  for (const conflict of [{city: 'Beijing'}, {country_code: 'JP'}, {country: 'Japan'}]) {
    assert.throws(() => mock.ctx.addShop_({...place, ...conflict}), /归属/);
  }
  for (const coordinates of [{latitude: ''}, {latitude: '   '}, {latitude: null}, {latitude: true},
    {latitude: 91}, {longitude: -181}]) {
    assert.throws(() => mock.ctx.addShop_({...place, ...coordinates}), /缺少有效的经纬度/);
  }
  assert.throws(() => mock.ctx.addShop_({...place, latitude: 31.24}), /经纬度.*不一致/);
  assert.equal(mock.rows.length, 0);
  const {latitude, longitude, ...withoutCoordinates} = place;
  const saved = mock.ctx.addShop_(withoutCoordinates);
  assert.deepEqual([saved.latitude, saved.longitude], [latitude, longitude]);
});

test('mock duplicate add checks the current rows and flushes inside the lock', () => {
  const mock = mockAppsScript();
  const place = mock.parse(shanghai);
  const saved = mock.ctx.addShop_(place);
  assert.throws(() => mock.ctx.addShop_({...place, id: saved.id}), /已经存在/);
  assert.equal(mock.rows.length, 1);
  assert.deepEqual(mock.events.filter(event => typeof event === 'string'),
    ['lock', 'read-locked', 'flush', 'unlock', 'lock', 'read-locked', 'unlock']);
});

test('mock distinct Google queries and distinct merchant IDs survive duplicate checks', () => {
  const mock = mockAppsScript();
  const queryUrl = q => 'https://www.google.com/maps?q=' + q;
  const sameName = 'Same Coffee';
  const first = mock.ctx.addShop_({...mock.ctx.parseMapLink_({google_maps: queryUrl('37.574,126.989')}), name: sameName});
  const second = mock.ctx.addShop_({...mock.ctx.parseMapLink_({google_maps: queryUrl('37.57401,126.989')}), name: sameName});
  assert.notEqual(first.id, second.id);
  assert.notEqual(mock.ctx.normalizeUrl_(first.google_maps), mock.ctx.normalizeUrl_(second.google_maps));
  const url = googleUrl(seoul);
  for (const id of ['ChIJAlpha', 'ChIJBeta']) {
    const link = url + '?place_id=' + id;
    mock.ctx.addShop_(mock.ctx.parseMapLink_({google_maps: link}));
  }
  const duplicate = url + '?hl=en&query_place_id=ChIJAlpha';
  assert.throws(() => mock.ctx.addShop_(mock.ctx.parseMapLink_({google_maps: duplicate})), /已经存在/);
  assert.equal(mock.ctx.normalizeUrl_(url + '?ftid=0xAB:0xBC'),
    mock.ctx.normalizeUrl_(url + '!1s0xab:0xbc'));
  assert.equal(mock.ctx.normalizeUrl_('https://maps.apple.com/place?place-id=ABC&name=A'),
    mock.ctx.normalizeUrl_('https://maps.apple.com/place?name=B&place-id=ABC'));
  assert.equal(mock.rows.length, 4);
});

test('mock editing a location verifies the merged location and excludes only the current row', () => {
  const mock = mockAppsScript();
  const first = mock.ctx.addShop_(mock.parse(seoul));
  const second = mock.ctx.addShop_(mock.parse(paris));
  for (const conflict of [{city: 'Busan'}, {country_code: 'FR'}, {country: 'France'}, {google_maps: second.google_maps}]) {
    assert.throws(() => mock.ctx.updateShop_({id: first.id, ...conflict}), /归属/);
  }
  assert.throws(() => mock.ctx.updateShop_({id: first.id, latitude: 37.575}), /经纬度.*不一致/);
  assert.throws(() => mock.ctx.updateShop_({id: first.id, latitude: ''}), /缺少有效的经纬度/);
  assert.throws(() => mock.ctx.updateShop_({id: first.id, longitude: 181}), /缺少有效的经纬度/);
  assert.throws(() => mock.ctx.updateShop_({...v39Form(second), id: first.id}), /已经存在/);
  const ownLink = first.google_maps + '?hl=en';
  assert.equal(mock.ctx.updateShop_({id: first.id, google_maps: ownLink}).google_maps, ownLink);
  const newLink = 'https://www.google.com/maps?q=37.575,126.99';
  const moved = mock.ctx.updateShop_({id: first.id, google_maps: newLink});
  assert.equal(moved.latitude, 37.575);
  assert.equal(moved.longitude, 126.99);
  assert.equal(moved.city, 'Seoul');
  assert.equal(mock.ctx.updateShop_({...v39Form(mock.parse(shanghai)), id: first.id}).google_maps, '');
});

test('mock favorite, notes, rename, and archive with unchanged core fields avoid geocoding', () => {
  const mock = mockAppsScript();
  const original = mock.ctx.addShop_(mock.parse(tokyo));
  const before = [mock.geocodes().length, mock.fetches().length];
  assert.equal(mock.ctx.updateShop_({...v39Form(original), id: original.id, notes: 'Mock', name: 'Renamed'}).notes, 'Mock');
  assert.equal(mock.ctx.setFavorite_({id: original.id, favorite: true}).favorite, true);
  assert.equal(mock.ctx.archiveShop_({id: original.id}).active, false);
  assert.deepEqual([mock.geocodes().length, mock.fetches().length], before);
});

test('mock editing historical rows preserves legacy location data', () => {
  const mock = mockAppsScript();
  const legacy = {id: 'old', name: 'Old cafe', active: true, city: 'Tokyo', country: 'Japan',
    google_maps: 'https://www.google.com/maps/place/Old', apple_maps: 'old-side-link'};
  mock.rows.push(mock.headers.map(field => legacy[field] ?? ''));
  assert.equal(mock.ctx.setFavorite_({id: 'old', favorite: true}).favorite, true);
  assert.equal(mock.ctx.updateShop_({id: 'old', apple_maps: '', notes: 'Mock'}).notes, 'Mock');
  assert.equal(mock.rows[0][mock.headers.indexOf('country_code')], '');
  assert.equal(mock.rows[0][mock.headers.indexOf('latitude')], '');
  assert.equal(mock.rows[0][mock.headers.indexOf('apple_maps')], legacy.apple_maps);
  assert.equal(mock.fetches().length, 0);
  assert.equal(mock.geocodes().length, 0);
});

test('mock v39 parse/add/update JSON contract, plus health and list', () => {
  const mock = mockAppsScript();
  assert.equal(mock.post('parse', linkFor(paris), '').error, 'Unauthorized.');
  const parsed = mock.post('parse', linkFor(paris));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.place.city, 'Paris');
  assert.equal(parsed.place.needs_review, true);
  const add = mock.post('add', {...v39Form(parsed.place), favorite: false});
  assert.equal(add.ok, true);
  assert.ok(add.shop.id && add.shop.created_at && add.shop.updated_at);
  const update = mock.post('update', {...v39Form(add.shop), id: add.shop.id, notes: 'v39 payload'});
  assert.equal(update.ok, true);
  assert.equal(update.shop.id, add.shop.id);
  assert.equal(update.shop.notes, 'v39 payload');
  assert.equal(update.shop.country_code, 'FR');
  assert.equal(update.shop.latitude, parsed.place.latitude);
  assert.equal(mock.post('update', {...v39Form(add.shop), id: add.shop.id, country: 'Japan'}).ok, false);
  const health = JSON.parse(mock.ctx.doGet({parameter: {action: 'health'}}).value);
  assert.equal(health.version, 7);
  const list = JSON.parse(mock.ctx.doGet({parameter: {action: 'list', country_code: 'FR', city: 'Paris'}}).value);
  assert.equal(list.count, 1);
  assert.equal(list.shops[0].id, add.shop.id);
});

test('mock database environment requires explicit configuration and blocks cross-environment IDs', () => {
  const mock = mockAppsScript();
  const prodId = vm.runInContext('CONFIG.PRODUCTION_SPREADSHEET_ID', mock.ctx);
  const list = () => JSON.parse(mock.ctx.doGet({parameter: {action: 'list'}}).value);
  delete mock.properties.SPREADSHEET_ID;
  assert.equal(list().ok, false);
  mock.properties.SPREADSHEET_ID = prodId;
  assert.equal(list().ok, false);
  mock.properties.SPREADSHEET_ID = 'mock-copied-sheet';
  mock.properties.DATABASE_ENVIRONMENT = 'production';
  assert.equal(list().ok, false);
  assert.equal(mock.events.length, 0);
  mock.properties.DATABASE_ENVIRONMENT = 'candidate';
  assert.equal(list().ok, true);
  mock.headers.pop();
  assert.match(list().error, /header row/);
});
