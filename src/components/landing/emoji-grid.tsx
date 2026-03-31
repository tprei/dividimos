"use client";

import { motion } from "framer-motion";

const EMOJIS = ["🍻", "🤝", "🍻", "🤝", "🍻", "🤝"];
const ROWS = 3;
const COLS = 5;

const cells = Array.from({ length: ROWS * COLS }, (_, i) => ({
  emoji: EMOJIS[i % EMOJIS.length],
  index: i,
}));

export function EmojiGrid() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 select-none overflow-hidden"
      style={{
        maskImage:
          "linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)",
      }}
    >
      <motion.div
        className="flex h-full flex-col justify-around opacity-15"
        initial={{ x: "0%" }}
        animate={{ x: "-50%" }}
        transition={{
          x: {
            repeat: Infinity,
            repeatType: "loop",
            duration: 30,
            ease: "linear",
          },
        }}
      >
        {Array.from({ length: ROWS }, (_, row) => (
          <div
            key={row}
            className="flex shrink-0 gap-24 sm:gap-32 lg:gap-40"
            style={{
              paddingLeft: row % 2 === 1 ? "4rem" : 0,
            }}
          >
            {[...cells, ...cells].map(({ emoji }, i) => (
              <span
                key={`${row}-${i}`}
                className="shrink-0 text-3xl sm:text-4xl lg:text-5xl"
              >
                {emoji}
              </span>
            ))}
          </div>
        ))}
      </motion.div>
    </div>
  );
}
