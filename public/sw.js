// Service worker — offline cache + fallback for PWA installability.

const CACHE_VERSION = "v4";
const STATIC_CACHE = `dividimos-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `dividimos-runtime-${CACHE_VERSION}`;
const SHELL_CACHE = `dividimos-shell-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";

// Assets to precache on install — keep this list small and static.
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/icon-192.png",
  "/icon-512.png",
  "/badge-72.png",
];

// ── Install ──────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate ─────────────────────────────────────────────────────────
// Clean up old caches from previous versions.
self.addEventListener("activate", (event) => {
  const CURRENT_CACHES = new Set([STATIC_CACHE, RUNTIME_CACHE, SHELL_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => !CURRENT_CACHES.has(name))
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch ────────────────────────────────────────────────────────────
// Strategy: cache-first with background revalidation for /app navigations
// (the static shell); network-first for other navigations and immutable static
// assets. All other same-origin requests pass through uncached so that
// authenticated responses (RSC payloads, etc.) are never stored.

// Only immutable, content-hashed assets are eligible for runtime caching.
// request.destination reflects the loading context (script/style/font/image
// for tags, "empty" for programmatic fetch including RSC payloads).
function isCacheableAsset(request, url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    request.destination === "script" ||
    request.destination === "style" ||
    request.destination === "font" ||
    request.destination === "image"
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== "GET") return;

  // Skip cross-origin requests (CDN, analytics, Supabase API, etc.)
  if (!request.url.startsWith(self.location.origin)) return;

  // Skip API routes and auth routes — these should never be cached
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;
  if (url.pathname === "/claim" || url.pathname.startsWith("/claim/")) return;

  // Navigation requests (HTML pages)
  if (request.mode === "navigate") {
    // /app/** shell — respond cache-first and revalidate in the background
    if (url.pathname.startsWith("/app")) {
      event.respondWith(
        caches.open(SHELL_CACHE).then((cache) =>
          cache.match(request).then((cached) => {
            const revalidate = fetch(request)
              .then((response) => {
                if (response.ok) {
                  cache.put(request, response.clone());
                }
                return response;
              })
              .catch(() => null);

            if (cached) {
              if (typeof event.waitUntil === "function") {
                event.waitUntil(revalidate);
              }
              return cached;
            }

            return revalidate.then(
              (networkResponse) =>
                networkResponse || caches.match(OFFLINE_URL)
            );
          })
        )
      );
      return;
    }

    // Other navigations — network-first, offline fallback only
    event.respondWith(
      fetch(request)
        .catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Deny by default: only immutable static assets are cached. RSC payloads
  // and any other authenticated response pass through without caching.
  if (!isCacheableAsset(request, url)) return;

  // Static assets — network-first with cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// ── Push ──────────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Dividimos", body: event.data.text() };
  }

  const { title = "Dividimos", body = "", url, icon = "/icon-192.png", tag } = payload;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: "/badge-72.png",
      tag: tag || undefined,
      data: { url: url || "/" },
    })
  );
});

// ── Notification Click ────────────────────────────────────────────────
function isSafeUrl(url) {
  try {
    const u = new URL(url, self.location.origin);
    return u.origin === self.location.origin;
  } catch { return false; }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const raw = event.notification.data?.url;
  const targetUrl = raw && isSafeUrl(raw) ? raw : "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing window if one is open on the same origin
        for (const client of clientList) {
          if (client.url.startsWith(self.location.origin) && "focus" in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        // Otherwise open a new window
        return self.clients.openWindow(targetUrl);
      })
  );
});
