"use client";

import { GuestAvatar, GuestBadge } from "@/components/shared/guest-avatar";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import type { Participant } from "@/types/ledger";

interface ExpenseParticipantListProps {
  participants: Participant[];
  meId: string | null;
  invitedUserIds: ReadonlySet<string>;
  onInviteGuest: (participant: Participant, anchor: HTMLButtonElement) => void;
  showHeading?: boolean;
}

export function ExpenseParticipantList({
  participants,
  meId,
  invitedUserIds,
  onInviteGuest,
  showHeading = true,
}: ExpenseParticipantListProps) {
  return (
    <section className={showHeading ? "mt-5" : undefined}>
      {showHeading && (
        <>
          <h2 className="mb-1 text-sm font-semibold">Resumo por pessoa</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            Consumo, pagamento e o saldo de cada um nessa conta.
          </p>
        </>
      )}
      <ul
        aria-label="Participantes"
        className="divide-y divide-border overflow-hidden rounded-2xl border bg-card"
      >
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
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-[15px] font-semibold wrap-anywhere">
                        {participant.guest.displayName}
                      </span>
                      <GuestBadge />
                    </span>
                    <Money
                      cents={participant.paidCents - participant.shareCents}
                      signed
                      className="shrink-0 text-sm font-semibold"
                      label={`Saldo de ${participant.guest.displayName} nessa conta`}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      Consumiu <Money cents={participant.shareCents} className="text-xs" />
                      {participant.paidCents > 0 && (
                        <>
                          {" · Pagou "}
                          <Money cents={participant.paidCents} className="text-xs" />
                        </>
                      )}
                    </p>
                    {participant.guest.claimedBy === null && (
                      <Button
                        type="button"
                        variant="outline"
                        aria-label={`Convidar ${participant.guest.displayName}`}
                        className="h-11 shrink-0 rounded-full px-4"
                        onClick={(event) => onInviteGuest(participant, event.currentTarget)}
                      >
                        Convidar
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          }

          const name = participant.user?.name ?? "Alguém";
          const invited =
            participant.user !== null && invitedUserIds.has(participant.user.id);
          return (
            <li
              key={participant.participantIndex}
              className="flex min-h-14 items-center gap-3 px-4 py-2"
            >
              <UserAvatar
                name={name}
                avatarUrl={participant.user?.avatarUrl}
                size="md"
                isBot={participant.user?.isBot}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-semibold">
                    {isMe ? "Você" : name}
                  </span>
                  {invited && (
                    <Chip tone="warning" className="shrink-0">
                      Convite pendente
                    </Chip>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Consumiu <Money cents={participant.shareCents} className="text-xs" />
                  {participant.paidCents > 0 && (
                    <>
                      {" · Pagou "}
                      <Money cents={participant.paidCents} className="text-xs" />
                    </>
                  )}
                </p>
              </div>
              <Money
                cents={participant.paidCents - participant.shareCents}
                signed
                className="shrink-0 text-sm font-semibold"
                label={`Saldo de ${name} nessa conta`}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
