import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import React from "react";

vi.mock("server-only", () => ({}));

// Ensure DOM cleanup between tests
afterEach(() => {
  cleanup();
});

// Mock framer-motion to render plain elements (avoids animation-related
// duplicate renders and timing issues in happy-dom)
vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");

  const motionPropNames = new Set([
    "initial", "animate", "exit", "transition", "variants",
    "whileTap", "whileHover", "whileFocus", "whileDrag", "whileInView",
    "layout", "layoutId", "onAnimationStart", "onAnimationComplete",
  ]);

  const motion = new Proxy(
    {},
    {
      get: (_target, prop: string) => {
        const MotionStub = React.forwardRef((props: Record<string, unknown>, ref) => {
          const rest: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(props)) {
            if (!motionPropNames.has(key)) rest[key] = value;
          }
          return React.createElement(prop, { ...rest, ref });
        });
        MotionStub.displayName = `motion.${prop}`;
        return MotionStub;
      },
    },
  );

  return {
    ...actual,
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  };
});
