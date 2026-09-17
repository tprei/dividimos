"use client";

import { GUEST_PAYER_NOTICE } from "@/components/bill/payer-copy";
import { PersonLabel } from "@/components/shared/person-label";
import { UserAvatar } from "@/components/shared/user-avatar";
import type { ExpensePayer, User } from "@/types";

export function SingleBillPayerSection({
  participants,
  payers,
  hasPayer,
  onPayerSelect,
  hasGuests,
}: {
  participants: User[];
  payers: ExpensePayer[];
  hasPayer: boolean;
  onPayerSelect: (userId: string) => void;
  hasGuests?: boolean;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm leading-5 font-semibold">Quem pagou</h2>
      {hasGuests && (
        <p className="text-xs text-muted-foreground">{GUEST_PAYER_NOTICE}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {participants.map((participant) => {
          const selected = payers.some((payer) => payer.userId === participant.id && payer.amountCents > 0);
          return (
            <button
              key={participant.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onPayerSelect(participant.id)}
              className={`flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm font-semibold transition-colors ${
                selected
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border bg-card text-foreground"
              }`}
            >
              <UserAvatar name={participant.name} avatarUrl={participant.avatarUrl} size="xs" />
              <PersonLabel name={participant.name} handle={participant.handle} nameClassName="text-sm" />
            </button>
          );
        })}
      </div>
      {!hasPayer && <p className="text-xs text-destructive">Selecione quem pagou.</p>}
    </section>
  );
}
