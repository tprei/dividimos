"use client";

import { GuestAvatar } from "@/components/shared/guest-avatar";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import type { PayerAttribution } from "@/lib/expense-attribution";
import { cn } from "@/lib/utils";

interface ExpensePayersProps {
  payers: PayerAttribution[];
  participantName: (participantIndex: number) => string;
  participantId: (participantIndex: number) => string;
  participantAvatarUrl: (participantIndex: number) => string | null;
  participantIsGuest: (participantIndex: number) => boolean;
  historical?: boolean;
}

export function ExpensePayers({
  payers,
  participantName,
  participantId,
  participantAvatarUrl,
  participantIsGuest,
  historical = false,
}: ExpensePayersProps) {
  if (payers.length === 0) return null;
  return (
    <section className={historical ? undefined : "mt-6"}>
      <h2 className="mb-3 text-lg font-semibold">Quem pagou</h2>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border bg-card">
        {payers.map((payer) => {
          const name = participantName(payer.participantIndex);
          return (
            <li
              key={payer.participantIndex}
              className="flex min-h-11 items-center gap-3 px-3 py-2.5"
            >
              {participantIsGuest(payer.participantIndex) ? (
                <GuestAvatar id={participantId(payer.participantIndex)} name={name} size="xs" />
              ) : (
                <UserAvatar
                  id={participantId(payer.participantIndex)}
                  name={name}
                  avatarUrl={participantAvatarUrl(payer.participantIndex)}
                  size="xs"
                />
              )}
              <span title={name} className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {Math.round(payer.basisPoints / 100)}%
              </span>
              <Money cents={payer.amountCents} className={cn("shrink-0 text-sm font-semibold", historical && "text-muted-foreground")} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
