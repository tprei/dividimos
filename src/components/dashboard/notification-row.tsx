"use client";

import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
  type PanInfo,
} from "framer-motion";
import { X } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { haptics } from "@/hooks/use-haptics";
import { springs } from "@/lib/animations";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

const ACTION_WIDTH = 96;
/** A release past this share of the row width discards without a tap. */
const DISCARD_RATIO = 0.5;
/** A fling this fast (px/s, leftwards) discards regardless of distance. */
const FLING_VELOCITY = 900;
const OPEN_THRESHOLD = 40;

export interface NotificationRowProps {
  eventId: number;
  unread: boolean;
  href: string;
  onNavigate: () => void;
  onDiscard: () => void;
  children: ReactNode;
}

export function NotificationRow({
  eventId,
  unread,
  href,
  onNavigate,
  onDiscard,
  children,
}: NotificationRowProps) {
  const reducedMotion = useReducedMotion();
  const rowRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  // A press that began on an open row, or turned into a drag, only moves the
  // row; the click that may follow must not navigate.
  const suppressClick = useRef(false);
  const discarded = useRef(false);

  // The action fills exactly the gap the row leaves behind, so it never sits
  // under the drag layer and a tap on it can only ever reach the action.
  const actionWidth = useTransform(x, (value) => Math.max(0, -value));

  const discardDistance = () => (rowRef.current?.offsetWidth ?? 320) * DISCARD_RATIO;

  useMotionValueEvent(x, "change", (value) => {
    if (discarded.current) return;
    const next = -value >= discardDistance();
    if (next !== armed) {
      haptics.selectionChanged();
      setArmed(next);
    }
  });

  const settle = (to: number) => {
    setOpen(to !== 0);
    void animate(x, to, springs.snappy);
  };

  const discard = () => {
    if (discarded.current) return;
    discarded.current = true;
    haptics.impact();
    // The row slides out while the list collapses around it; the store update
    // is immediate so the unread count and the next preview row follow at once.
    void animate(x, -(rowRef.current?.offsetWidth ?? 320), { duration: 0.18, ease: "easeIn" });
    onDiscard();
  };

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (-x.get() >= discardDistance() || info.velocity.x < -FLING_VELOCITY) {
      discard();
      return;
    }
    const opening = info.offset.x < -OPEN_THRESHOLD || info.velocity.x < -200;
    const closing = info.offset.x > OPEN_THRESHOLD || info.velocity.x > 200;
    if (closing) settle(0);
    else if (opening || open) settle(-ACTION_WIDTH);
    else settle(0);
  };

  const handleRowClick = (event: React.MouseEvent) => {
    if (suppressClick.current) {
      event.preventDefault();
      return;
    }
    haptics.tap();
    onNavigate();
  };

  const marker = unread ? (
    <span
      data-testid={`unread-dot-${eventId}`}
      role="img"
      aria-label="Não lida"
      className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
    />
  ) : (
    <span aria-hidden="true" className="mt-1.5 size-2 shrink-0" />
  );

  // Reduced motion removes the gesture entirely: the action sits inline where
  // it stays reachable without a drag.
  if (reducedMotion) {
    return (
      <div className="flex items-start gap-1 p-2">
        <Link
          href={href}
          onClick={() => {
            haptics.tap();
            onNavigate();
          }}
          className="flex min-h-11 min-w-0 flex-1 items-start gap-2 rounded-lg transition-colors hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring"
        >
          {marker}
          {children}
        </Link>
        <IconButton
          aria-label="Descartar"
          size="icon-lg"
          onClick={() => {
            haptics.impact();
            onDiscard();
          }}
          className="rounded-full text-muted-foreground"
        >
          <X className="size-4" aria-hidden="true" />
        </IconButton>
      </div>
    );
  }

  return (
    <div ref={rowRef} className="relative overflow-hidden rounded-lg">
      <motion.div
        style={{ x }}
        drag="x"
        dragDirectionLock
        dragConstraints={{ right: 0 }}
        dragElastic={{ right: 0.02 }}
        dragMomentum={false}
        onPointerDownCapture={() => {
          suppressClick.current = open;
        }}
        onDragStart={() => {
          suppressClick.current = true;
        }}
        onTap={() => {
          if (open) settle(0);
        }}
        tabIndex={-1}
        onDragEnd={handleDragEnd}
        className="relative bg-popover outline-none"
      >
        <Link
          href={href}
          onClick={handleRowClick}
          draggable={false}
          className="flex min-h-11 items-start gap-2 rounded-lg p-2 transition-colors hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring"
        >
          {marker}
          {children}
        </Link>
      </motion.div>

      {/* Touch browsers drop the synthesized click for a tap that lands right
          after a swipe, so pointers discard on tap; click only serves
          keyboard and assistive activation (detail 0). */}
      <motion.button
        type="button"
        style={{ width: actionWidth }}
        onTap={discard}
        onClick={(event) => {
          if (event.detail === 0) discard();
        }}
        onFocus={() => {
          if (!open) settle(-ACTION_WIDTH);
        }}
        className={cn(
          "absolute inset-y-0 right-0 z-10 flex items-center overflow-hidden rounded-r-lg outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          armed ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        )}
      >
        <span className="flex w-24 shrink-0 flex-col items-center justify-center gap-1">
          <X className={cn("size-4 transition-transform duration-150", armed && "scale-110")} aria-hidden="true" />
          <span className="text-xs font-semibold">Descartar</span>
        </span>
      </motion.button>
    </div>
  );
}
