import json
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

path = 'tmp/tokyo-coffee-list.json'
with open(path, encoding='utf-8') as handle:
    data = json.load(handle)


def search(query_text):
    query = urlencode({
        'q': query_text,
        'format': 'jsonv2',
        'limit': 1,
        'viewbox': '139.45,35.85,139.95,35.45',
        'bounded': 1
    })
    request = Request('https://nominatim.openstreetmap.org/search?' + query, headers={'User-Agent': 'CoffeeShopsMap/1.0'})
    with urlopen(request, timeout=30) as response:
        return json.load(response)


for place in data['places']:
    if place.get('latitude') and place.get('longitude'):
        continue
    try:
        results = search(place.get('address') or '')
        time.sleep(1.1)
        if not results:
            results = search(place['name'] + ' Tokyo Japan')
        if results:
            place['latitude'] = float(results[0]['lat'])
            place['longitude'] = float(results[0]['lon'])
    except Exception as error:
        place['geocode_error'] = str(error)
    time.sleep(1.1)

with open(path, 'w', encoding='utf-8') as handle:
    json.dump(data, handle, ensure_ascii=False, indent=2)
