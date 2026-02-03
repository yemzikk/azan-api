// Service Worker for Prayer Times Kerala PWA
// Version 2.1.0 - With Push Notification Support

const CACHE_NAME = "prayer-times-kerala-v2.1.0";
const API_CACHE = "prayer-times-api-v2.1.0";
const OFFLINE_CACHE = "prayer-times-offline-v2.1.0";
const DB_NAME = "PrayerTimesDB";
const DB_VERSION = 1;

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

// Prayer notification messages (templates with placeholders)
const PRAYER_MESSAGES = {
  fajr: {
    title: "Fajr · {time}",
    body: "Time for Fajr prayer in {location}. Start your day with blessings.",
    icon: "🌙"
  },
  sunrise: {
    title: "Sunrise · {time}",
    body: "The sun has risen in {location}. May your day be blessed.",
    icon: "🌅"
  },
  dhuhr: {
    title: "Dhuhr · {time}",
    body: "Time for Dhuhr prayer in {location}. Take a moment to connect.",
    icon: "☀️"
  },
  asr: {
    title: "Asr · {time}",
    body: "Time for Asr prayer in {location}. Pause and reflect.",
    icon: "🌤️"
  },
  maghrib: {
    title: "Maghrib · {time}",
    body: "Time for Maghrib prayer in {location}. The day comes to a close.",
    icon: "🌇"
  },
  isha: {
    title: "Isha · {time}",
    body: "Time for Isha prayer in {location}. End your day in remembrance.",
    icon: "🌙"
  }
};

// ==========================================
// IndexedDB Helper Functions
// ==========================================

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Store for notification settings
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "id" });
      }

      // Store for prayer times
      if (!db.objectStoreNames.contains("prayerTimes")) {
        db.createObjectStore("prayerTimes", { keyPath: "id" });
      }

      // Store for scheduled notifications
      if (!db.objectStoreNames.contains("scheduledNotifications")) {
        const store = db.createObjectStore("scheduledNotifications", { keyPath: "id" });
        store.createIndex("time", "time", { unique: false });
        store.createIndex("notified", "notified", { unique: false });
      }
    };
  });
}

async function dbGet(storeName, key) {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const request = store.get(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  } catch (error) {
    console.error("DB Get Error:", error);
    return null;
  }
}

async function dbPut(storeName, data) {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.put(data);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  } catch (error) {
    console.error("DB Put Error:", error);
  }
}

async function dbGetAll(storeName) {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readonly");
      const store = transaction.objectStore(storeName);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  } catch (error) {
    console.error("DB GetAll Error:", error);
    return [];
  }
}

async function dbClear(storeName) {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  } catch (error) {
    console.error("DB Clear Error:", error);
  }
}

// ==========================================
// Notification Functions
// ==========================================

async function getNotificationSettings() {
  const settings = await dbGet("settings", "notifications");
  return settings || {
    id: "notifications",
    enabled: false,
    prayers: {
      fajr: true,
      sunrise: false,
      dhuhr: true,
      asr: true,
      maghrib: true,
      isha: true
    }
  };
}

async function getPrayerTimes() {
  const prayerTimes = await dbGet("prayerTimes", "today");
  return prayerTimes;
}

function parseTimeToDate(timeStr) {
  if (!timeStr) return null;

  try {
    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) return null;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const period = match[3].toUpperCase();

    if (period === "PM" && hours !== 12) {
      hours += 12;
    } else if (period === "AM" && hours === 12) {
      hours = 0;
    }

    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);
  } catch (error) {
    console.error("Failed to parse time:", timeStr, error);
    return null;
  }
}

async function scheduleNotifications() {
  const settings = await getNotificationSettings();
  const prayerTimes = await getPrayerTimes();

  if (!settings.enabled || !prayerTimes) {
    console.log("SW: Notifications disabled or no prayer times available");
    return;
  }

  // Clear existing scheduled notifications
  await dbClear("scheduledNotifications");

  const timeMapping = {
    fajr: "subh",
    sunrise: "sunrise",
    dhuhr: "duhr",
    asr: "asar",
    maghrib: "maghrib",
    isha: "isha"
  };

  const now = new Date();

  for (const [prayer, apiKey] of Object.entries(timeMapping)) {
    if (settings.prayers[prayer] && prayerTimes[apiKey]) {
      const prayerTime = parseTimeToDate(prayerTimes[apiKey]);

      if (prayerTime && prayerTime > now) {
        await dbPut("scheduledNotifications", {
          id: prayer,
          prayer: prayer,
          time: prayerTime.getTime(),
          timeStr: prayerTimes[apiKey],
          notified: false
        });
        console.log(`SW: Scheduled notification for ${prayer} at ${prayerTimes[apiKey]}`);
      }
    }
  }
}

