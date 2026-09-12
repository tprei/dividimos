"use client";

import { GuestAvatar } from "@/components/shared/guest-avatar";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import type { PayerAttribution } from "@/lib/expense-attribution";

interface ExpensePayersProps {
  payers: PayerAttribution[];
  participantName: (participantIndex: number) => string;
  participantAvatarUrl: (participantIndex: number) => string | null;
  participantIsGuest: (participantIndex: number) => boolean;
}

export function ExpensePayers({
  payers,
  participantName,
  participantAvatarUrl,
  participantIsGuest,
}: ExpensePayersProps) {
  if (payers.length === 0) return null;
  return (
    <section className="mt-5">
      <h2 className="mb-1 text-sm font-semibold">Quem pagou</h2>
      <p className="mb-2 text-xs text-muted-foreground">
        Quem colocou o dinheiro na mesa.
      </p>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border bg-card">
        {payers.map((payer) => {
          const name = participantName(payer.participantIndex);
          return (
            <li
              key={payer.participantIndex}
              className="flex min-h-14 items-center gap-3 px-4 py-2"
            >
              {participantIsGuest(payer.participantIndex) ? (
                <GuestAvatar size="sm" />
              ) : (
                <UserAvatar
                  name={name}
                  avatarUrl={participantAvatarUrl(payer.participantIndex)}
                  size="sm"
                />
              )}
              <span className="min-w-0 flex-1 text-sm font-semibold">{name}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {Math.round(payer.basisPoints / 100)}%
              </span>
              <Money cents={payer.amountCents} className="shrink-0 text-sm font-semibold" />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
