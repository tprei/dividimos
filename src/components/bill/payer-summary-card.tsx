"use client";

import { CreditCard } from "lucide-react";
import { formatBRL } from "@/lib/currency";
import type { UserProfile } from "@/types";

interface PayerSummaryCardProps {
  payers: { user: UserProfile; amountCents: number }[];
}

/**
 * #495: consumes already-joined canonical payer/user rows. No nullable
 * lookup, no unknown-person "?" fallback — callers must resolve each
 * payer's UserProfile before rendering.
 */
export function PayerSummaryCard({ payers }: PayerSummaryCardProps) {
  if (payers.length === 0) return null;

  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <CreditCard className="h-4 w-4 text-primary" />
        Quem pagou
      </div>
      <div className="mt-3 space-y-2">
        {payers.map(({ user, amountCents }) => (
          <div key={user.id} className="flex items-center gap-2 text-sm">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
              {user.name.charAt(0)}
            </span>
            <span className="flex-1">
              {user.name.split(" ")[0]}
              {payers.length === 1 && (
                <span className="text-muted-foreground"> pagou tudo</span>
              )}
            </span>
            <span className="font-medium tabular-nums">
              {formatBRL(amountCents)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
