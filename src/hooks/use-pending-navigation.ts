"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

/** How long a tab navigation may stay pending before its skeleton replaces the old screen. */
export const PENDING_SKELETON_DELAY_MS = 120;

interface PendingTab {
  href: string;
  from: string;
}

export interface PendingNavigation {
  /** Destination of an in-flight tab navigation, or null. */
  href: string | null;
  /** True once that navigation has been pending for PENDING_SKELETON_DELAY_MS. */
  showSkeleton: boolean;
  /** Call from Link's onNavigate with the tab's href. */
  begin: (href: string) => void;
}

export function usePendingNavigation(): PendingNavigation {
  const pathname = usePathname();
  const [pending, setPending] = useState<PendingTab | null>(null);
  const [revealed, setRevealed] = useState(false);

  if (pending !== null && pending.from !== pathname) {
    setPending(null);
    setRevealed(false);
  }

  const isPending = pending !== null;
  useEffect(() => {
    if (!isPending) return;
    const abandon = () => {
      setPending(null);
      setRevealed(false);
    };
    window.addEventListener("popstate", abandon);
    const timer = setTimeout(() => setRevealed(true), PENDING_SKELETON_DELAY_MS);
    return () => {
      window.removeEventListener("popstate", abandon);
      clearTimeout(timer);
    };
  }, [isPending]);

  const begin = useCallback(
    (href: string) => {
      if (href === pathname) {
        setPending(null);
        setRevealed(false);
        return;
      }
      setPending({ href, from: pathname });
    },
    [pathname],
  );

  return { href: pending?.href ?? null, showSkeleton: isPending && revealed, begin };
}
