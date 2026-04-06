"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/currency";
import type { UserProfile } from "@/types";

interface WizardItem {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalPriceCents: number;
}

interface WizardItemSplit {
  id: string;
  userId: string;
  computedAmountCents: number;
  user?: UserProfile;
}

interface GuestEntry {
  id: string;
  name: string;
}

interface CompactItemRowProps {
  item: WizardItem;
  splits: WizardItemSplit[];
  participants: UserProfile[];
  guests?: GuestEntry[];
  onAssign: (itemId: string, userId: string) => void;
  onUnassign: (itemId: string, userId: string) => void;
  /** Ref callback for dnd-kit useDroppable — attach to the row root. */
  dropRef?: (node: HTMLElement | null) => void;
  /** True when a dragged avatar is hovering over this row. */
  isDropTarget?: boolean;
}

function getInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

function CompactItemRowInner({
  item,
  splits,
  participants,
  guests = [],
  onAssign,
  onUnassign,
  dropRef,
  isDropTarget = false,
}: CompactItemRowProps) {
  const assignedUserIds = new Set(splits.map((s) => s.userId));
  const totalPersons = participants.length + guests.length;
  const totalAssigned = splits.reduce((sum, s) => sum + s.computedAmountCents, 0);
  const assignedPercent =
    item.totalPriceCents > 0
      ? Math.min(100, Math.round((totalAssigned / item.totalPriceCents) * 100))
      : 0;

  const handleToggle = (userId: string, isAssigned: boolean) => {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(10);
    }
    if (isAssigned) {
      onUnassign(item.id, userId);
    } else {
      onAssign(item.id, userId);
    }
  };

  const allPersons: { id: string; name: string; avatarUrl?: string | null; isGuest: boolean }[] = [
    ...participants.map((p) => ({ id: p.id, name: p.name, avatarUrl: p.avatarUrl, isGuest: false })),
    ...guests.map((g) => ({ id: g.id, name: g.name, avatarUrl: undefined, isGuest: true })),
  ];

  return (
    <div
      ref={dropRef}
      className={cn(
        "flex items-center gap-3 rounded-xl border px-3 py-2 transition-colors",
        isDropTarget
          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
          : "border-border bg-card",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-sm font-medium">{item.description}</span>
          {item.quantity > 1 && (
            <span className="shrink-0 text-xs text-muted-foreground">{item.quantity}x</span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-xs font-semibold tabular-nums">
            {formatBRL(item.totalPriceCents)}
          </span>
          {splits.length > 0 && (
            <span className="text-xs text-primary">
              {splits.length}/{totalPersons}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center -space-x-1">
        {allPersons.map((person) => {
          const isAssigned = assignedUserIds.has(person.id);
          return (
            <button
              key={person.id}
              type="button"
              onClick={() => handleToggle(person.id, isAssigned)}
              aria-label={
                isAssigned
                  ? `Remover ${person.name.split(" ")[0]}`
                  : `Atribuir ${person.name.split(" ")[0]}`
              }
              className={cn(
                "relative flex h-7 w-7 items-center justify-center rounded-full border-2 text-[10px] font-bold transition-all",
                isAssigned
                  ? "border-primary bg-primary text-primary-foreground z-10"
                  : person.isGuest
                    ? "border-dashed border-muted-foreground/30 bg-muted text-muted-foreground"
                    : "border-card bg-muted text-muted-foreground hover:border-primary/40",
              )}
            >
              {person.avatarUrl ? (
                <img
                  src={person.avatarUrl}
                  alt={person.name}
                  className="h-full w-full rounded-full object-cover"
                />
              ) : (
                getInitial(person.name)
              )}
            </button>
          );
        })}
      </div>

      <div className="h-6 w-1 shrink-0 overflow-hidden rounded-full bg-muted">
        <motion.div
          className={cn(
            "w-full rounded-full",
            assignedPercent === 100 ? "bg-success" : "bg-primary",
          )}
          initial={{ height: 0 }}
          animate={{ height: `${assignedPercent}%` }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        />
      </div>
    </div>
  );
}

export const CompactItemRow = memo(CompactItemRowInner);
