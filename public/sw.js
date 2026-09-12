// Service worker — offline cache + fallback for PWA installability.

const CACHE_VERSION = "v5";
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

function expectedPrecacheType(pathname) {
  return pathname === OFFLINE_URL ? "text/html" : "image/png";
}

function hasContentType(response, expected) {
  const contentType = response.headers?.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  return contentType === expected;
}

async function precacheUrl(cache, pathname) {
  const url = new URL(pathname, self.location.origin);
  if (url.origin !== self.location.origin) {
    throw new Error(`Refusing cross-origin precache URL: ${pathname}`);
  }
  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok || !hasContentType(response, expectedPrecacheType(url.pathname))) {
    throw new Error(`Invalid precache response: ${pathname}`);
  }
  await cache.put(pathname, response.clone());
}

// ── Install ──────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      await Promise.all(PRECACHE_URLS.map((pathname) => precacheUrl(cache, pathname)));
      return self.skipWaiting();
    })
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

// A gateway that is up but broken is an outage from the user's point of view,
// so these statuses get the offline fallback. Every other status, including
// 404 and 500, is the app deliberately answering and is passed through.
const TRANSIENT_STATUSES = new Set([502, 503, 504]);

// A navigation that never settles is worse than one that fails: the tab spins
// with nothing to read. After this long the fallback is served instead.
const NAVIGATION_TIMEOUT_MS = 8000;

function isOutage(response) {
  return !response || TRANSIENT_STATUSES.has(response.status);
}

/**
 * Fetches with a deadline. Resolves to null on rejection or timeout so callers
 * treat both the same way, and aborts the request so a stalled connection is
 * not left holding the socket.
 */
function fetchWithDeadline(request) {
  const controller =
    typeof AbortController === "function" ? new AbortController() : null;
  let timer = null;

  const network = fetch(
    request,
    controller ? { signal: controller.signal } : undefined,
  ).catch(() => null);

  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      if (controller) controller.abort();
      resolve(null);
    }, NAVIGATION_TIMEOUT_MS);
  });

  return Promise.race([network, deadline]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

function isEligibleAppShellResponse(response, requestUrl) {
  if (!response || !response.ok || response.type === "opaque") return false;
  const contentType = response.headers?.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("text/html")) return false;
  const finalUrl = response.url ? new URL(response.url, self.location.origin) : requestUrl;
  return finalUrl.origin === self.location.origin && finalUrl.pathname.startsWith("/app");
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
            const validCached = isEligibleAppShellResponse(cached, url);
            if (cached && !validCached && typeof cache.delete === "function") {
              void cache.delete(request);
            }

            const revalidate = fetchWithDeadline(request).then((response) => {
              if (isEligibleAppShellResponse(response, url)) {
                // Chained into whatever keeps this event alive, so the worker
                // cannot be killed between the response and the write.
                return cache
                  .put(request, response.clone())
                  .then(() => response, () => response);
              }
              return response;
            });

            if (validCached) {
              if (typeof event.waitUntil === "function") {
                event.waitUntil(revalidate);
              }
              return cached;
            }

            return revalidate.then((networkResponse) =>
              isOutage(networkResponse)
                ? caches.match(OFFLINE_URL)
                : networkResponse,
            );
          }),
        ),
      );
      return;
    }

    // Other navigations — network-first, offline fallback only
    event.respondWith(
      fetchWithDeadline(request).then((response) =>
        isOutage(response) ? caches.match(OFFLINE_URL) : response,
      ),
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
        // Only cache successful responses, and keep the event alive until the
        // write settles rather than firing it off and hoping.
        if (response.ok) {
          const clone = response.clone();
          const write = caches
            .open(RUNTIME_CACHE)
            .then((cache) => cache.put(request, clone));
          if (typeof event.waitUntil === "function") {
            event.waitUntil(write);
          } else {
            return write.then(() => response, () => response);
          }
        }
        return response;
      })
      .catch(() => caches.match(request)),
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
