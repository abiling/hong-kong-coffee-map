const CACHE = 'coffee-map-v39-20261124-phase-1';
const SHELL = [
  './', './index.html', './fonts.css?v=36', './styles.css?v=36', './admin.css?v=36',
  './filter-scroll.css?v=36', './compact-nav.css?v=36', './city-list-fix.css?v=36', './dynamic-location.css?v=38',
  './location-catalog.js?v=39', './map-config.js?v=39', './multicity.js?v=39', './compact-search.js?v=36',
  './app.js?v=39', './admin-core.js?v=39', './manifest.webmanifest',
  './icons/mark-cafe-shops.svg',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
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
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }
        return response;
      });
      return cached || network;
    })
  );
});
