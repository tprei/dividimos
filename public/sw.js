// Minimal service worker — required for PWA installability.
// No caching strategy; can be replaced with Serwist later.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
