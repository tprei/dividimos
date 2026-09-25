"use client";

import { GuestAvatar } from "@/components/shared/guest-avatar";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import type { Participant } from "@/types/ledger";
import { displayNames } from "@/lib/people";

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
  const names = displayNames(participants.map((p) => ({
    id: p.user?.id ?? p.guest?.id ?? String(p.participantIndex),
    name: p.user?.name ?? p.guest?.displayName ?? "Alguém",
    handle: p.user?.handle, isGuest: p.kind === "guest",
  })), { style: "full", viewerId: meId ?? undefined });
  return (
    <section className={showHeading ? "mt-6" : undefined}>
      {showHeading && <h2 className="mb-3 text-lg font-semibold">Participantes</h2>}
      <ul
        aria-label="Participantes"
        className="divide-y divide-border overflow-hidden rounded-2xl border bg-card"
      >
        {participants.map((participant) => {
          const name = participant.user?.name ?? participant.guest?.displayName ?? "Alguém";
          const label = names.get(participant.user?.id ?? participant.guest?.id ?? String(participant.participantIndex)) ?? name;
          const invited = participant.user !== null && invitedUserIds.has(participant.user.id);
          return (
            <li
              key={participant.participantIndex}
              className="flex items-center gap-3 px-3 py-2.5"
            >
              {participant.guest ? (
                <GuestAvatar id={participant.guest.id} name={name} size="sm" />
              ) : (
                <UserAvatar
                  id={participant.user?.id}
                  name={name}
                  avatarUrl={participant.user?.avatarUrl}
                  size="sm"
                  isBot={participant.user?.isBot}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span title={label} className="truncate text-base font-semibold leading-5 text-foreground">
                      {label}
                    </span>
                    {invited && <Chip tone="warning">Convite pendente</Chip>}
                    {participant.guest && <Chip tone="guest">Convidado</Chip>}
                  </span>
                  <Money
                    cents={participant.paidCents - participant.shareCents}
                    signed
                    size="sm"
                    label={`Saldo de ${name} nessa conta`}
                    className="shrink-0 font-semibold leading-5"
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-xs leading-4 text-muted-foreground">
                    Consumiu <Money cents={participant.shareCents} className="text-xs" />
                    {participant.paidCents > 0 && (
                      <> · Pagou <Money cents={participant.paidCents} className="text-xs" /></>
                    )}
                  </p>
                  {participant.guest?.claimedBy === null && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Convidar ${name}`}
                      className="h-6 shrink-0 rounded-[0.5rem] px-2 text-xs"
                      onClick={(event) => onInviteGuest(participant, event.currentTarget)}
                    >
                      Convidar
                    </Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
