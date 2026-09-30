"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

export type InfoView = "main" | "profile";

export function useInfoView(options: {
  historyKey: string;
  screenRef: RefObject<HTMLDivElement | null>;
  mainFocusRef: RefObject<HTMLElement | null>;
  profileFocusSelector: string;
}): { view: InfoView; openProfile: () => void; closeProfile: () => void } {
  const { historyKey, screenRef, mainFocusRef, profileFocusSelector } = options;
  const searchParams = useSearchParams();
  const view: InfoView = searchParams.get("view") === "info" ? "profile" : "main";
  const prevViewRef = useRef<InfoView>(view);
  const swapping = useRef(false);

  const openProfile = useCallback(() => {
    const url = new URL(window.location.href);
    if (swapping.current || url.searchParams.get("view") === "info") return;
    swapping.current = true;
    screenRef.current?.closest("main")?.scrollTo({ top: 0 });
    url.searchParams.set("view", "info");
    window.history.pushState({ [historyKey]: true }, "", `${url.pathname}${url.search}`);
  }, [historyKey, screenRef]);

  // Going back only when this screen pushed the profile entry keeps history
  // to one entry per visit; the marker survives remounts and reloads.
  const closeProfile = useCallback(() => {
    const url = new URL(window.location.href);
    if (swapping.current || url.searchParams.get("view") !== "info") return;
    swapping.current = true;
    screenRef.current?.closest("main")?.scrollTo({ top: 0 });
    if (window.history.state?.[historyKey] === true) {
      window.history.back();
      return;
    }
    url.searchParams.delete("view");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [historyKey, screenRef]);

  // A view swap must start from a re-measured top: reset scroll before paint
  // and hand focus to where the swap leaves the user.
  useLayoutEffect(() => {
    const previous = prevViewRef.current;
    prevViewRef.current = view;
    swapping.current = false;
    if (previous === view) return;
    screenRef.current?.closest("main")?.scrollTo({ top: 0 });
    const target = view === "main"
      ? mainFocusRef.current
      : screenRef.current?.querySelector<HTMLElement>(profileFocusSelector);
    target?.focus({ preventScroll: true });
  }, [view, mainFocusRef, profileFocusSelector, screenRef]);

  return { view, openProfile, closeProfile };
}
