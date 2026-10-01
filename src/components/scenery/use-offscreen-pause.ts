"use client";

import { useEffect, type RefObject } from "react";

export function useOffscreenPause(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        element.toggleAttribute("data-paused", !entry.isIntersecting);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
}
