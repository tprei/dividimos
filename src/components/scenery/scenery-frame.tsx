"use client";

import { useRef, type ReactNode } from "react";
import { useOffscreenPause } from "./use-offscreen-pause";

interface SceneryFrameProps {
  className: string;
  children: ReactNode;
}

export function SceneryFrame({ className, children }: SceneryFrameProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  useOffscreenPause(frameRef);

  return (
    <div ref={frameRef} className={className} aria-hidden="true">
      {children}
    </div>
  );
}
