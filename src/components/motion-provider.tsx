"use client";

import type { ReactNode } from "react";
import { MotionConfig } from "framer-motion";

export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
