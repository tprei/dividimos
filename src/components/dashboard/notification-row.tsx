"use client";

import {
  motion,
  useAnimationControls,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type PanInfo,
} from "framer-motion";
import { Check, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { haptics } from "@/hooks/use-haptics";

const ACTION_WIDTH = 88; // one action column; unread rows show two
const SNAP_THRESHOLD = 40; // how far user must drag to snap open

export interface NotificationRowProps {
  eventId: number;
  unread: boolean;
  href: string;
  onNavigate: () => void;
  onMarkRead: () => void;
  onDismiss: () => void;
  children: ReactNode;
}

function ActionButton({
  label,
  icon: Icon,
  className,
  onClick,
  compact = false,
}: {
  label: string;
  icon: LucideIcon;
  className: string;
  onClick: () => void;
  /** Inline rows sit next to the text, so the label goes to screen readers. */
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={
        compact
          ? `flex size-11 shrink-0 items-center justify-center rounded-lg transition-colors ${className}`
          : `flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-1 transition-colors ${className}`
      }
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {compact ? <span className="sr-only">{label}</span> : <span className="text-[10px] font-medium">{label}</span>}
    </button>
  );
}

export function NotificationRow({
  eventId,
  unread,
  href,
  onNavigate,
  onMarkRead,
  onDismiss,
  children,
}: NotificationRowProps) {
  const controls = useAnimationControls();
  const x = useMotionValue(0);
  const [isOpen, setIsOpen] = useState(false);
  const isDragging = useRef(false);
  const reducedMotion = useReducedMotion();
  const panelWidth = unread ? ACTION_WIDTH * 2 : ACTION_WIDTH;

  // Fade in the action buttons as the row slides left
  const actionsOpacity = useTransform(x, [-panelWidth, -20, 0], [1, 0.5, 0]);

  const close = () => {
    controls.start({ x: 0, transition: { type: "spring", stiffness: 400, damping: 30 } });
    setIsOpen(false);
  };

  const markRead = () => {
    onMarkRead();
    close();
  };

  const dismiss = () => {
    onDismiss();
    close();
  };

  const handleDragStart = () => {
    isDragging.current = true;
  };

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    // Small timeout so click handlers on children can check isDragging
    setTimeout(() => {
      isDragging.current = false;
    }, 50);

    const shouldOpen = info.offset.x < -SNAP_THRESHOLD || info.velocity.x < -200;
    const shouldClose = info.offset.x > SNAP_THRESHOLD || info.velocity.x > 200;

    if (isOpen && shouldClose) {
      haptics.impact();
      controls.start({ x: 0, transition: { type: "spring", stiffness: 400, damping: 30 } });
      setIsOpen(false);
    } else if (!isOpen && shouldOpen) {
      haptics.impact();
      controls.start({
        x: -panelWidth,
        transition: { type: "spring", stiffness: 400, damping: 30 },
      });
      setIsOpen(true);
    } else {
      // Snap back to current state
      controls.start({
        x: isOpen ? -panelWidth : 0,
        transition: { type: "spring", stiffness: 400, damping: 30 },
      });
    }
  };

  const marker = unread ? (
    <span
      data-testid={`unread-dot-${eventId}`}
      aria-hidden="true"
      className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
    />
  ) : (
    <span aria-hidden="true" className="mt-1.5 size-2 shrink-0" />
  );

  // Reduced motion removes the gesture entirely: the actions sit inline where
  // they stay reachable without a drag.
  if (reducedMotion) {
    return (
      <div className="flex items-start gap-1 rounded-lg bg-popover p-2">
        <Link
          href={href}
          onClick={onNavigate}
          className="flex min-w-0 flex-1 items-start gap-2 rounded-lg transition-colors hover:bg-accent/40"
        >
          {marker}
          {children}
        </Link>
        <div className="flex shrink-0 items-start gap-1.5">
          {unread && (
            <ActionButton
              compact
              label="Marcar como lida"
              icon={Check}
              className="bg-success/15 text-success"
              onClick={markRead}
            />
          )}
          <ActionButton
            compact
            label="Dispensar"
            icon={X}
            className="bg-muted text-muted-foreground"
            onClick={dismiss}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-lg">
      {/* Action buttons behind the row */}
      <motion.div
        style={{ opacity: actionsOpacity, width: panelWidth }}
        className="absolute inset-y-0 right-0 flex items-stretch"
      >
        {unread && (
          <ActionButton
            label="Marcar como lida"
            icon={Check}
            className="bg-success/15 text-success"
            onClick={markRead}
          />
        )}
        <ActionButton
          label="Dispensar"
          icon={X}
          className="bg-muted text-muted-foreground"
          onClick={dismiss}
        />
      </motion.div>

      {/* Draggable row layer */}
      <motion.div
        style={{ x }}
        animate={controls}
        drag="x"
        dragConstraints={{ left: -panelWidth, right: 0 }}
        dragElastic={0.1}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onPointerDownCapture={(e) => {
          // Prevent Link navigation while dragging
          const el = e.currentTarget;
          const onPointerUp = () => {
            el.removeEventListener("pointerup", onPointerUp);
            if (isDragging.current) {
              el.addEventListener(
                "click",
                (ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                },
                { capture: true, once: true },
              );
            }
          };
          el.addEventListener("pointerup", onPointerUp);
        }}
        className="relative bg-popover"
      >
        <Link
          href={href}
          onClick={onNavigate}
          className="flex items-start gap-2 rounded-lg p-2 transition-colors hover:bg-accent/40"
        >
          {marker}
          {children}
        </Link>
      </motion.div>
    </div>
  );
}
