"use client";

import { AnimatePresence } from "framer-motion";
import { Receipt, Users } from "lucide-react";
import { ItemCard } from "@/components/bill/item-card";
import { Button } from "@/components/ui/button";
import type { ExpenseItem, ItemSplit, User, UserProfile } from "@/types";

export interface SplitStepProps {
  items: ExpenseItem[];
  splits: ItemSplit[];
  participants: User[];
  guests: { id: string; name: string }[];
  onAssign: (itemId: string, userId: string) => void;
  onUnassign: (itemId: string, userId: string) => void;
  onAssignAll: (itemId: string) => void;
  onRemoveItem: (id: string) => void;
  onSplitItemEqually: (itemId: string, userIds: string[]) => void;
}

export function SplitStep({
  items,
  splits,
  participants,
  guests,
  onAssign,
  onUnassign,
  onAssignAll,
  onRemoveItem,
  onSplitItemEqually,
}: SplitStepProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Toca nos nomes pra atribuir itens. Compartilhados são divididos igualmente.
      </p>
      <AnimatePresence>
        {items.map((item) => {
          const itemSplits = splits
            .filter((s) => s.itemId === item.id)
            .map((s) => {
              const user = participants.find((p) => p.id === s.userId);
              const guest = !user ? guests.find((g) => g.id === s.userId) : null;
              return { ...s, user: user ?? (guest ? { id: guest.id, name: guest.name, handle: "" } as UserProfile : undefined) };
            });
          return (
            <ItemCard key={item.id} item={item} splits={itemSplits} participants={participants} guests={guests} onAssign={onAssign} onUnassign={onUnassign} onAssignAll={onAssignAll} onRemove={onRemoveItem} />
          );
        })}
      </AnimatePresence>
      {items.length > 0 && (() => {
        const unassignedItems = items.filter((item) => splits.filter((s) => s.itemId === item.id).length === 0);
        if (unassignedItems.length === 0) return null;
        const allPersonIds = [...participants.map((p) => p.id), ...guests.map((g) => g.id)];
        return (
          <Button variant="outline" className="w-full gap-2 border-dashed border-primary/40 text-primary" onClick={() => { for (const item of unassignedItems) { onSplitItemEqually(item.id, allPersonIds); } }}>
            <Users className="h-4 w-4" />
            Dividir {unassignedItems.length} restante{unassignedItems.length > 1 ? "s" : ""} igualmente
          </Button>
        );
      })()}
      {items.length === 0 && (
        <div className="py-12 text-center text-muted-foreground">
          <Receipt className="mx-auto h-8 w-8 opacity-50" />
          <p className="mt-2 text-sm">Adicione itens primeiro</p>
        </div>
      )}
    </div>
  );
}
