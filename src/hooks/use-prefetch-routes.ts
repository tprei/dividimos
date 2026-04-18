"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Prefetches an array of routes when the component mounts or the list changes.
 * Deduplicates across calls and skips routes already prefetched in this session.
 */
const prefetched = new Set<string>();

export function usePrefetchRoutes(routes: string[]) {
  const router = useRouter();

  useEffect(() => {
    const pending = routes.filter((r) => !prefetched.has(r));
    if (pending.length === 0) return;

    // Stagger prefetches to avoid flooding the network
    const timers: ReturnType<typeof setTimeout>[] = [];
    pending.forEach((route, i) => {
      timers.push(
        setTimeout(() => {
          if (!prefetched.has(route)) {
            prefetched.add(route);
            router.prefetch(route);
          }
        }, i * 100),
      );
    });

    return () => timers.forEach(clearTimeout);
  }, [router, routes]);
}

/**
 * Resets the prefetch cache. Useful for testing.
 */
export function resetPrefetchCache() {
  prefetched.clear();
}
