/**
 * The service worker caches optimized avatar photos in `dividimos-avatars-*`
 * Cache Storage entries (see AVATAR_CACHE in `public/sw.js`). Sign-out drops
 * them so a shared device does not keep the previous account's contacts'
 * photos around.
 */
export function clearAvatarCaches(): void {
  if (!("caches" in window)) return;
  window.caches
    .keys()
    .then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("dividimos-avatars-"))
          .map((key) => window.caches.delete(key)),
      ),
    )
    .catch((error: unknown) => {
      console.error("[avatar-cache] clearing caches on sign-out failed:", error);
    });
}
