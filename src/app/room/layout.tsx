"use client";

import type { ReactNode } from "react";
import { useAppViewport } from "@/hooks/use-app-viewport";

/**
 * The public room route sits outside the authenticated app shell, so this
 * layout is the single scroll owner for every room state. The root body stays
 * the visual-viewport and safe-area owner; rooms only scroll inside here.
 */
export default function RoomLayout({ children }: { children: ReactNode }) {
  useAppViewport();

  return (
    <div
      data-testid="room-scroll"
      className="flex-1 min-h-0 w-full overflow-y-auto overscroll-y-contain"
    >
      {children}
    </div>
  );
}
