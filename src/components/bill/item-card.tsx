"use client";

import { motion } from "framer-motion";
import { Trash2, Users } from "lucide-react";
import { formatBRL } from "@/lib/currency";
import type { BillItem, ItemSplit, User } from "@/types";

interface ItemCardProps {
  item: BillItem;
  splits: (ItemSplit & { user?: User })[];
  participants: User[];
  onAssign: (itemId: string, userId: string) => void;
  onUnassign: (itemId: string, userId: string) => void;
  onRemove: (itemId: string) => void;
}

export function ItemCard({
  item,
  splits,
  participants,
  onAssign,
  onUnassign,
  onRemove,
}: ItemCardProps) {
  const assignedUserIds = new Set(splits.map((s) => s.userId));
  const totalAssigned = splits.reduce((sum, s) => sum + s.computedAmountCents, 0);
  const unassigned = item.totalPriceCents - totalAssigned;

  return (
    <motion.div
      layout
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
          {participants.map((user) => {
            const isAssigned = assignedUserIds.has(user.id);
            return (
              <motion.button
                key={user.id}
                whileTap={{ scale: 0.93 }}
                onClick={() =>
                  isAssigned
                    ? onUnassign(item.id, user.id)
                    : onAssign(item.id, user.id)
                }
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                  isAssigned
                    ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-[10px] font-bold">
                  {user.name.charAt(0)}
                </span>
                {user.name.split(" ")[0]}
              </motion.button>
            );
          })}
        </div>
      </div>

      {splits.length > 0 && (
        <div className="mt-3 rounded-lg bg-muted/50 p-2">
          <div className="space-y-1">
            {splits.map((split) => (
              <div
                key={split.id}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-muted-foreground">
                  {split.user?.name?.split(" ")[0] || "?"}
                </span>
                <span className="font-medium tabular-nums">
                  {formatBRL(split.computedAmountCents)}
                </span>
              </div>
            ))}
          </div>
          {unassigned > 0 && (
            <div className="mt-1 flex items-center justify-between border-t border-border pt-1 text-xs text-warning-foreground">
              <span>Nao atribuido</span>
              <span className="font-medium tabular-nums">
                {formatBRL(unassigned)}
              </span>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
