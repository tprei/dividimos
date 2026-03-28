"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Trash2, Users, UsersRound } from "lucide-react";
import { formatBRL } from "@/lib/currency";
import type { UserProfile } from "@/types";

/** Fields the card actually reads from an item — compatible with both BillItem and ExpenseItem. */
interface WizardItem {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalPriceCents: number;
}

/** Per-item assignment used during the split step (wizard-only, not persisted in Expense model). */
interface WizardItemSplit {
  id: string;
  userId: string;
  computedAmountCents: number;
  user?: UserProfile;
}

interface ItemCardProps {
  item: WizardItem;
  splits: WizardItemSplit[];
  participants: UserProfile[];
  onAssign: (itemId: string, userId: string) => void;
  onUnassign: (itemId: string, userId: string) => void;
  onAssignAll: (itemId: string) => void;
  onRemove: (itemId: string) => void;
}

export function ItemCard({
  item,
  splits,
  participants,
  onAssign,
  onUnassign,
  onAssignAll,
  onRemove,
}: ItemCardProps) {
  const assignedUserIds = new Set(splits.map((s) => s.userId));
  const totalAssigned = splits.reduce((sum, s) => sum + s.computedAmountCents, 0);
  const assignedPercent =
    item.totalPriceCents > 0
      ? Math.min(100, Math.round((totalAssigned / item.totalPriceCents) * 100))
      : 0;
  const allAssigned = assignedUserIds.size === participants.length;
  const unassigned = item.totalPriceCents - totalAssigned;

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

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="rounded-2xl border bg-card p-4"
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{item.description}</p>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            {item.quantity > 1 && <span>{item.quantity}x</span>}
            <span className="font-semibold tabular-nums text-foreground">
              {formatBRL(item.totalPriceCents)}
            </span>
            {splits.length > 0 && (
              <span className="text-primary">
                · {splits.length}/{participants.length}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => onRemove(item.id)}
          className="ml-2 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="h-3 w-3" />
          <span>Quem consumiu?</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <motion.button
            whileTap={{ scale: 0.93 }}
            transition={{ type: "spring", stiffness: 400, damping: 17 }}
            onClick={() => onAssignAll(item.id)}
            className={`flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1.5 text-xs font-medium transition-all ${
              allAssigned
                ? "border-primary bg-primary/10 text-primary"
                : "border-primary/40 text-primary hover:bg-primary/5"
            }`}
          >
            <UsersRound className="h-3.5 w-3.5" />
            Todos
          </motion.button>
          {participants.map((user) => {
            const isAssigned = assignedUserIds.has(user.id);
            return (
              <motion.button
                key={user.id}
                whileTap={{ scale: 0.93 }}
                transition={{ type: "spring", stiffness: 400, damping: 17 }}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={() => handleToggle(user.id, isAssigned)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                  isAssigned
                    ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {isAssigned ? (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 500, damping: 15 }}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </motion.span>
                ) : (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-foreground/10 text-[9px] font-bold">
                    {user.name.charAt(0)}
                  </span>
                )}
                {user.name.split(" ")[0]}
              </motion.button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
        <motion.div
          className={`h-full rounded-full ${
            assignedPercent === 100 ? "bg-success" : "bg-primary"
          }`}
          initial={{ width: 0 }}
          animate={{ width: `${assignedPercent}%` }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        />
      </div>

      <AnimatePresence>
        {splits.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-3 overflow-hidden rounded-lg bg-foreground/[0.03] p-2.5"
          >
            <div className="space-y-1">
              {splits.map((split) => (
                <div
                  key={split.id}
                  className="flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/15 text-[8px] font-bold text-primary">
                      {split.user?.name?.charAt(0) || "?"}
                    </span>
                    <span className="text-muted-foreground">
                      {split.user?.name?.split(" ")[0] || "?"}
                    </span>
                  </div>
                  <span className="font-medium tabular-nums">
                    {formatBRL(split.computedAmountCents)}
                  </span>
                </div>
              ))}
            </div>
            {unassigned > 0 && (
              <div className="mt-1.5 flex items-center justify-between border-t border-border pt-1.5 text-xs text-warning-foreground">
                <span>Nao atribuido</span>
                <span className="font-medium tabular-nums">
                  {formatBRL(unassigned)}
                </span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
