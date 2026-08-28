const CACHE_NAME = "stallorder-shell-v9";
const OFFLINE_URL = "/offline";
const OFFLINE_DB_NAME = "stallorder-offline-pos";
const OFFLINE_PUBLIC_MENU_RESPONSE = "public-menu-v1";
const IS_LOCAL_DEVELOPMENT = ["localhost", "127.0.0.1", "[::1]"].includes(self.location.hostname)
  && !new URL(self.location.href).searchParams.has("pwa-enabled");
const SHELL_ASSETS = [
  "/icons/stallorder-192.png",
  "/icons/stallorder-512.png",
];
const UNSYNCHRONIZED_STATUSES = new Set(["PENDING", "PROCESSING", "FAILED", "CONFLICT", "REJECTED"]);

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

async function cacheOfflineShell() {
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch(OFFLINE_URL, { cache: "reload" });
  if (!response.ok) throw new Error("OFFLINE_SHELL_FETCH_FAILED");
  const html = await response.clone().text();
  await cache.put(OFFLINE_URL, response);

  const referencedAssets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((path) => path.startsWith("/_next/static/"));
  const assetPaths = [...new Set([...SHELL_ASSETS, ...referencedAssets])];
  await Promise.all(assetPaths.map(async (path) => {
    const assetResponse = await fetch(path, { cache: "reload" });
    if (assetResponse.ok) await cache.put(path, assetResponse);
  }));
}

async function purgeSensitiveNavigationEntries() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith("stallorder-shell-")).map(async (key) => {
    const cache = await caches.open(key);
    const requests = await cache.keys();
    await Promise.all(requests.map((request) => {
      const url = new URL(request.url);
      return url.search ? cache.delete(request) : Promise.resolve(false);
    }));
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    if (IS_LOCAL_DEVELOPMENT) {
      await self.skipWaiting();
      return;
    }
    await cacheOfflineShell();
    if (self.registration.active) {
      await notifyClients({ type: "SW_UPDATE_AVAILABLE" });
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    if (IS_LOCAL_DEVELOPMENT) {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith("stallorder-shell-")).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      await self.registration.unregister();
      await Promise.all(clients.map((client) => client.navigate(client.url)));
      return;
    }
    await purgeSensitiveNavigationEntries();
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

self.addEventListener("sync", (event) => {
  if (event.tag !== "stallorder-offline-sync") return;
  event.waitUntil(notifyClients({ type: "OFFLINE_SYNC_REQUESTED" }));
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

async function networkFirstRevocableAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok && !response.headers.get("cache-control")?.includes("no-store")) {
      await cache.put(request, response.clone());
    } else if (response.status === 404 || response.status === 410) {
      await cache.delete(request);
    }
    return response;
  } catch {
    return await cache.match(request) ?? new Response(null, { status: 503 });
  }
}

async function networkFirstPublicMenuNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  try {
    const response = await fetch(request);
    const cacheControl = response.headers.get("cache-control") ?? "";
    const hasSensitiveQuery = new URL(request.url).search.length > 0;
    const explicitlyOfflineCacheable = response.headers.get("x-stallorder-offline-cache")
      === OFFLINE_PUBLIC_MENU_RESPONSE;
    const cacheAllowed = response.ok
      && !hasSensitiveQuery
      && (explicitlyOfflineCacheable
        || !/(?:^|,)\s*(?:private|no-store)\b/i.test(cacheControl));
    if (cacheAllowed) await cache.put(request, response.clone());
    else if (hasSensitiveQuery || response.status === 404 || response.status === 410) {
      await cache.delete(request);
    }
    if (response.status >= 500 && cached) return cached;
    return response;
  } catch {
    return cached ?? caches.match(OFFLINE_URL);
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    const isLegacyStorefrontNavigation = /^\/(?:menu|s|delivery)\/[^/]+$/.test(url.pathname);
    if (isLegacyStorefrontNavigation) return;
    const isPublicMenuNavigation = /^\/q\/[^/]+$/.test(url.pathname)
      || /^\/store\/[^/]+$/.test(url.pathname);
    event.respondWith(isPublicMenuNavigation
      ? networkFirstPublicMenuNavigation(request)
      : fetch(request).catch(() => caches.match(OFFLINE_URL)));
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
  if (isStableProductImage) {
    event.respondWith(networkFirstRevocableAsset(request));
    return;
  }
  if (isOfflineMenuSnapshot || isPublicMenu) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
