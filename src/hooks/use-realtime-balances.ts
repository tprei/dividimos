"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { balanceRowToBalance } from "@/lib/supabase/expense-mappers";
import type { Balance } from "@/types";
import type { Database } from "@/types/database";

type BalanceRow = Database["public"]["Tables"]["balances"]["Row"];

/**
 * Subscribe to realtime changes on the `balances` table for a group.
 * Patches the provided balances array in-place via `onBalanceChange`
 * instead of triggering a full reload (per data fetching rules).
 *
 * Listens for INSERT and UPDATE events — balances are upserted by the
 * `activate_expense` and `confirm_settlement` RPCs.
 */
export function useRealtimeBalances(
  groupId: string | undefined,
  onBalanceChange: (balance: Balance) => void,
) {
  // Stabilize callback ref to avoid channel churn on every render
  const callbackRef = useRef(onBalanceChange);
  useEffect(() => {
    callbackRef.current = onBalanceChange;
  });

  useEffect(() => {
    if (!groupId || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;

    const supabase = createClient();

    const channel = supabase
      .channel(`balances:${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "balances",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          callbackRef.current(balanceRowToBalance(payload.new as BalanceRow));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "balances",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          callbackRef.current(balanceRowToBalance(payload.new as BalanceRow));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId]);
}
