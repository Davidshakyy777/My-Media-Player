const CACHE_NAME = 'purpleplayer-shell-v1';
const FILES_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/images/icon-192.png',
  '/images/icon-512.png',
  '/images/favicon.ico'
];

// install
self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(FILES_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// activate
self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(k => { if (k !== CACHE_NAME) return caches.delete(k); })
    ))
  );
  self.clients.claim();
});

// fetch: respond with cache first, then network, fallback to /index.html
self.addEventListener('fetch', (evt) => {
  if (evt.request.method !== 'GET') return;
  evt.respondWith(
    caches.match(evt.request).then(cached => {
      if (cached) return cached;
      return fetch(evt.request).then(res => {
        return caches.open(CACHE_NAME).then(cache => {
          // avoid caching opaque responses (cross-origin)
          try { if (res && res.type === 'basic') cache.put(evt.request, res.clone()); } catch(e){}
          return res;
        });
      }).catch(() => {
        // fallback for navigation requests
        if (evt.request.mode === 'navigate') return caches.match('/index.html');
      });
    })
  );
});
