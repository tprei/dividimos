"use client";

import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/section-card";
import { haptics } from "@/hooks/use-haptics";
import type { GroupSnapshot, GroupMember } from "@/types/ledger";

export function InvitationCard({
  snapshot,
  meId,
  busy,
  onAccept,
  onDecline,
}: {
  snapshot: GroupSnapshot;
  meId: string;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const myMember = snapshot.members.find((m) => m.userId === meId);
  const inviter: GroupMember | undefined =
    snapshot.members.find((m) => m.userId === myMember?.invitedBy) ??
    snapshot.members.find((m) => m.userId === snapshot.group.creatorId);

  return (
    <SectionCard className="p-3">
      <div className="flex items-center gap-3">
        {inviter && (
          <UserAvatar
            id={inviter.userId}
            size="sm"
            name={inviter.user.name}
            avatarUrl={inviter.user.avatarUrl}
            isBot={inviter.user.isBot}
          />
        )}
        <div className="min-w-0 flex-1">
          <p
            title={snapshot.group.name}
            className="truncate text-base font-semibold"
          >
            Convite · {snapshot.group.name}
          </p>
          {inviter && (
            <p
              title={inviter.user.name}
              className="truncate text-sm text-muted-foreground"
            >
              Enviado por {inviter.user.name}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button
          variant="ghost"
          className="min-h-11"
          disabled={busy}
          aria-label={`Recusar convite para ${snapshot.group.name}`}
          onClick={() => {
            haptics.tap();
            onDecline();
          }}
        >
          Recusar
        </Button>
        <Button
          className="min-h-11"
          disabled={busy}
          aria-label={`Aceitar convite para ${snapshot.group.name}`}
          onClick={() => {
            haptics.tap();
            onAccept();
          }}
        >
          Aceitar
        </Button>
      </div>
    </SectionCard>
  );
}
