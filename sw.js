/* Einkaufzettel PWA Service Worker (v1)
 * Cache-Strategie:
 * - Navigation (HTML): Network-first, fallback cache
 * - Statische Assets (same-origin GET): Stale-while-revalidate
 */
const CACHE_NAME = 'einkaufszettel-pwa-v1';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const base = self.registration.scope; // endet mit '/'
    const urls = [
      base,
      base + 'index.php',
      base + 'links/website.manifest.php',
      base + 'links/style.css',
      base + 'links/icon.svg',
      base + 'links/apple-touch-icon.png',
      base + 'bin/frontend.js'
    ];
    for (const u of urls) {
      try { await cache.add(u); } catch (e) { /* ignore */ }
    }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      for (const k of keys) {
        if (k !== CACHE_NAME && k.startsWith('einkaufszettel-pwa-')) {
          await caches.delete(k);
        }
      }
    } catch (e) {}
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const resp = await fetch(request);
    if (resp && resp.ok) {
      try { await cache.put(request, resp.clone()); } catch (e) {}
    }
    return resp;
  } catch (e) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    // Fallback: App-Shell
    const base = self.registration.scope;
    const shell = await cache.match(base, { ignoreSearch: true });
    if (shell) return shell;
    throw e;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  const fetchPromise = (async () => {
    try {
      const resp = await fetch(request);
      if (resp && resp.ok) {
        try { await cache.put(request, resp.clone()); } catch (e) {}
      }
      return resp;
    } catch (e) {
      return null;
    }
  })();

  return cached || (await fetchPromise) || cached;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Nur GET cachen
  if (req.method !== 'GET') return;

  // Nur same-origin
  if (url.origin !== self.location.origin) return;

  // Navigation: HTML
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Assets: SWR
  event.respondWith(staleWhileRevalidate(req));
});
