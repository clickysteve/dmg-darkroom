/**
 * sw.js — DMG DarkRoom service worker (web build only).
 *
 * Precaches the app shell so the web app works offline, then serves
 * same-origin requests stale-while-revalidate: cached response immediately,
 * refreshed from the network in the background for next load.
 */

const CACHE = 'dmg-darkroom-v1';

const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/palettes.js',
  './js/palettes-ext.js',
  './js/gbcam.js',
  './js/web-api.js',
  './js/app.js',
  './js/gifenc.esm.js',
  './js/gif-worker.js',
  './js/jszip.esm.js',
  './icon.png',
  './favicon.ico',
  './manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // network for cross-origin (e.g. Lospec)

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => cached); // offline: fall back to cache (may be undefined)
      return cached || network;
    })
  );
});