async function checkAndShowNotifications() {
  const settings = await getNotificationSettings();

  if (!settings.enabled) {
    return;
  }

  const scheduledNotifications = await dbGetAll("scheduledNotifications");
  const now = Date.now();

  for (const notification of scheduledNotifications) {
    if (notification.notified) continue;

    const timeDiff = notification.time - now;

    // Show notification if within 1 minute window
    if (timeDiff <= 60000 && timeDiff >= -60000) {
      await showPrayerNotification(notification.prayer, notification.timeStr);

      // Mark as notified
      notification.notified = true;
      await dbPut("scheduledNotifications", notification);
    }
  }
}

async function showPrayerNotification(prayer, timeStr) {
  const message = PRAYER_MESSAGES[prayer];
  if (!message) return;

  // Get location name from stored prayer times
  const prayerTimes = await getPrayerTimes();
  const locationName = prayerTimes?.location || "your area";

  // Format the title and body with actual values
  const title = message.title
    .replace("{time}", timeStr || "Now");

  const body = message.body
    .replace("{location}", locationName)
    .replace("{time}", timeStr || "Now");

  const options = {
    body: body,
    icon: "/favicon/android-chrome-192x192.png",
    badge: "/favicon/favicon-32x32.png",
    tag: `prayer-${prayer}`,
    vibrate: [200, 100, 200, 100, 200],
    requireInteraction: true,
    renotify: true,
    data: {
      prayer: prayer,
      time: timeStr,
      location: locationName,
      url: "/"
    },
    actions: [
      {
        action: "view",
        title: "View Times",
        icon: "/favicon/favicon-32x32.png"
      },
      {
        action: "dismiss",
        title: "Dismiss"
      }
    ]
  };

  try {
    await self.registration.showNotification(title, options);
    console.log(`SW: Showed notification for ${prayer} at ${timeStr} in ${locationName}`);

    // Notify all clients
    const clients = await self.clients.matchAll({ type: "window" });
    clients.forEach(client => {
      client.postMessage({
        type: "PRAYER_NOTIFICATION_SHOWN",
        prayer: prayer,
        time: timeStr,
        location: locationName
      });
    });
  } catch (error) {
    console.error("SW: Failed to show notification:", error);
  }
}

// ==========================================
// Install Event
// ==========================================

self.addEventListener("install", (event) => {
  console.log("Service Worker: Installing v2.1.0...");

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
          console.warn("Service Worker: Failed to cache some core assets:", error);
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

      // Initialize database
      openDatabase().then(() => {
        console.log("Service Worker: Database initialized");
      })
    ])
  );

  // Force activation
  self.skipWaiting();
});

// ==========================================
// Activate Event
// ==========================================

self.addEventListener("activate", (event) => {
  console.log("Service Worker: Activating v2.1.0...");

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

      // Schedule notifications on activation
      scheduleNotifications()
    ])
  );
});

// ==========================================
// Fetch Event
// ==========================================

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== "GET") {
    return;
  }

  // Handle different types of requests
  if (url.pathname.startsWith("/v1/")) {
    event.respondWith(handleApiRequest(request));
  } else if (
    CORE_ASSETS.some(
      (asset) => url.pathname.includes(asset) || url.href.includes(asset)
    )
  ) {
    event.respondWith(handleCoreAssetRequest(request));
  } else {
    event.respondWith(handleNetworkRequest(request));
  }
});

async function handleApiRequest(request) {
  try {
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      const cache = await caches.open(API_CACHE);
      const responseClone = networkResponse.clone();

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

  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    const headers = new Headers(cachedResponse.headers);
    headers.set("sw-from-cache", "true");

    return new Response(cachedResponse.body, {
      status: cachedResponse.status,
      statusText: cachedResponse.statusText,
      headers: headers,
    });
  }

  return createOfflineResponse();
}

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

async function handleNetworkRequest(request) {
  try {
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      const cache = await caches.open(OFFLINE_CACHE);
      cache.put(request, networkResponse.clone());
      return networkResponse;
    }
  } catch (error) {
    console.log("Service Worker: Network request failed, trying cache");
  }

  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  return createOfflineResponse();
}

