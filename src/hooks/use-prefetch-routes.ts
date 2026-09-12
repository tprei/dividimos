"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useAppStore } from "@/stores/app-store";

/**
 * Prefetches an array of routes when the component mounts or the list changes.
 *
 * Marks are per mounted component and per account. A module-global set kept
 * them for the whole session, so a prefetch that failed was never retried and
 * one account's navigation intent carried into the next sign-in.
 */
export function usePrefetchRoutes(routes: string[]) {
  const router = useRouter();
  const accountId = useAppStore((state) => state.me?.id ?? null);
  const prefetched = useRef(new Set<string>());
  const markedAccount = useRef<string | null>(null);

  useEffect(() => {
    if (markedAccount.current !== accountId) {
      markedAccount.current = accountId;
      prefetched.current = new Set<string>();
    }

    const marks = prefetched.current;
    const pending = routes.filter((route) => !marks.has(route));
    if (pending.length === 0) return;

    // Stagger prefetches to avoid flooding the network
    const timers: ReturnType<typeof setTimeout>[] = [];
    pending.forEach((route, i) => {
      timers.push(
        setTimeout(() => {
          if (marks.has(route)) return;
          marks.add(route);
          try {
            // A failed prefetch must not be remembered as done, or the route
            // stays uncached for the rest of the session.
            const result = router.prefetch(route) as unknown;
            if (result instanceof Promise) {
              result.catch(() => marks.delete(route));
            }
          } catch {
            marks.delete(route);
          }
        }, i * 100),
      );
    });

    return () => timers.forEach(clearTimeout);
  }, [accountId, router, routes]);
}
