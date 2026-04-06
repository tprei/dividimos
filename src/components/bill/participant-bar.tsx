"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { Search, X, GripVertical } from "lucide-react";
import { UserAvatar } from "@/components/shared/user-avatar";
import { cn } from "@/lib/utils";
import type { UserProfile } from "@/types";
import type { Guest } from "@/stores/bill-store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Participant {
  id: string;
  name: string;
  avatarUrl?: string;
  isGuest: boolean;
}

export type AssignmentMode = "by-item" | "by-person";

export interface ParticipantBarProps {
  participants: UserProfile[];
  guests: Guest[];
  /** Total number of items in the expense */
  totalItems: number;
  /** Map of participantId → number of items they are assigned to */
  assignedCountMap: Record<string, number>;
  /** Currently selected person (by-person mode) */
  selectedPersonId?: string | null;
  /** Current assignment mode */
  mode: AssignmentMode;
  /** Called when a participant avatar is tapped (by-person mode) */
  onSelectPerson?: (personId: string) => void;
  /** Called when a participant is dragged and dropped onto an item */
  onDropOnItem?: (personId: string, itemId: string) => void;
  /** Ref map for item drop targets — maps itemId to the item's DOM element */
  itemDropRefs?: React.RefObject<Map<string, HTMLElement>>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeParticipants(
  participants: UserProfile[],
  guests: Guest[],
): Participant[] {
  const users: Participant[] = participants.map((p) => ({
    id: p.id,
    name: p.name,
    avatarUrl: p.avatarUrl,
    isGuest: false,
  }));
  const guestEntries: Participant[] = guests.map((g) => ({
    id: g.id,
    name: g.name,
    isGuest: true,
  }));
  return [...users, ...guestEntries];
}

// ---------------------------------------------------------------------------
// ProgressRing — SVG ring around avatar showing assignment progress
// ---------------------------------------------------------------------------

interface ProgressRingProps {
  progress: number; // 0-1
  size: number;
  strokeWidth: number;
  className?: string;
  children: React.ReactNode;
}

function ProgressRing({ progress, size, strokeWidth, className, children }: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(1, Math.max(0, progress)));

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted/40"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={progress >= 1 ? "text-success" : "text-primary"}
          style={{ transition: "stroke-dashoffset 0.4s ease" }}
        />
      </svg>
      <div className="relative">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DraggableAvatar — single avatar chip, draggable in by-item mode
// ---------------------------------------------------------------------------

interface DraggableAvatarProps {
  participant: Participant;
  progress: number;
  isSelected: boolean;
  mode: AssignmentMode;
  onTap: () => void;
  onDragEnd: (info: PanInfo) => void;
}

function DraggableAvatar({
  participant,
  progress,
  isSelected,
  mode,
  onTap,
  onDragEnd,
}: DraggableAvatarProps) {
  const isDraggable = mode === "by-item";

  return (
    <motion.div
      className={cn(
        "flex flex-col items-center gap-1 select-none",
        isDraggable && "cursor-grab active:cursor-grabbing",
      )}
      whileTap={isDraggable ? { scale: 1.1 } : { scale: 0.95 }}
      drag={isDraggable}
      dragSnapToOrigin
      dragElastic={0.6}
      dragMomentum={false}
      onDragEnd={(_e, info) => {
        if (isDraggable) onDragEnd(info);
      }}
      onClick={() => {
        if (mode === "by-person") onTap();
      }}
      layout
      data-participant-id={participant.id}
      role="button"
      aria-label={`${participant.name}${isDraggable ? " — arraste para atribuir" : ""}`}
    >
      <ProgressRing progress={progress} size={48} strokeWidth={2.5}>
        <div
          className={cn(
            "rounded-full ring-2 ring-offset-1 ring-offset-background transition-all",
            isSelected
              ? "ring-primary shadow-md shadow-primary/25"
              : "ring-transparent",
            participant.isGuest && "ring-dashed",
          )}
        >
          <UserAvatar
            name={participant.name}
            avatarUrl={participant.avatarUrl}
            size="sm"
          />
        </div>
      </ProgressRing>
      <span
        className={cn(
          "max-w-[56px] truncate text-center text-[10px] leading-tight",
          isSelected ? "font-semibold text-primary" : "text-muted-foreground",
        )}
      >
        {participant.name.split(" ")[0]}
      </span>
      {isDraggable && (
        <GripVertical className="h-3 w-3 text-muted-foreground/40" />
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// DragOverlay — floating avatar that follows the pointer during drag
// ---------------------------------------------------------------------------

interface DragOverlayProps {
  participant: Participant | null;
  position: { x: number; y: number } | null;
}

function DragOverlay({ participant, position }: DragOverlayProps) {
  if (!participant || !position) return null;

  return (
    <motion.div
      className="pointer-events-none fixed z-50 flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg shadow-primary/30"
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1, x: position.x - 40, y: position.y - 20 }}
      exit={{ opacity: 0, scale: 0.5 }}
      transition={{ type: "spring", stiffness: 500, damping: 25 }}
    >
      <UserAvatar name={participant.name} avatarUrl={participant.avatarUrl} size="xs" />
      {participant.name.split(" ")[0]}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// ParticipantBar — main exported component
// ---------------------------------------------------------------------------

export function ParticipantBar({
  participants,
  guests,
  totalItems,
  assignedCountMap,
  selectedPersonId,
  mode,
  onSelectPerson,
  onDropOnItem,
  itemDropRefs,
}: ParticipantBarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const allParticipants = useMemo(
    () => normalizeParticipants(participants, guests),
    [participants, guests],
  );

  const filteredParticipants = useMemo(() => {
    if (!searchQuery.trim()) return allParticipants;
    const q = searchQuery.toLowerCase().trim();
    return allParticipants.filter((p) => p.name.toLowerCase().includes(q));
  }, [allParticipants, searchQuery]);

  const handleSearchChange = useCallback((value: string) => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setSearchQuery(value);
    }, 200);
  }, []);

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (showSearch && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [showSearch]);

  const handleDragEnd = useCallback(
    (participantId: string, info: PanInfo) => {
      setDraggingId(null);
      setDragPosition(null);

      if (!onDropOnItem || !itemDropRefs?.current) return;

      const dropMap = itemDropRefs.current;
      for (const [itemId, element] of dropMap.entries()) {
        const rect = element.getBoundingClientRect();
        const dragEndX = info.point.x;
        const dragEndY = info.point.y;

        if (
          dragEndX >= rect.left &&
          dragEndX <= rect.right &&
          dragEndY >= rect.top &&
          dragEndY <= rect.bottom
        ) {
          if (navigator.vibrate) navigator.vibrate(15);
          onDropOnItem(participantId, itemId);
          return;
        }
      }
    },
    [onDropOnItem, itemDropRefs],
  );

  const draggingParticipant = draggingId
    ? allParticipants.find((p) => p.id === draggingId) ?? null
    : null;

  const showSearchToggle = allParticipants.length > 6;

  return (
    <div className="sticky top-0 z-30 -mx-4 bg-background/95 px-4 pb-2 pt-3 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <div
          className="flex gap-3 overflow-x-auto pb-1 scrollbar-none"
          role="toolbar"
          aria-label="Participantes"
        >
          <AnimatePresence mode="popLayout">
            {filteredParticipants.map((p) => {
              const count = assignedCountMap[p.id] ?? 0;
              const progress = totalItems > 0 ? count / totalItems : 0;

              return (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ type: "spring", stiffness: 400, damping: 25 }}
                >
                  <DraggableAvatar
                    participant={p}
                    progress={progress}
                    isSelected={selectedPersonId === p.id}
                    mode={mode}
                    onTap={() => onSelectPerson?.(p.id)}
                    onDragEnd={(info) => handleDragEnd(p.id, info)}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {showSearchToggle && (
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => {
              setShowSearch((v) => !v);
              if (showSearch) {
                setSearchQuery("");
              }
            }}
            className="ml-auto flex-shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted"
            aria-label={showSearch ? "Fechar busca" : "Buscar participante"}
          >
            {showSearch ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
          </motion.button>
        )}
      </div>

      <AnimatePresence>
        {showSearch && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Buscar participante..."
              onChange={(e) => handleSearchChange(e.target.value)}
              className="mt-2 w-full rounded-lg border bg-muted/50 px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              aria-label="Buscar participante"
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        <DragOverlay participant={draggingParticipant} position={dragPosition} />
      </AnimatePresence>
    </div>
  );
}
