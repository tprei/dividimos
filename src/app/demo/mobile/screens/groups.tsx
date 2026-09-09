"use client";

import { ChevronRight } from "lucide-react";

import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";

import { GROUP_INVITE, GROUPS, firstName, personById } from "../fixtures";
import { PreviewShell } from "../preview-shell";
import { Money } from "../ui/money";
import { ScreenHeader } from "../ui/screen-header";

function InviteCard() {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-3">
        <UserAvatar size="sm" name={GROUP_INVITE.invitedBy.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">Convite · {GROUP_INVITE.name}</p>
          <p className="text-xs text-muted-foreground">Enviado por {firstName(GROUP_INVITE.invitedBy)}</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button className="h-10 flex-1">Aceitar</Button>
        <Button variant="outline" className="h-10 flex-1">
          Recusar
        </Button>
      </div>
    </div>
  );
}

function GroupRow({ name, memberIds, billCount, myNetCents }: (typeof GROUPS)[number]) {
  const visibleMembers = memberIds.slice(0, 3);
  const hiddenCount = memberIds.length - visibleMembers.length;
  return (
    <button
      type="button"
      className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{name}</p>
        <div className="mt-1 flex items-center gap-2">
          <div className="flex -space-x-1.5">
            {visibleMembers.map((id) => (
              <UserAvatar
                key={id}
                size="xs"
                name={personById(id).name}
                className="ring-2 ring-card"
              />
            ))}
          </div>
          {hiddenCount > 0 && (
            <span className="text-[11px] font-bold text-muted-foreground">+{hiddenCount}</span>
          )}
          <span className="text-xs text-muted-foreground">
            {memberIds.length} membros · {billCount} contas
          </span>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <Money cents={myNetCents} signed className="text-sm font-semibold" />
        <span className="text-[10px] font-bold uppercase text-muted-foreground">
          {myNetCents < 0 ? "A pagar" : "A receber"}
        </span>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

export function GroupsScreen() {
  return (
    <PreviewShell nav="groups">
      <ScreenHeader eyebrow="Suas divisões" title="Grupos" />
      <div className="space-y-4 px-4 pb-4">
        <InviteCard />
        <div className="divide-y divide-border rounded-2xl border bg-card">
          {GROUPS.map((group) => (
            <GroupRow key={group.id} {...group} />
          ))}
        </div>
      </div>
    </PreviewShell>
  );
}
