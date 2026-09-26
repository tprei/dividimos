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

  const motionPropNames = new Set([
    "initial", "animate", "exit", "transition", "variants",
    "whileTap", "whileHover", "whileFocus", "whileDrag", "whileInView",
    "layout", "layoutId", "onAnimationStart", "onAnimationComplete",
  ]);

  const motionStubs = new Map<string, React.ComponentType<Record<string, unknown>>>();

  const motion = new Proxy(
    {},
    {
      get: (_target, prop: string) => {
        const cached = motionStubs.get(prop);
        if (cached) return cached;
        const MotionStub = React.forwardRef((props: Record<string, unknown>, ref) => {
          const { onTap, onClick, ...others } = props as {
            onTap?: (event: unknown) => void;
            onClick?: (event: unknown) => void;
          } & Record<string, unknown>;
          const rest: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(others)) {
            if (!motionPropNames.has(key)) rest[key] = value;
          }
          // Plain elements have no press gesture; a tap is a click here.
          if (onTap || onClick) {
            rest.onClick = (event: unknown) => {
              onTap?.(event);
              onClick?.(event);
            };
          }
          return React.createElement(prop, { ...rest, ref });
        });
        MotionStub.displayName = `motion.${prop}`;
        motionStubs.set(prop, MotionStub as React.ComponentType<Record<string, unknown>>);
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
