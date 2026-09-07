"use client";

import { useCallback } from "react";
import { useBillStore } from "@/stores/bill-store";

export function useItemAssignment() {
  const handleAssign = useCallback((itemId: string, userId: string) => {
    const store = useBillStore.getState();
    const existingSplits = store.splits.filter((s) => s.itemId === itemId);
    const allUserIds = [...existingSplits.map((s) => s.userId), userId];
    store.splitItemEqually(itemId, allUserIds);
  }, []);

  const handleUnassign = useCallback((itemId: string, userId: string) => {
    const store = useBillStore.getState();
    store.unassignItem(itemId, userId);
    const remaining = store.splits
      .filter((s) => s.itemId === itemId && s.userId !== userId)
      .map((s) => s.userId);
    if (remaining.length > 0) {
      store.splitItemEqually(itemId, remaining);
    }
  }, []);

  const handleAssignAll = useCallback((itemId: string) => {
    const store = useBillStore.getState();
    const allPersonIds = [
      ...store.participants.map((p) => p.id),
      ...store.guests.map((g) => g.id),
    ];
    const currentSplits = store.splits.filter((s) => s.itemId === itemId);
    const allAssigned = currentSplits.length === allPersonIds.length;
    if (allAssigned) {
      for (const id of allPersonIds) {
        store.unassignItem(itemId, id);
      }
    } else {
      store.splitItemEqually(itemId, allPersonIds);
    }
  }, []);

  return { handleAssign, handleUnassign, handleAssignAll };
}
