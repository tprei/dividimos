"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

const TOUR_KEY_PREFIX = "dividimos_tour_completed_";

function getTourKey(userId: string): string {
  return `${TOUR_KEY_PREFIX}${userId}`;
}

interface TourState {
  ownerUserId: string | null;
  ownerGeneration: number;
  ready: boolean;
  visible: boolean;
}

interface OwnerTag {
  userId: string | null;
  generation: number;
}

export function useOnboardingTour(
  userId: string | null,
  identityGeneration: number,
): { shouldShow: boolean; completeTour: () => void; resetTour: () => void } {
  const [state, setState] = useState<TourState>({
    ownerUserId: null,
    ownerGeneration: 0,
    ready: false,
    visible: false,
  });

  // Latest committed owner. Updated synchronously inside the layout effect so
  // stale callbacks (captured from a previous render) can detect they no longer
  // match the active identity and bail out before touching storage or state.
  const ownerRef = useRef<OwnerTag>({ userId: null, generation: 0 });

  useLayoutEffect(() => {
    ownerRef.current = { userId, generation: identityGeneration };
    if (userId === null) {
      setState({
        ownerUserId: null,
        ownerGeneration: identityGeneration,
        ready: false,
        visible: false,
      });
      return;
    }
    try {
      const completed = localStorage.getItem(getTourKey(userId));
      setState({
        ownerUserId: userId,
        ownerGeneration: identityGeneration,
        ready: true,
        visible: !completed,
      });
    } catch {
      setState({
        ownerUserId: userId,
        ownerGeneration: identityGeneration,
        ready: true,
        visible: false,
      });
    }
  }, [userId, identityGeneration]);

  // Computed during render so A→null, A→B, and A/g1→A/g2 are all hidden in the
  // boundary render (before any effect commits the new owner).
  const shouldShow =
    state.ownerUserId === userId &&
    state.ownerGeneration === identityGeneration &&
    userId !== null &&
    state.ready &&
    state.visible;

  const completeTour = useCallback(() => {
    if (userId === null) return;
    if (
      ownerRef.current.userId !== userId ||
      ownerRef.current.generation !== identityGeneration
    ) {
      return;
    }
    try {
      localStorage.setItem(getTourKey(userId), "true");
    } catch {
      // localStorage unavailable
    }
    setState((prev) => ({ ...prev, visible: false }));
  }, [userId, identityGeneration]);

  const resetTour = useCallback(() => {
    if (userId === null) return;
    if (
      ownerRef.current.userId !== userId ||
      ownerRef.current.generation !== identityGeneration
    ) {
      return;
    }
    try {
      localStorage.removeItem(getTourKey(userId));
    } catch {
      // localStorage unavailable
    }
    setState((prev) => ({ ...prev, visible: true }));
  }, [userId, identityGeneration]);

  return { shouldShow, completeTour, resetTour };
}
