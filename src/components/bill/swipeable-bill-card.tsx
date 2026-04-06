"use client";

import {
  motion,
  useMotionValue,
  useTransform,
  useAnimationControls,
  type PanInfo,
} from "framer-motion";
import { ChevronLeft, Pencil, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { haptics } from "@/hooks/use-haptics";

const ACTION_WIDTH = 120; // total width of the action panel
const SNAP_THRESHOLD = 40; // how far user must drag to snap open

interface SwipeableBillCardProps {
  /** Whether this card should have swipe actions (draft + owned by user) */
  enabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
  children: React.ReactNode;
}

export function SwipeableBillCard({
  enabled,
  onEdit,
  onDelete,
  children,
}: SwipeableBillCardProps) {
  const controls = useAnimationControls();
  const x = useMotionValue(0);
  const [isOpen, setIsOpen] = useState(false);
  const isDragging = useRef(false);

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
      haptics.impact();
      controls.start({ x: 0, transition: { type: "spring", stiffness: 400, damping: 30 } });
      setIsOpen(false);
    } else if (!isOpen && shouldOpen) {
      haptics.impact();
      controls.start({
        x: -ACTION_WIDTH,
        transition: { type: "spring", stiffness: 400, damping: 30 },
      });
      setIsOpen(true);
    } else {
      // Snap back to current state
      controls.start({
        x: isOpen ? -ACTION_WIDTH : 0,
        transition: { type: "spring", stiffness: 400, damping: 30 },
      });
    }
  };

  const close = () => {
    controls.start({ x: 0, transition: { type: "spring", stiffness: 400, damping: 30 } });
    setIsOpen(false);
  };

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Action buttons behind the card */}
      <motion.div
        style={{ opacity: actionsOpacity }}
        className="absolute inset-y-0 right-0 flex w-[120px] items-stretch"
      >
        <button
          onClick={() => {
            close();
            onEdit();
          }}
          className="flex flex-1 flex-col items-center justify-center gap-1 bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
          aria-label="Editar rascunho"
        >
          <Pencil className="h-4 w-4" />
          <span className="text-[10px] font-medium">Editar</span>
        </button>
        <button
          onClick={() => {
            close();
            onDelete();
          }}
          className="flex flex-1 flex-col items-center justify-center gap-1 bg-destructive text-destructive-foreground transition-colors hover:bg-destructive/90"
          aria-label="Excluir rascunho"
        >
          <Trash2 className="h-4 w-4" />
          <span className="text-[10px] font-medium">Excluir</span>
        </button>
      </motion.div>

      {/* Draggable card layer */}
      <motion.div
        style={{ x }}
        animate={controls}
        drag="x"
        dragConstraints={{ left: -ACTION_WIDTH, right: 0 }}
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
        className="relative"
      >
        {children}

        {/* Swipe hint: subtle chevron on the right edge */}
        <motion.div
          initial={{ opacity: 0.6 }}
          animate={{ opacity: [0.6, 0.3, 0.6], x: [0, -3, 0] }}
          transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
          className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2"
        >
          <ChevronLeft className="h-4 w-4 text-muted-foreground/50" />
        </motion.div>
      </motion.div>
    </div>
  );
}
