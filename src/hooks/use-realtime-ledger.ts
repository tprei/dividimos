"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useBillStore } from "@/stores/bill-store";
import type { DebtStatus } from "@/types";

export function useRealtimeLedger(billId: string | undefined) {
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
            paid_amount_cents: number;
          };

          useBillStore.setState((state) => ({
            ledger: state.ledger.map((e) =>
              e.id === updated.id
                ? {
                    ...e,
                    status: updated.status,
                    paidAmountCents: updated.paid_amount_cents ?? e.paidAmountCents,
                    paidAt: updated.paid_at ?? undefined,
                  }
                : e,
            ),
          }));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [billId]);
}
