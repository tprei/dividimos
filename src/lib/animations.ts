import type { Transition, Variants } from "framer-motion";

export const springs = {
  snappy: { type: "spring", stiffness: 400, damping: 30 } as Transition,
  gentle: { type: "spring", stiffness: 300, damping: 25 } as Transition,
  soft: { type: "spring", stiffness: 200, damping: 20 } as Transition,
  bouncy: { type: "spring", stiffness: 500, damping: 15 } as Transition,
  sheet: { type: "spring", damping: 25, stiffness: 300 } as Transition,
};

const durations = { fast: 0.12, base: 0.2, slow: 0.32 } as const;

export const easeOut: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const tapScale = { card: 0.97, icon: 0.92 } as const;

export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 4 },
  visible: { opacity: 1, scale: 1, y: 0, transition: springs.snappy },
  exit: { opacity: 0, scale: 0.98, transition: { duration: durations.fast } },
};

/** Reduced-motion stand-in for `popIn`: same beats, no movement. */
export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: durations.fast } },
  exit: { opacity: 0, transition: { duration: durations.fast } },
};

export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.03,
      delayChildren: 0,
    },
  },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 300, damping: 24 },
  },
};

export const fadeUp = (delay = 0): Variants => ({
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { delay, duration: 0.5, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
  },
});

