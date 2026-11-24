const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../apps-script/Coffee_Shops_Map_API_v7.gs'), 'utf8');
const response = result => ({ status: 'OK', results: [result] });
const component = (type, long_name, short_name = long_name) => ({types:[type],long_name,short_name});
const fixtures = [
  ['Hong Kong','HK','Hong Kong SAR',22.286,114.151,'Hong Kong','Hong Kong','Central','Sheung Wan'],
  ['Tokyo','JP','Japan',35.667,139.708,'Shibuya City','Tokyo','Shibuya','Jingumae'],
  ['Beijing','CN','China',39.916336,116.449427,'Beijing','Beijing','朝阳区','日坛'],
  ["Xi'an",'CN','China',34.253125,108.949725,'Xian','Shaanxi','碑林区','书院门'],
  ['Shanghai','CN','China',31.23,121.46,'Shanghai','Shanghai','静安区','南京西路'],
  ['Seoul','KR','South Korea',37.574,126.989,'Seoul','Seoul','Jongno-gu','Ikseon-dong'],
  ['Paris','FR','France',48.8566,2.3522,'Paris','Île-de-France','Paris','Le Marais']
];
const geo = ([city,code,country,lat,lng,locality,admin,region,district]) => ({
  geometry:{ location:{lat,lng} }, formatted_address:[district,region,city,country].join(', '),
  address_components:[
    component('country',country,code),component('locality',locality),component('administrative_area_level_1',admin),
    component('sublocality_level_1',region),component('neighborhood',district)
  ]
});
const rows = [], calls = [];
let forward = [], reverseOverride, seq = 0, redirect = '';
let ctx = vm.createContext({
  console:{error(){},log(){}},
  Maps:{newGeocoder:()=>({
    setLanguage:()=>({
      geocode:q=>{calls.push(['forward',q]);return {status:'OK',results:forward};},
      reverseGeocode:(lat,lng)=>{
        calls.push(['reverse',lat,lng]);
        if (reverseOverride) return reverseOverride;
        const f=fixtures.find(x=>Math.abs(x[3]-lat)<.02 && Math.abs(x[4]-lng)<.02);
        assert.ok(f);return response(geo(f));
      }
    })
  })},
  UrlFetchApp:{fetch:url=>{
    calls.push(['fetch',url]);
    const to=redirect; redirect='';
    return {getResponseCode:()=>to?302:200,getAllHeaders:()=>to?{Location:to}:{}};
  }},
  PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'fixture-only'})},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:value=>({value,setMimeType(){return this;}})},
  Utilities:{getUuid:()=>String(++seq).padStart(8,'0')+'-fixture',formatDate:()=> '2026-11-24T17:00:00+0800'}
});
vm.runInContext(source,ctx);
ctx.readShops_=()=>rows.map(r=>ctx.normalizeShopOutput_(ctx.rowToObject_(vm.runInContext('CONFIG.HEADERS',ctx),r)));
ctx.getSheet_=()=>({appendRow:row=>rows.push(row)});
ctx.withWriteLock_=cb=>cb();
const urlFor = ([city,code,,lat,lng]) => code==='CN'
  ? 'https://maps.apple.com/place?name='+encodeURIComponent(city+' Ritan')+'&coordinate='+lat+','+lng+'&address='+encodeURIComponent('Cafe, '+city+' China')
  : 'https://www.google.com/maps/place/'+encodeURIComponent(city+' Cafe')+'/@35,139,12z/data=!3d'+lat+'!4d'+lng;
const parse=(f,hint={city:'Tokyo',country_code:'JP'})=>ctx.parseMapLink_({...hint,[f[1]==='CN'?'apple_maps':'google_maps']:urlFor(f)});
const places=fixtures.map(f=>{
  const place=parse(f,f[1]==='CN'?{city:'Beijing',country_code:'CN'}:undefined);
  assert.equal(place.city,f[0]);
  assert.equal(place.country_code,f[1]);
  assert.equal(place.country,f[2]);
  assert.ok(place.region && place.district);
  assert.equal(Boolean(place.apple_maps),f[1]==='CN');
  return place;
});
for(const [i,lat,lng] of [[2,39.9149684,116.4432319],[3,34.2547094,108.9450618]]) {
  assert.ok(Math.abs(places[i].latitude-lat)<.00002);
  assert.ok(Math.abs(places[i].longitude-lng)<.00002);
}
assert.equal(vm.runInContext('CONFIG.CITY_CONFIG.Paris || CONFIG.COUNTRY_CONFIG.FR',ctx),undefined);
assert.equal(ctx.extractCoordinates_('https://www.google.com/maps/place/Cafe/@35,139,12z'),null);
assert.throws(()=>ctx.addShop_({...places[4],city:'Beijing'}),/归属/);
for (const i of [2,4,5,6]) assert.equal(ctx.addShop_(places[i]).city,fixtures[i][0]);
assert.equal(rows.length,4);
assert.throws(()=>ctx.addShop_(places[4]),/已经存在/);
assert.equal(ctx.filterShops_(ctx.readShops_(),{country_code:'FR'}).length,1);
assert.equal(ctx.normalizeUrl_('https://maps.apple.com/place?place-id=ABC&name=A'),ctx.normalizeUrl_('https://maps.apple.com/place?name=B&place-id=ABC'));
reverseOverride={status:'ZERO_RESULTS',results:[]};
assert.throws(()=>parse(fixtures[5]),/无法可靠/);
reverseOverride=response({address_components:[component('country','France','FR')]});
assert.throws(()=>parse(fixtures[5]),/无法可靠/);
reverseOverride={status:'OVER_QUERY_LIMIT',results:[]};
assert.throws(()=>parse(fixtures[5]),/配额/);
reverseOverride=null;
forward=[geo(fixtures[5])];
const nameOnly={city:'Tokyo',country_code:'JP',google_maps:'https://www.google.com/maps/place/Cafe+Seoul'};
assert.equal(ctx.parseMapLink_(nameOnly).city,'Seoul');
assert.ok(calls.some(x=>x[0]==='forward' && x[1]==='Cafe Seoul'));
forward.push(geo(fixtures[6]));
assert.throws(()=>ctx.parseMapLink_(nameOnly),/多个地点/);
const count=calls.length;
redirect='https://example.invalid/unsupported';
assert.throws(()=>parse(fixtures[5]),/Google Maps/);
assert.equal(calls.slice(count).filter(x=>x[0]==='fetch').length,1);
assert.equal(JSON.parse(ctx.doGet({parameter:{action:'health'}}).value).version,7);
assert.equal(JSON.parse(ctx.doPost({postData:{contents:JSON.stringify({action:'parse'})}}).value).error,'Unauthorized.');
console.log('Mocked parser + write checks: '+places.map(x=>x.city+'/'+x.country_code).join(', '));
