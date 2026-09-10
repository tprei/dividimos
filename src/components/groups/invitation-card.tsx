"use client";

import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
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
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-3">
        {inviter && (
          <UserAvatar
            size="sm"
            name={inviter.user.name}
            avatarUrl={inviter.user.avatarUrl}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">
            Convite · {snapshot.group.name}
          </p>
          {inviter && (
            <p className="text-xs text-muted-foreground">
              Enviado por {inviter.user.name}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          variant="ghost"
          className="min-h-11 flex-1"
          disabled={busy}
          aria-label={`Recusar convite para ${snapshot.group.name}`}
          onClick={onDecline}
        >
          Recusar
        </Button>
        <Button
          className="min-h-11 flex-1"
          disabled={busy}
          aria-label={`Aceitar convite para ${snapshot.group.name}`}
          onClick={onAccept}
        >
          Aceitar
        </Button>
      </div>
    </div>
  );
}
