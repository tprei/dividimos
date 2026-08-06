"use client";

import { useSyncExternalStore } from "react";

const subscribeNoop = () => () => {};

/**
 * Read a browser-only value without a hydration mismatch. Returns false during
 * server render and the initial hydration render, then the real client value —
 * the same semantics as a mount-time `setState`-in-effect probe, but without
 * triggering `react-hooks/set-state-in-effect`. Use for stable
 * platform-capability reads (navigator.share, the Contact Picker API, etc.).
 */
export function useClientOnly(getValue: () => boolean): boolean {
  return useSyncExternalStore(subscribeNoop, getValue, () => false);
}

/**
 * True only after hydration on the client. Use to gate DOM-measuring or
 * browser-only UI so it never renders during SSR/hydration.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribeNoop, () => true, () => false);
}
