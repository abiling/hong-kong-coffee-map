const CACHE_PREFIX = 'coffee-map-v';
const CACHE = 'coffee-map-v40';
const SHELL = [
  './', './index.html', './fonts.css?v=36', './styles.css?v=36', './admin.css?v=36',
  './filter-scroll.css?v=36', './compact-nav.css?v=36', './city-list-fix.css?v=36', './dynamic-location.css?v=40',
  './location-catalog.js?v=40', './map-config.js?v=40', './multicity.js?v=40', './compact-search.js?v=40',
  './app.js?v=40', './admin-core.js?v=40', './manifest.webmanifest',
  './icons/mark-cafe-shops.svg',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => cacheMatch('./index.html'))
    );
    return;
  }

  event.respondWith(cacheMatch(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
    }
    return response;
  })));
});

async function cacheMatch(request) {
  const cache = await caches.open(CACHE);
  return cache.match(request);
}
