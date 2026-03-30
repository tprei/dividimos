// Service worker — offline cache + fallback for PWA installability.

const CACHE_VERSION = "v1";
const STATIC_CACHE = `pixwise-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `pixwise-runtime-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";

// Assets to precache on install — keep this list small and static.
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/icon-192.png",
  "/icon-512.png",
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
  const CURRENT_CACHES = new Set([STATIC_CACHE, RUNTIME_CACHE]);
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
// Strategy: network-first for navigation requests (HTML pages).
// For same-origin non-navigation requests: network-first with runtime cache.
// Cross-origin requests and API calls are not cached.
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== "GET") return;

  // Skip cross-origin requests (CDN, analytics, Supabase API, etc.)
  if (!request.url.startsWith(self.location.origin)) return;

  // Skip API routes and auth routes — these should never be cached
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  // Navigation requests (HTML pages) — network-first, offline fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Same-origin assets (JS, CSS, images, fonts) — network-first with cache
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
