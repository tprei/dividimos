"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Broadcast wakes (#477 Slice 6). The server sends a wake carrying only
 * the expense ID and graph revision — no financial data. On receiving a
 * wake, the caller refetches the authorized snapshot.
 *
 * Previously used Postgres Changes (which sent full row payloads).
 * Postgres Changes was removed from the `expenses` table; the server now
 * sends minimal Broadcast wakes from the graph-mutation finalizer.
 */
export function useRealtimeExpense(
  expenseId: string | undefined,
  onUpdate: () => void,
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
      .channel(`expense_wake:${expenseId}`, { config: { private: true } })
      .on("broadcast", { event: "wake" }, (payload) => {
        // The wake carries { expense_id, graph_revision }. We don't use
        // the revision here — the caller refetches the full snapshot.
        const data = payload.payload as { expense_id?: string } | null;
        if (data?.expense_id !== expenseId) return;
        callbackRef.current();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [expenseId]);
}
