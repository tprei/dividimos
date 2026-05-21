"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { settlementRowToSettlement } from "@/lib/supabase/expense-mappers";
import { validateRealtimeRow } from "./realtime-payload";
import type { Settlement } from "@/types";
import type { Database } from "@/types/database";

type SettlementRow = Database["public"]["Tables"]["settlements"]["Row"];

const SETTLEMENT_STRING_KEYS = [
  "id",
  "group_id",
  "from_user_id",
  "to_user_id",
  "status",
] as const;
const SETTLEMENT_NUMBER_KEYS = ["amount_cents"] as const;

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
          const row = validateRealtimeRow<SettlementRow>(
            payload.new,
            SETTLEMENT_STRING_KEYS,
            SETTLEMENT_NUMBER_KEYS,
          );
          if (row) {
            callbackRef.current({
              type: "inserted",
              settlement: settlementRowToSettlement(row),
            });
          }
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
          const row = validateRealtimeRow<SettlementRow>(
            payload.new,
            SETTLEMENT_STRING_KEYS,
            SETTLEMENT_NUMBER_KEYS,
          );
          if (row) {
            callbackRef.current({
              type: "updated",
              settlement: settlementRowToSettlement(row),
            });
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId]);
}
