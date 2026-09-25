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
import { springs } from "@/lib/animations";
import { Button } from "@/components/ui/button";

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
    <Button
      type="button"
      variant="ghost"
      aria-label={label}
      onClick={onClick}
      className={
        compact
          ?
            `relative flex size-11 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-ring ${className}`
          : `flex h-full min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-1 whitespace-normal px-1 transition-colors focus-visible:outline-2 focus-visible:outline-ring ${className}`
      }
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {compact ? <span className="sr-only">{label}</span> : <span className="text-xs font-semibold">{label}</span>}
    </Button>
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
    controls.start({ x: 0, transition: springs.snappy });
    setIsOpen(false);
  };

  const markRead = () => {
    onMarkRead();
    haptics.success();
    close();
  };

  const dismiss = () => {
    onDismiss();
    haptics.tap();
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
      controls.start({ x: 0, transition: springs.snappy });
      setIsOpen(false);
    } else if (!isOpen && shouldOpen) {
      haptics.impact();
      controls.start({
        x: -panelWidth,
        transition: springs.snappy,
      });
      setIsOpen(true);
    } else {
      // Snap back to current state
      controls.start({
        x: isOpen ? -panelWidth : 0,
        transition: springs.snappy,
      });
    }
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

  // Reduced motion removes the gesture entirely: the actions sit inline where
  // they stay reachable without a drag.
  if (reducedMotion) {
    return (
      <div className="flex items-start gap-1 rounded-lg bg-popover p-2">
        <Link
          href={href}
          onClick={() => { haptics.tap(); onNavigate(); }}
          className="flex min-h-11 min-w-0 flex-1 items-start gap-2 rounded-lg transition-colors hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring"
        >
          {marker}
          {children}
        </Link>
        <div className="mt-0.5 flex shrink-0 items-start gap-1">
          {unread && (
            <ActionButton
              compact
              label="Marcar como lida"
              icon={Check}
              className="text-success-text hover:bg-success/15"
              onClick={markRead}
            />
          )}
          <ActionButton
            compact
            label="Dispensar"
            icon={X}
            className="text-muted-foreground hover:bg-muted"
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
        onFocusCapture={() => {
          controls.start({ x: -panelWidth, transition: springs.snappy });
          setIsOpen(true);
        }}
      >
        {unread && (
          <ActionButton
            label="Marcar como lida"
            icon={Check}
            className="bg-success/15 text-success-text"
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
          onClick={() => { haptics.tap(); onNavigate(); }}
          className="flex min-h-11 items-start gap-2 rounded-lg p-2 transition-colors hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring"
        >
          {marker}
          {children}
        </Link>
      </motion.div>
    </div>
  );
}
