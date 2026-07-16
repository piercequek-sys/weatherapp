/* Service worker for My Travel Pocket App.
   Strategy:
   - HTML navigations  → network-first (updates always land when online; cached shell offline)
   - same-origin assets → cache-first (they're version-stamped, so URLs change on deploy)
   - third-party (map tiles, weather APIs, fonts) → network-first with cache fallback
   Bump CACHE (and the ?v= asset version) on each deploy to retire the old cache. */
const CACHE = 'tpa-v20260716a';
const ASSET_V = '20260716';
const CORE = [
  './',
  './index.html',
  `./styles.css?v=${ASSET_V}`,
  `./app.js?v=${ASSET_V}`,
  './manifest.webmanifest',
  './icon.svg',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(CORE.map((u) => c.add(u)))) // don't fail install if one asset 404s
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // App shell: keep it fresh when online, fall back to the cached page offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put('./index.html', cp)); return r; })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  if (url.origin === location.origin) {
    // Versioned static assets — cache-first, populate on first miss.
    e.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((r) => {
        if (r && r.status === 200) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
        return r;
      }))
    );
    return;
  }

  // Third-party (tiles, weather/news APIs, fonts) — network-first, cached fallback offline.
  e.respondWith(
    fetch(req).then((r) => {
      if (r && (r.status === 200 || r.type === 'opaque')) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
      return r;
    }).catch(() => caches.match(req))
  );
});
