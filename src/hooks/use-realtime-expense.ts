"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { validateRealtimeRow } from "./realtime-payload";
import type { ExpenseStatus } from "@/types";

type ExpenseUpdateRow = {
  id: string;
  status: ExpenseStatus;
  updated_at: string;
};

const EXPENSE_STRING_KEYS = ["id", "status", "updated_at"] as const;

/**
 * Subscribe to realtime changes on a specific expense row.
 * Calls `onUpdate` with the changed fields when the expense is updated
 * (e.g., status transitions like draft → active → settled).
 */
export function useRealtimeExpense(
  expenseId: string | undefined,
  onUpdate: (updated: { id: string; status: ExpenseStatus; updatedAt: string }) => void,
) {
  // Stabilize callback ref to avoid channel churn on every render.
  const callbackRef = useRef(onUpdate);
  useEffect(() => {
    callbackRef.current = onUpdate;
  });

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
          const row = validateRealtimeRow<ExpenseUpdateRow>(
            payload.new,
            EXPENSE_STRING_KEYS,
          );
          if (!row) return;

          callbackRef.current({
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
  }, [expenseId]);
}
