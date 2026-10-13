// Service worker template. vite.config.ts fills in VERSION and PRECACHE at build time and emits /sw.js.
/* global self, caches, fetch, URL, Response */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const SHELL = `recdeck-shell-${VERSION}`;
const API = 'recdeck-api';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('recdeck-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POSTs go straight to the network; the result queue handles failure.
  const url = new URL(req.url);

  // Network-first for the Worker API (any origin), falling back to the last good response.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(API).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { cacheName: API }).then((hit) => hit || Response.error())),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // App navigations: the precached shell (hash routing means one document).
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('/index.html').then((hit) => hit || fetch(req)));
    return;
  }

  // Cache-first for assets.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
