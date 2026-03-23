"use client";

import { motion } from "framer-motion";

interface AnimatedCheckmarkProps {
  size?: number;
  className?: string;
}

export function AnimatedCheckmark({ size = 56, className = "text-success" }: AnimatedCheckmarkProps) {
  return (
    <motion.svg
      viewBox="0 0 52 52"
      width={size}
      height={size}
      className={className}
    >
      <motion.circle
        cx="26"
        cy="26"
        r="24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      />
      <motion.path
        d="M16 27l6 6 14-14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.4, delay: 0.3, ease: "easeOut" }}
      />
    </motion.svg>
  );
}
