"use client";

import { useEffect, type RefObject } from "react";

export function useOffscreenPause(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let isIntersecting = false;

    const update = (): void => {
      element.toggleAttribute("data-paused", !isIntersecting || document.hidden);
    };

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        isIntersecting = entry.isIntersecting;
      }
      update();
    });
    observer.observe(element);

    if (document.hidden) {
      update();
    }

    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      observer.disconnect();
    };
  }, [ref]);
}
