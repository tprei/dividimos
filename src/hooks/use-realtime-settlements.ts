"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { settlementRowToSettlement } from "@/lib/supabase/expense-mappers";
import type { Settlement } from "@/types";
import type { Database } from "@/types/database";

type SettlementRow = Database["public"]["Tables"]["settlements"]["Row"];

export type SettlementEvent =
  | { type: "inserted"; settlement: Settlement }
  | { type: "updated"; settlement: Settlement };

/**
 * Subscribe to realtime changes on the `settlements` table for a group.
 * Reports new settlements (INSERT) and status changes (UPDATE, e.g.,
 * pending → confirmed) so the UI can patch locally.
 */
export function useRealtimeSettlements(
  groupId: string | undefined,
  onSettlementEvent: (event: SettlementEvent) => void,
) {
  const callbackRef = useRef(onSettlementEvent);
  useEffect(() => {
    callbackRef.current = onSettlementEvent;
  });

  useEffect(() => {
    if (!groupId || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;

    const supabase = createClient();

    const channel = supabase
      .channel(`settlements:${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "settlements",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          callbackRef.current({
            type: "inserted",
            settlement: settlementRowToSettlement(payload.new as SettlementRow),
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "settlements",
          filter: `group_id=eq.${groupId}`,
        },
        (payload) => {
          callbackRef.current({
            type: "updated",
            settlement: settlementRowToSettlement(payload.new as SettlementRow),
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId]);
}
