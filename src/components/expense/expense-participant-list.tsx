"use client";

import { GuestAvatar, GuestBadge } from "@/components/shared/guest-avatar";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import type { Participant } from "@/types/ledger";

interface ExpenseParticipantListProps {
  participants: Participant[];
  meId: string | null;
  onInviteGuest: (participant: Participant) => void;
}

export function ExpenseParticipantList({
  participants,
  meId,
  onInviteGuest,
}: ExpenseParticipantListProps) {
  return (
    <section className="mt-2">
      <ul aria-label="Participantes" className="divide-y divide-border">
        {participants.map((participant) => {
          const isMe = participant.user !== null && participant.user.id === meId;

          if (participant.kind === "guest" && participant.guest) {
            return (
              <li
                key={participant.participantIndex}
                className="flex min-h-14 items-center gap-3 px-4 py-2"
              >
                <GuestAvatar size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-semibold">
                      {participant.guest.displayName}
                    </span>
                    <GuestBadge />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    <Money cents={participant.shareCents} />
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  aria-label={`Convidar ${participant.guest.displayName}`}
                  className="h-11 shrink-0 rounded-full px-4"
                  onClick={() => onInviteGuest(participant)}
                >
                  Convidar
                </Button>
              </li>
            );
          }

          const name = participant.user?.name ?? "Alguém";
          return (
            <li
              key={participant.participantIndex}
              className="flex min-h-14 items-center gap-3 px-4 py-2"
            >
              <UserAvatar
                name={name}
                avatarUrl={participant.user?.avatarUrl}
                size="md"
              />
              <div className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">
                  {isMe ? "Você" : name}
                </span>
                {isMe && participant.paidCents > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Pagou <Money cents={participant.paidCents} />
                  </p>
                )}
              </div>
              <Money
                cents={participant.shareCents}
                className="text-sm font-semibold"
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
