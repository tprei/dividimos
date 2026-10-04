"use client";

import { useSyncExternalStore } from "react";
import { getPendingSignInName } from "@/lib/pending-sign-in-name";

const subscribeNoop = () => () => {};

/**
 * The name Apple shared at this user's first authorization, read after
 * hydration so the server-rendered onboarding form never mismatches.
 */
export function usePendingSignInName(userId: string): string | null {
  return useSyncExternalStore(subscribeNoop, () => getPendingSignInName(userId), () => null);
}
