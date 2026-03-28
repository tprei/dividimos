"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ExpenseStatus } from "@/types";

/**
 * Subscribe to realtime changes on a specific expense row.
 * Calls `onUpdate` with the changed fields when the expense is updated
 * (e.g., status transitions like draft → active → settled).
 */
export function useRealtimeExpense(
  expenseId: string | undefined,
  onUpdate: (updated: { id: string; status: ExpenseStatus; updatedAt: string }) => void,
) {
  useEffect(() => {
    if (!expenseId || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;

    const supabase = createClient();

    const channel = supabase
      .channel(`expense:${expenseId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "expenses",
          filter: `id=eq.${expenseId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            status: ExpenseStatus;
            updated_at: string;
          };

          onUpdate({
            id: row.id,
            status: row.status,
            updatedAt: row.updated_at,
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [expenseId, onUpdate]);
}
