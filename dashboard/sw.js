// Service Worker for Prayer Times Kerala PWA

const CACHE_NAME = "prayer-times-kerala-v2.0.0";
const API_CACHE = "prayer-times-api-v2.0.0";
const OFFLINE_CACHE = "prayer-times-offline-v2.0.0";

// Core files to cache for offline functionality
const CORE_ASSETS = [
  "/index.html",
  "/favicon/android-chrome-192x192.png",
  "/favicon/android-chrome-512x512.png",
  "/favicon/apple-touch-icon.png",
  "/favicon/favicon-32x32.png",
  "/favicon/favicon-16x16.png",
  "/favicon/favicon.ico",
  "/favicon/site.webmanifest",
  "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css",
];

// API endpoints to cache
const API_ENDPOINTS = ["https://api.azantimes.in/v1/timesheets/index.json"];

// Install event - cache core assets
self.addEventListener("install", (event) => {
  console.log("Service Worker: Installing...");

  event.waitUntil(
    Promise.all([
      // Cache core assets
      caches
        .open(CACHE_NAME)
        .then((cache) => {
          console.log("Service Worker: Caching core assets");
          return cache.addAll(
            CORE_ASSETS.map(
              (url) =>
                new Request(url, {
                  mode: "cors",
                  credentials: "omit",
                })
            )
          );
        })
        .catch((error) => {
          console.warn(
            "Service Worker: Failed to cache some core assets:",
            error
          );
        }),

      // Cache API endpoints
      caches.open(API_CACHE).then((cache) => {
        console.log("Service Worker: Caching API endpoints");
        return Promise.all(
          API_ENDPOINTS.map((url) =>
            fetch(url)
              .then((response) => {
                if (response.ok) {
                  return cache.put(url, response);
                }
              })
              .catch((error) => {
                console.warn(`Service Worker: Failed to cache ${url}:`, error);
              })
          )
        );
      }),
    ])
  );

  // Force activation
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  console.log("Service Worker: Activating...");

  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (
              cacheName !== CACHE_NAME &&
              cacheName !== API_CACHE &&
              cacheName !== OFFLINE_CACHE
            ) {
              console.log("Service Worker: Deleting old cache:", cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),

      // Take control of all pages
      self.clients.claim(),
    ])
  );
});

// Fetch event - serve from cache with network fallback
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== "GET") {
    return;
  }

  // Handle different types of requests
  if (url.pathname.startsWith("/v1/")) {
    // API requests - Cache First with Network Fallback
    event.respondWith(handleApiRequest(request));
  } else if (
    CORE_ASSETS.some(
      (asset) => url.pathname.includes(asset) || url.href.includes(asset)
    )
  ) {
    // Core assets - Cache First
    event.respondWith(handleCoreAssetRequest(request));
  } else {
    // Other requests - Network First with Cache Fallback
    event.respondWith(handleNetworkRequest(request));
  }
});

// Handle API requests with intelligent caching
async function handleApiRequest(request) {
  const url = new URL(request.url);

  try {
    // Try network first for fresh data
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      // Cache successful responses
      const cache = await caches.open(API_CACHE);
      const responseClone = networkResponse.clone();

      // Add timestamp to cached response
      const headers = new Headers(responseClone.headers);
      headers.set("sw-cached-at", new Date().toISOString());

      const modifiedResponse = new Response(responseClone.body, {
        status: responseClone.status,
        statusText: responseClone.statusText,
        headers: headers,
      });

      cache.put(request, modifiedResponse);
      return networkResponse;
    }
  } catch (error) {
    console.log("Service Worker: Network failed for API request, trying cache");
  }

  // Fallback to cache
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    // Add offline indicator to cached response
    const headers = new Headers(cachedResponse.headers);
    headers.set("sw-from-cache", "true");

    return new Response(cachedResponse.body, {
      status: cachedResponse.status,
      statusText: cachedResponse.statusText,
      headers: headers,
    });
  }

  // Return offline fallback
  return createOfflineResponse();
}

// Handle core asset requests
async function handleCoreAssetRequest(request) {
  const cachedResponse = await caches.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
      return networkResponse;
    }
  } catch (error) {
    console.log("Service Worker: Failed to fetch core asset:", request.url);
  }

  return createOfflineResponse();
}

// Handle other network requests
async function handleNetworkRequest(request) {
  try {
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      // Cache successful responses for offline access
      const cache = await caches.open(OFFLINE_CACHE);
      cache.put(request, networkResponse.clone());
      return networkResponse;
    }
  } catch (error) {
    console.log("Service Worker: Network request failed, trying cache");
  }

  // Fallback to cache
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  return createOfflineResponse();
}

// Create offline response
function createOfflineResponse() {
  return new Response(
    JSON.stringify({
      error: "Offline",
      message:
        "You are currently offline. Please check your internet connection.",
      cached: true,
    }),
    {
      status: 503,
      statusText: "Service Unavailable",
      headers: {
        "Content-Type": "application/json",
        "sw-offline": "true",
      },
    }
  );
}

// Handle background sync for offline actions
self.addEventListener("sync", (event) => {
  console.log("Service Worker: Background sync triggered:", event.tag);

  if (event.tag === "update-preferences") {
    event.waitUntil(syncPreferences());
  }
});

// Sync user preferences when back online
async function syncPreferences() {
  try {
    // Get stored preferences
    const preferences = await getStoredPreferences();

    if (preferences) {
      console.log("Service Worker: Syncing preferences when back online");
      // Could sync with server if needed
    }
  } catch (error) {
    console.error("Service Worker: Failed to sync preferences:", error);
  }
}

// Get stored preferences from IndexedDB (if available)
async function getStoredPreferences() {
  try {
    // This would be implemented if server sync is needed
    return null;
  } catch (error) {
    return null;
  }
}

// Listen for messages from the main thread
self.addEventListener("message", (event) => {
  const { type, data } = event.data;

  switch (type) {
    case "SKIP_WAITING":
      self.skipWaiting();
      break;

    case "GET_VERSION":
      event.ports[0].postMessage({ version: CACHE_NAME });
      break;

    case "CLEAR_CACHE":
      clearAllCaches().then(() => {
        event.ports[0].postMessage({ success: true });
      });
      break;

    case "FORCE_UPDATE":
      forceUpdate().then(() => {
        event.ports[0].postMessage({ success: true });
      });
      break;
  }
});

// Clear all caches
async function clearAllCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
  console.log("Service Worker: All caches cleared");
}

// Force update by clearing caches and reloading
async function forceUpdate() {
  await clearAllCaches();
  const clients = await self.clients.matchAll();
  clients.forEach((client) => client.navigate(client.url));
}

// Push notification handling (for future prayer time reminders)
self.addEventListener("push", (event) => {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body || "Prayer time reminder",
      icon: "/favicon/android-chrome-192x192.png",
      badge: "/favicon/favicon-32x32.png",
      tag: "prayer-reminder",
      vibrate: [200, 100, 200],
      actions: [
        {
          action: "view",
          title: "View Times",
          icon: "/favicon/favicon-32x32.png",
        },
        {
          action: "dismiss",
          title: "Dismiss",
        },
      ],
    };

    event.waitUntil(
      self.registration.showNotification(data.title || "Prayer Times", options)
    );
  }
});

// Handle notification clicks
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "view") {
    event.waitUntil(clients.openWindow("https://azantimes.in/"));
  }
});

console.log("Service Worker: Loaded successfully");
