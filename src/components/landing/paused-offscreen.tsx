"use client";

import { useRef, type ReactNode } from "react";
import { useOffscreenPause } from "@/components/scenery/use-offscreen-pause";

interface PausedOffscreenProps {
  className: string;
  children: ReactNode;
}

export function PausedOffscreen({ className, children }: PausedOffscreenProps) {
  const ref = useRef<HTMLDivElement>(null);
  useOffscreenPause(ref);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
