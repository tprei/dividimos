"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Right-edge cue shown while the page's final action is still below the fold.
 *
 * Long bill and expense screens end in a button that used to float over the
 * content. Now that it sits in normal flow, people need to know it is down
 * there; this disappears the moment it is on screen.
 */
export function ScrollHint({ targetRef }: { targetRef: React.RefObject<HTMLElement | null> }) {
  const [visible, setVisible] = useState(false);
  const containerRef = useRef<HTMLElement | null>(null);

  const scrollToTarget = useCallback(() => {
    targetRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [targetRef]);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    // The nearest real scroller owns the overflow; on these screens that is
    // the app shell's main element, not the window.
    let scroller: HTMLElement | null = target.parentElement;
    while (scroller) {
      const overflowY = window.getComputedStyle(scroller).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") break;
      scroller = scroller.parentElement;
    }
    containerRef.current = scroller;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const overflows = scroller
          ? scroller.scrollHeight - scroller.clientHeight > 1
          : document.documentElement.scrollHeight > window.innerHeight + 1;
        setVisible(overflows && !entry.isIntersecting);
      },
      { root: scroller, threshold: 0.01 },
    );
    observer.observe(target);

    const resize = new ResizeObserver(() => {
      if (!scroller) return;
      if (scroller.scrollHeight - scroller.clientHeight <= 1) setVisible(false);
    });
    if (scroller) resize.observe(scroller);
    resize.observe(target);

    return () => {
      observer.disconnect();
      resize.disconnect();
    };
  }, [targetRef]);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={scrollToTarget}
      aria-label="Ver final da página"
      className="fixed right-3 bottom-24 z-30 flex h-11 w-11 items-center justify-center rounded-full border bg-card/90 text-muted-foreground shadow-md backdrop-blur transition-colors hover:text-foreground"
    >
      <ChevronDown className="size-5" aria-hidden="true" />
    </button>
  );
}
