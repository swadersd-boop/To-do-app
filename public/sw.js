// Offline support. Pages load from the network first so updates show up
// right away; everything else is served from cache and refreshed behind it.
const CACHE = 'kalm-v1';

const SHELL = ['./', './manifest.webmanifest', './icon.svg', './icon-180.png', './icon-192.png'];

self.addEventListener('install', (event) => {
  // A failed precache must not block the install: the fetch handler fills the cache anyway.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  const fromNetwork = fetch(req).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  });

  if (req.mode === 'navigate') {
    event.respondWith(fromNetwork.catch(() => caches.match(req).then((hit) => hit || caches.match('./'))));
    return;
  }
  event.respondWith(caches.match(req).then((hit) => hit || fromNetwork));
  event.waitUntil(fromNetwork.catch(() => undefined));
});