function createOfflineResponse() {
  return new Response(
    JSON.stringify({
      error: "Offline",
      message: "You are currently offline. Please check your internet connection.",
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

// ==========================================
// Background Sync
// ==========================================

self.addEventListener("sync", (event) => {
  console.log("Service Worker: Background sync triggered:", event.tag);

  if (event.tag === "check-prayer-notifications") {
    event.waitUntil(checkAndShowNotifications());
  } else if (event.tag === "schedule-notifications") {
    event.waitUntil(scheduleNotifications());
  }
});

// ==========================================
// Periodic Background Sync (for supported browsers)
// ==========================================

self.addEventListener("periodicsync", (event) => {
  console.log("Service Worker: Periodic sync triggered:", event.tag);

  if (event.tag === "prayer-notification-check") {
    event.waitUntil(checkAndShowNotifications());
  }
});

// ==========================================
// Message Handling
// ==========================================

self.addEventListener("message", async (event) => {
  const { type, data } = event.data;

  switch (type) {
    case "SKIP_WAITING":
      self.skipWaiting();
      break;

    case "GET_VERSION":
      event.ports[0].postMessage({ version: CACHE_NAME });
      break;

    case "CLEAR_CACHE":
      await clearAllCaches();
      event.ports[0].postMessage({ success: true });
      break;

    case "FORCE_UPDATE":
      await forceUpdate();
      event.ports[0].postMessage({ success: true });
      break;

    case "UPDATE_NOTIFICATION_SETTINGS":
      await dbPut("settings", {
        id: "notifications",
        ...data
      });
      await scheduleNotifications();
      console.log("SW: Notification settings updated");
      break;

    case "UPDATE_PRAYER_TIMES":
      await dbPut("prayerTimes", {
        id: "today",
        ...data,
        updatedAt: Date.now()
      });
      await scheduleNotifications();
      console.log("SW: Prayer times updated");
      break;

    case "CHECK_NOTIFICATIONS":
      await checkAndShowNotifications();
      break;

    case "SCHEDULE_NOTIFICATIONS":
      await scheduleNotifications();
      break;

    case "TEST_NOTIFICATION":
      const prayer = data?.prayer || "fajr";
      await showPrayerNotification(prayer, "Test Time");
      break;
  }
});

async function clearAllCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
  console.log("Service Worker: All caches cleared");
}

async function forceUpdate() {
  await clearAllCaches();
  const clients = await self.clients.matchAll();
  clients.forEach((client) => client.navigate(client.url));
}

// ==========================================
// Push Notification Handling
// ==========================================

self.addEventListener("push", (event) => {
  console.log("SW: Push event received");

  let data = {
    title: "Prayer Times",
    body: "Prayer time reminder",
    prayer: "general"
  };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: "/favicon/android-chrome-192x192.png",
    badge: "/favicon/favicon-32x32.png",
    tag: `prayer-${data.prayer}`,
    vibrate: [200, 100, 200, 100, 200],
    requireInteraction: true,
    data: {
      prayer: data.prayer,
      url: data.url || "/"
    },
    actions: [
      {
        action: "view",
        title: "View Times",
        icon: "/favicon/favicon-32x32.png"
      },
      {
        action: "dismiss",
        title: "Dismiss"
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ==========================================
// Notification Click Handling
// ==========================================

self.addEventListener("notificationclick", (event) => {
  console.log("SW: Notification clicked:", event.action);

  event.notification.close();

  if (event.action === "dismiss") {
    return;
  }

  // Open or focus the app
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Check if app is already open
      for (const client of clientList) {
        if (client.url.includes("azantimes.in") && "focus" in client) {
          return client.focus();
        }
      }

      // Open new window
      if (self.clients.openWindow) {
        const url = event.notification.data?.url || "/";
        return self.clients.openWindow(url);
      }
    })
  );
});

// ==========================================
// Notification Close Handling
// ==========================================

self.addEventListener("notificationclose", (event) => {
  console.log("SW: Notification closed:", event.notification.tag);
});

// ==========================================
// Startup: Check notifications periodically
// ==========================================

// Set up interval to check notifications (runs when SW is active)
let notificationCheckInterval = null;

function startNotificationChecker() {
  if (notificationCheckInterval) {
    clearInterval(notificationCheckInterval);
  }

  // Check every 30 seconds
  notificationCheckInterval = setInterval(() => {
    checkAndShowNotifications();
  }, 30000);

  // Also check immediately
  checkAndShowNotifications();

  console.log("SW: Notification checker started");
}

// Start checker when SW activates
self.addEventListener("activate", () => {
  startNotificationChecker();
});

console.log("Service Worker v2.1.0: Loaded successfully with Push Notification support");
