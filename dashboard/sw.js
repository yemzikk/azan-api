/* Azan static PWA. Updates come from the network; cached files are an offline fallback. */
const VERSION = 'azan-v4';
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;
const APP_ROOT = new URL('./', self.registration.scope);
const appUrl = (path) => new URL(path, APP_ROOT).href;
const SHELL_FILES = [
  'index.html',
  'css/dashboard.css',
  'js/app.js',
  'js/prayer-data.js',
  'js/notifications.js',
  'js/export-image.js',
  'js/export-data.js',
  'brand/azantimes-mark.svg',
  'brand/azantimes-logo.svg',
  'brand/azantimes-logo-light.svg',
  'brand/zikklabs-product-badge.svg',
  'brand/zikklabs-product-badge-light.svg',
  'fonts/atkinson-hyperlegible-next-latin.woff2',
  'favicon/site.webmanifest',
  'favicon/android-chrome-192x192.png',
  'favicon/android-chrome-512x512.png',
];
const OWN_CACHE = /^(?:azan-|prayer-times-(?:kerala|api|offline)-)/;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // A failed install leaves the previous complete worker in place.
    await cache.addAll(SHELL_FILES.map((file) => new Request(appUrl(file), { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => OWN_CACHE.test(name)
      && ![SHELL_CACHE, DATA_CACHE].includes(name)).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

function unavailable() {
  return new Response(JSON.stringify({ error: 'offline', message: 'This timetable is not saved on this device yet.' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json', 'sw-offline': 'true' },
  });
}

async function fetchWithTimeout(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(request, { signal: controller.signal });
    // Keep the deadline active until the body arrives too. A stalled transfer
    // must not block cache.put or prevent an available offline fallback.
    await response.clone().arrayBuffer();
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function networkFirst(request, cacheName, { navigation = false, data = false } = {}) {
  let cache;
  try { cache = await caches.open(cacheName); } catch (_) { /* Online use still works when storage is restricted. */ }
  try {
    const response = await fetchWithTimeout(request);
    if (cache && response.ok && (!data || response.headers.get('Content-Type')?.includes('json'))) {
      // Await writes so a terminated worker cannot lose the offline copy.
      try { await cache.put(request, response.clone()); } catch (_) { /* Quota limits must not hide current network data. */ }
    }
    // Server errors may use a saved timetable; 404s must stay visible.
    if (response.status < 500) return response;
  } catch (_) {
    // The saved response below is used only when the network is unavailable.
  }
  let saved;
  try { saved = await cache?.match(request); } catch (_) { /* Saved data may have been evicted. */ }
  if (saved) {
    if (!data) return saved;
    const headers = new Headers(saved.headers);
    headers.set('sw-from-cache', 'true');
    return new Response(saved.body, { status: saved.status, statusText: saved.statusText, headers });
  }
  if (navigation) {
    let shell;
    try { shell = await caches.match(appUrl('index.html')); } catch (_) { /* Storage is optional. */ }
    if (shell) return shell;
    return new Response('Azan is offline. Connect once to save this app.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return data ? unavailable() : Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === APP_ROOT.origin;
  const apiRequest = (sameOrigin || url.origin === 'https://api.azantimes.in')
    && (url.pathname.startsWith('/v1/') || url.pathname.includes('/dashboard/v1/')
      || url.pathname.endsWith('/districts.json'));
  if (apiRequest) {
    event.respondWith(networkFirst(request, DATA_CACHE, { data: true }));
  } else if (sameOrigin && url.pathname.startsWith(APP_ROOT.pathname)) {
    if (request.mode === 'navigate') {
      event.respondWith(networkFirst(request, SHELL_CACHE, { navigation: true }));
    } else if (['script', 'style', 'image', 'font', 'manifest'].includes(request.destination)) {
      event.respondWith(networkFirst(request, SHELL_CACHE));
    }
  }
});

self.addEventListener('message', (event) => {
  const type = event.data?.type;
  event.waitUntil((async () => {
    if (type === 'SKIP_WAITING') await self.skipWaiting();
    if (type === 'GET_VERSION') event.ports[0]?.postMessage({ version: VERSION });
    if (type === 'CLEAR_CACHE' || type === 'FORCE_UPDATE') {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => OWN_CACHE.test(name)).map((name) => caches.delete(name)));
      event.ports[0]?.postMessage({ success: true });
    }
    if (type === 'TEST_NOTIFICATION') {
      await self.registration.showNotification('Azan reminder', {
        body: 'Reminders work while the Azan page is open. Keep this tab open for prayer alerts.',
        icon: appUrl('favicon/android-chrome-192x192.png'),
        tag: 'azan-test',
        data: { url: APP_ROOT.href },
      });
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const requested = new URL(event.notification.data?.url || APP_ROOT.href, APP_ROOT);
    const target = requested.origin === APP_ROOT.origin && requested.pathname.startsWith(APP_ROOT.pathname)
      ? requested.href : APP_ROOT.href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => client.url.startsWith(APP_ROOT.href));
    if (existing) {
      if (existing.navigate && existing.url !== target) await existing.navigate(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  })());
});
