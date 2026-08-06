"use client";

import { useCallback, useState } from "react";
import { useMounted } from "@/hooks/use-client-only";

const TOUR_KEY_PREFIX = "dividimos_tour_completed_";

function getTourKey(userId: string): string {
  return `${TOUR_KEY_PREFIX}${userId}`;
}

function readShouldShow(userId: string | undefined): boolean {
  if (!userId) return false;
  try {
    return !localStorage.getItem(getTourKey(userId));
  } catch {
    return false;
  }
}

export function useOnboardingTour(userId: string | undefined) {
  // Re-derive from localStorage when the user changes, gated to the client so
  // nothing renders during SSR/hydration. completeTour/resetTour override.
  const mounted = useMounted();
  const [shouldShow, setShouldShow] = useState(false);
  const [trackedUserId, setTrackedUserId] = useState<string | undefined | null>(null);
  if (mounted && userId !== trackedUserId) {
    setTrackedUserId(userId);
    setShouldShow(readShouldShow(userId));
  }

  const completeTour = useCallback(() => {
    if (!userId) return;
    try {
      localStorage.setItem(getTourKey(userId), "true");
    } catch {
      // localStorage unavailable
    }
    setShouldShow(false);
  }, [userId]);

  const resetTour = useCallback(() => {
    if (!userId) return;
    try {
      localStorage.removeItem(getTourKey(userId));
    } catch {
      // localStorage unavailable
    }
    setShouldShow(true);
  }, [userId]);

  return { shouldShow: mounted && shouldShow, completeTour, resetTour };
}
