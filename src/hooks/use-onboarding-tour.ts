"use client";

import { useCallback, useEffect, useState } from "react";

const TOUR_KEY_PREFIX = "dividimos_tour_completed_";

function getTourKey(userId: string): string {
  return `${TOUR_KEY_PREFIX}${userId}`;
}

export function useOnboardingTour(userId: string | undefined) {
  const [shouldShow, setShouldShow] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!userId) return;
    try {
      const completed = localStorage.getItem(getTourKey(userId));
      setShouldShow(!completed);
    } catch {
      setShouldShow(false);
    }
    setReady(true);
  }, [userId]);

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

  return { shouldShow: ready && shouldShow, completeTour, resetTour };
}
