"use client";

import {
  motion,
  useMotionValue,
  useTransform,
  useAnimationControls,
  useReducedMotion,
  type PanInfo,
} from "framer-motion";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { haptics } from "@/hooks/use-haptics";
import { springs } from "@/lib/animations";
import { Button } from "@/components/ui/button";

const ACTION_WIDTH = 120; // total width of the action panel
const SNAP_THRESHOLD = 40; // how far user must drag to snap open

interface SwipeableBillCardProps {
  enabled: boolean;
  onDelete: () => void;
  children: React.ReactNode;
}

export function SwipeableBillCard({
  enabled,
  onDelete,
  children,
}: SwipeableBillCardProps) {
  const controls = useAnimationControls();
  const x = useMotionValue(0);
  const [isOpen, setIsOpen] = useState(false);
  const isDragging = useRef(false);
  const reducedMotion = useReducedMotion();
  const transition = reducedMotion ? { duration: 0 } : springs.snappy;

  // Fade in the action buttons as the card slides left
  const actionsOpacity = useTransform(x, [-ACTION_WIDTH, -20, 0], [1, 0.5, 0]);

  if (!enabled) {
    return <>{children}</>;
  }

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
      haptics.selectionChanged();
      controls.start({ x: 0, transition });
      setIsOpen(false);
    } else if (!isOpen && shouldOpen) {
      haptics.selectionChanged();
      localStorage.setItem("bills-swipe-seen", "true");
      controls.start({
        x: -ACTION_WIDTH,
        transition,
      });
      setIsOpen(true);
    } else {
      // Snap back to current state
      controls.start({
        x: isOpen ? -ACTION_WIDTH : 0,
        transition,
      });
    }
  };

  const close = () => {
    controls.start({ x: 0, transition });
    setIsOpen(false);
  };

  return (
    <div className="relative overflow-hidden bg-card">
      {/* Action buttons behind the card */}
      <motion.div
        style={{ opacity: actionsOpacity }}
        className="absolute inset-y-0 right-0 flex w-[120px] items-stretch"
        aria-hidden={!isOpen}
      >
        <button
          onClick={() => {
            close();
            onDelete();
          }}
          className="flex flex-1 flex-col items-center justify-center gap-1 bg-destructive/15 font-semibold text-destructive-text transition-colors hover:bg-destructive/20 dark:bg-destructive/25 dark:hover:bg-destructive/30"
          aria-label="Excluir conta"
          tabIndex={isOpen ? 0 : -1}
        >
          <Trash2 className="h-4 w-4" />
          <span className="text-xs font-semibold">Excluir</span>
        </button>
      </motion.div>
      {/* Draggable card layer */}
      <motion.div
        style={{ x, touchAction: "pan-y" }}
        animate={controls}
        drag="x"
        dragConstraints={{ left: -ACTION_WIDTH, right: 0 }}
        dragElastic={0.1}
        onDragStartCapture={(event) => event.preventDefault()}
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
        className="relative bg-card pr-11"
      >
        {children}

        <Button
          variant="ghost"
          size="icon"
          aria-label={isOpen ? "Ocultar ações da conta" : "Mostrar ações da conta"}
          aria-expanded={isOpen}
          className="absolute right-0 top-1/2 -translate-y-1/2"
          onClick={() => {
            haptics.selectionChanged();
            controls.start({ x: isOpen ? 0 : -ACTION_WIDTH, transition });
            setIsOpen(!isOpen);
          }}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </motion.div>
    </div>
  );
}
