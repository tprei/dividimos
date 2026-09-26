"use client";

import {
  motion,
  useAnimationControls,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type PanInfo,
} from "framer-motion";
import { Archive, ArchiveRestore, MoreHorizontal } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { haptics } from "@/hooks/use-haptics";
import { springs } from "@/lib/animations";
import { cn } from "@/lib/utils";

const ACTION_WIDTH = 120;
const SNAP_THRESHOLD = 40;

export interface SwipeableArchiveRowProps {
  action: "archive" | "unarchive" | "blocked_by_balance" | null;
  onArchive: () => void;
  onUnarchive: () => void;
  children: ReactNode;
}

export function SwipeableArchiveRow({
  action,
  onArchive,
  onUnarchive,
  children,
}: SwipeableArchiveRowProps) {
  const controls = useAnimationControls();
  const x = useMotionValue(0);
  const actionWidth = useTransform(x, (value) => Math.max(0, -value));
  const reducedMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const suppressClick = useRef(false);
  const activationHandled = useRef(false);
  const actionId = useId();
  const blocked = action === "blocked_by_balance";
  const label = action === "unarchive" ? "Desarquivar" : "Arquivar";
  const Icon = action === "unarchive" ? ArchiveRestore : Archive;

  const rearmActivation = () => {
    activationHandled.current = false;
  };

  const reveal = (next: boolean) => {
    setOpen(next);
    if (!reducedMotion) {
      void controls.start({ x: next ? -ACTION_WIDTH : 0, transition: springs.snappy });
    }
  };

  const activate = () => {
    if (activationHandled.current) return;
    activationHandled.current = true;
    if (blocked) {
      haptics.tap();
      toast("Acerte as contas antes de arquivar.");
      return;
    }
    reveal(false);
    haptics.impact();
    if (action === "unarchive") onUnarchive();
    else if (action === "archive") onArchive();
  };

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    const opening = info.offset.x < -SNAP_THRESHOLD || info.velocity.x < -200;
    const closing = info.offset.x > SNAP_THRESHOLD || info.velocity.x > 200;
    const next = closing ? false : opening || open;
    if (next !== open) haptics.selectionChanged();
    reveal(next);
  };

  if (action === null) return <div>{children}</div>;

  const actionContent = (
    <>
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="text-xs font-semibold">{label}</span>
      {blocked && <span className="text-xs">Saldo pendente</span>}
    </>
  );

  return (
    <div
      data-swipe-row
      className="relative overflow-hidden bg-card"
      onPointerDownCapture={rearmActivation}
      onKeyDownCapture={rearmActivation}
      onFocusCapture={rearmActivation}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          reveal(false);
        }
      }}
    >
      <motion.div
        style={reducedMotion ? undefined : { x, touchAction: "pan-y" }}
        animate={controls}
        drag={reducedMotion ? false : "x"}
        dragDirectionLock
        dragConstraints={{ left: -ACTION_WIDTH, right: 0 }}
        dragElastic={0}
        dragMomentum={false}
        onDragStartCapture={(event) => event.preventDefault()}
        onDragStart={() => { suppressClick.current = true; }}
        onDragEnd={handleDragEnd}
        onPointerDownCapture={() => { suppressClick.current = open && !reducedMotion; }}
        className="relative bg-card pr-11"
      >
        <div
          onClickCapture={(event) => {
            if (event.detail !== 0 && suppressClick.current) {
              event.preventDefault();
              event.stopPropagation();
              reveal(false);
            }
          }}
        >
          {children}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label={open ? "Ocultar ações" : "Mostrar ações"}
          aria-expanded={open}
          aria-controls={actionId}
          className="absolute right-0 top-1/2 min-h-11 min-w-11 -translate-y-1/2"
          onClick={() => {
            haptics.selectionChanged();
            reveal(!open);
          }}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </motion.div>
      {reducedMotion ? (
        <div id={actionId} hidden={!open} className="border-t bg-muted p-2">
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 w-full gap-2"
            aria-disabled={blocked}
            onClick={activate}
          >
            {actionContent}
          </Button>
        </div>
      ) : (
        <motion.button
          id={actionId}
          type="button"
          style={{ width: actionWidth }}
          tabIndex={open ? 0 : -1}
          aria-hidden={!open}
          aria-disabled={blocked}
          onTap={activate}
          onClick={(event) => {
            if (event.detail === 0) activate();
          }}
          className={cn(
            "absolute inset-y-0 right-0 z-10 flex min-h-11 flex-col items-center justify-center gap-1 overflow-hidden whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            blocked ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground",
          )}
        >
          {actionContent}
        </motion.button>
      )}
    </div>
  );
}
