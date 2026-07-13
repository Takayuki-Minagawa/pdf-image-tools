const CACHE_PREFIX = 'pdf-image-tools';
const CACHE_NAME = `${CACHE_PREFIX}-2026-07-13-1`;
const APP_ROOT = self.registration.scope;
const APP_SHELL = [
  APP_ROOT,
  new URL('index.html', APP_ROOT).toString(),
  new URL('manifest.webmanifest', APP_ROOT).toString(),
  new URL('favicon.svg', APP_ROOT).toString(),
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME)
            .map((cacheName) => caches.delete(cacheName)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response.status === 200) await cache.put(APP_ROOT, response.clone());
    return response;
  } catch {
    return (
      (await cache.match(APP_ROOT)) ||
      (await cache.match(new URL('index.html', APP_ROOT).toString())) ||
      new Response(
        '<!doctype html><html lang="ja"><meta charset="utf-8"><title>オフライン</title><body><h1>オフラインです</h1><p>オンラインに戻ってから、もう一度お試しください。</p></body></html>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      )
    );
  }
}

async function cacheFirstAsset(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) return cachedResponse;

  const response = await fetch(request);
  if (response.status === 200) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  event.respondWith(cacheFirstAsset(request));
});
