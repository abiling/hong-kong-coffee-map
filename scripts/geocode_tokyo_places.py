import json
from urllib.parse import quote
from urllib.request import Request, urlopen

PATH = 'tmp/tokyo-coffee-list.json'

JAPANESE_ADDRESSES = {
    'Lawn': '東京都新宿区四谷1丁目2',
    'Little Darling Coffee Roasters': '東京都港区南青山1丁目12-32',
    'LIWEI COFFEE': '東京都豊島区巣鴨1丁目19-10',
    'Allpress Espresso Tokyo Roastery & Cafe': '東京都江東区平野3丁目7-2',
    'LAMBERT': '東京都新宿区百人町3丁目22-15',
    'Bole COFFEE & ICE CREAM': '東京都世田谷区羽根木1丁目19-19',
    'SANU NOWHERE': '東京都目黒区中目黒3丁目23-16',
    'Friend in Hand': '東京都港区北青山3丁目6-20',
    'BARK BAKE & ROAST': '東京都台東区蔵前3丁目13-4',
    'Higuma Doughnuts × Coffee Wrights Omotesando': '東京都渋谷区神宮前4丁目9-13',
    'Ogawa Coffee Laboratory Shimokitazawa': '東京都世田谷区北沢3丁目19-20',
    'Et -THE CULTURAL COFFEEHOUSE-': '東京都世田谷区北沢2丁目22-3',
    'TERON COFFEE & BAR': '東京都中央区銀座3丁目11-3',
    'TOGO SHIMOKITAZAWA': '東京都世田谷区代田2丁目36-19',
    'Glitch Coffee and Roasters GINZA': '東京都中央区銀座4丁目14-8',
    'COFFEE COUNTY Tokyo': '東京都世田谷区北沢1丁目30-3',
    'Pharos Coffee Jimbocho': '東京都千代田区神田神保町1丁目25-4',
}


def gsi_search(address):
    url = 'https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + quote(address)
    request = Request(url, headers={'User-Agent': 'CoffeeShopsMap/1.0'})
    with urlopen(request, timeout=30) as response:
        return json.load(response)


with open(PATH, encoding='utf-8') as handle:
    data = json.load(handle)

for place in data['places']:
    address = JAPANESE_ADDRESSES.get(place['name'])
    if not address:
        continue
    results = gsi_search(address)
    if not results:
        place['gsi_error'] = 'no result'
        continue
    feature = results[0]
    longitude, latitude = feature['geometry']['coordinates']
    place['latitude'] = float(latitude)
    place['longitude'] = float(longitude)
    place['gsi_address'] = address
    place['gsi_title'] = feature.get('properties', {}).get('title', '')

with open(PATH, 'w', encoding='utf-8') as handle:
    json.dump(data, handle, ensure_ascii=False, indent=2)
