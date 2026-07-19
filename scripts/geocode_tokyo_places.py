import json
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

path = 'tmp/tokyo-coffee-list.json'
with open(path, encoding='utf-8') as handle:
    data = json.load(handle)

for place in data['places']:
    if place.get('latitude') and place.get('longitude'):
        continue
    query = urlencode({'q': place.get('address') or (place['name'] + ' Tokyo Japan'), 'format': 'jsonv2', 'limit': 1})
    request = Request('https://nominatim.openstreetmap.org/search?' + query, headers={'User-Agent': 'CoffeeShopsMap/1.0'})
    try:
        with urlopen(request, timeout=30) as response:
            results = json.load(response)
        if results:
            place['latitude'] = float(results[0]['lat'])
            place['longitude'] = float(results[0]['lon'])
    except Exception as error:
        place['geocode_error'] = str(error)
    time.sleep(1.1)

with open(path, 'w', encoding='utf-8') as handle:
    json.dump(data, handle, ensure_ascii=False, indent=2)
