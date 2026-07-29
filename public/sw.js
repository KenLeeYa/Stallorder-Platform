const CACHE_NAME = "stallorder-shell-v2";
const OFFLINE_URL = "/offline";
const OFFLINE_DB_NAME = "stallorder-offline-pos";
const SHELL_ASSETS = [
  OFFLINE_URL,
  "/icons/stallorder-192.png",
  "/icons/stallorder-512.png",
];
const UNSYNCHRONIZED_STATUSES = new Set(["PENDING", "PROCESSING", "FAILED", "CONFLICT"]);

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) client.postMessage(message);
}

async function openExistingOfflineDatabase() {
  if (!self.indexedDB) return null;
  if (typeof self.indexedDB.databases === "function") {
    const databases = await self.indexedDB.databases();
    if (!databases.some((database) => database.name === OFFLINE_DB_NAME)) return null;
  }

  return new Promise((resolve) => {
    const request = self.indexedDB.open(OFFLINE_DB_NAME);
    request.addEventListener("upgradeneeded", () => {
      request.transaction?.abort();
      resolve(null);
    }, { once: true });
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => resolve(null), { once: true });
  });
}

function readAll(store) {
  return new Promise((resolve) => {
    const request = store.getAll();
    request.addEventListener("success", () => resolve(request.result ?? []), { once: true });
    request.addEventListener("error", () => resolve([]), { once: true });
  });
}

async function countUnsynchronizedRecords() {
  const database = await openExistingOfflineDatabase();
  if (!database) return 0;
  try {
    const stores = ["sync_queue", "offline_orders"].filter(
      (name) => database.objectStoreNames.contains(name),
    );
    if (stores.length === 0) return 0;
    const transaction = database.transaction(stores, "readonly");
    const [queue, orders] = await Promise.all([
      stores.includes("sync_queue")
        ? readAll(transaction.objectStore("sync_queue"))
        : [],
      stores.includes("offline_orders")
        ? readAll(transaction.objectStore("offline_orders"))
        : [],
    ]);
    return queue.filter((record) => UNSYNCHRONIZED_STATUSES.has(record.status ?? "PENDING")).length
      + orders.filter((record) => UNSYNCHRONIZED_STATUSES.has(record.sync_status ?? "PENDING")).length;
  } finally {
    database.close();
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS));
    if (self.registration.active) {
      await notifyClients({ type: "SW_UPDATE_AVAILABLE" });
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const pendingRecords = await countUnsynchronizedRecords();
    if (pendingRecords === 0) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "CHECK_UPDATE_SAFETY") {
    event.waitUntil(countUnsynchronizedRecords().then((pendingRecords) => {
      event.source?.postMessage({ type: "SW_UPDATE_SAFETY", pendingRecords });
    }));
    return;
  }

  if (event.data?.type === "ACTIVATE_UPDATE") {
    event.waitUntil((async () => {
      const pendingRecords = await countUnsynchronizedRecords();
      if (pendingRecords > 0) {
        await notifyClients({ type: "SW_UPDATE_BLOCKED", pendingRecords });
        return;
      }
      await self.skipWaiting();
    })());
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request).then(async (response) => {
    if (response.ok && !response.headers.get("cache-control")?.includes("no-store")) {
      await cache.put(request, response.clone());
    }
    return response;
  });
  return cached ?? network;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  const isVersionedStaticAsset = url.pathname.startsWith("/_next/static/");
  const isPwaIcon = url.pathname.startsWith("/icons/");
  if (isVersionedStaticAsset || isPwaIcon || url.pathname === OFFLINE_URL) {
    event.respondWith(cacheFirst(request));
    return;
  }

  const isStableProductImage = url.pathname.startsWith("/api/assets/product-images/");
  const isOfflineMenuSnapshot = url.pathname.startsWith("/api/assets/offline-menus/");
  const isPublicMenu = /^\/api\/public\/stalls\/[^/]+\/menu$/.test(url.pathname);
  if (isStableProductImage || isOfflineMenuSnapshot || isPublicMenu) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
