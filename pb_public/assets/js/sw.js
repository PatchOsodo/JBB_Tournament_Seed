const CACHE_NAME = 'jb254-v1';
const OFFLINE_URL = 'index.html';

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll([
      'index.html',
      'assets/css/styles.css',
      'assets/img/favicon-192.png',
    ]))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for API calls (never serve stale PocketBase data), cache-first
// fallback only for the app shell itself when totally offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return; // let PocketBase calls fail naturally — App.js already shows the offline banner

  e.respondWith(
    fetch(e.request).catch(() =>
      caches.match(e.request).then(cached => cached || caches.match(OFFLINE_URL))
    )
  );
});
