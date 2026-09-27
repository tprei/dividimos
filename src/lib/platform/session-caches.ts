/**
 * Service worker caches that must not outlive the session (see `public/sw.js`).
 * Avatar photos (`dividimos-avatars-*`) go so a shared device does not keep the
 * previous account's contacts' photos. The `/app` shell (`dividimos-shell-*`)
 * goes because the worker serves it without asking the server: after sign-out
 * it would open an app with no session instead of the server's redirect to
 * `/auth`, or the offline page when there is no connection.
 */
const SESSION_CACHE_PREFIXES = ["dividimos-avatars-", "dividimos-shell-"];

export function clearSessionCaches(): void {
  if (!("caches" in window)) return;
  window.caches
    .keys()
    .then((keys) =>
      Promise.all(
        keys
          .filter((key) => SESSION_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)))
          .map((key) => window.caches.delete(key)),
      ),
    )
    .catch((error: unknown) => {
      console.error("[session-caches] clearing caches on sign-out failed:", error);
    });
}
