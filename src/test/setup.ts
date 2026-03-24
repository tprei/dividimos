import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import React from "react";

// Ensure DOM cleanup between tests
afterEach(() => {
  cleanup();
});

// Mock framer-motion to render plain elements (avoids animation-related
// duplicate renders and timing issues in happy-dom)
vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");

  const motion = new Proxy(
    {},
    {
      get: (_target, prop: string) => {
        const MotionComponent = React.forwardRef(function MotionComponent(props: Record<string, unknown>, ref) {
          // Strip framer-motion-specific props before passing to DOM element
          const motionProps = [
            "initial", "animate", "exit", "transition", "variants",
            "whileTap", "whileHover", "whileFocus", "whileDrag", "whileInView",
            "layout", "layoutId", "onAnimationStart", "onAnimationComplete",
          ];
          const rest = Object.fromEntries(
            Object.entries(props).filter(([key]) => !motionProps.includes(key)),
          );
          return React.createElement(prop, { ...rest, ref });
        });
        return MotionComponent;
      },
    },
  );

  return {
    ...actual,
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  };
});
