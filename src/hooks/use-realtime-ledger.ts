"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useBillStore } from "@/stores/bill-store";
import type { DebtStatus } from "@/types";

export function useRealtimeLedger(billId: string | undefined) {
  const store = useBillStore();

  useEffect(() => {
    if (!billId || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;

    const supabase = createClient();

    const channel = supabase
      .channel(`ledger:${billId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "ledger",
          filter: `bill_id=eq.${billId}`,
        },
        (payload) => {
          const updated = payload.new as {
            id: string;
            status: DebtStatus;
            paid_at: string | null;
            confirmed_at: string | null;
          };

          if (updated.status === "paid_unconfirmed") {
            store.markPaid(updated.id);
          } else if (updated.status === "settled") {
            store.confirmPayment(updated.id);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [billId, store]);
}
