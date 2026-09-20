"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useInvitationActions } from "@/hooks/use-invitation-actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle } from "@/components/ui/popover";
import { formatRelativeDate } from "@/lib/datetime";
import { describeEvent } from "@/lib/ledger/event-copy";
import { getGroupName, makeNameOf } from "@/lib/ledger/group-names";
import { loadActivity } from "@/lib/sync/refresh";
import { useAppStore } from "@/stores/app-store";
import type { GroupEvent, GroupSnapshot } from "@/types/ledger";

/** A bell preview is a glance, not the activity page. */
const PREVIEW_LIMIT = 5;

export interface NotificationsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invitations: GroupSnapshot[];
  meId: string;
  anchor: HTMLElement | null;
}

function InvitationRow({
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
  const inviter = snapshot.members.find((member) => member.user.id !== meId);

  return (
    <li className="flex items-start gap-2 rounded-lg border bg-card p-2">
      <UserAvatar
        name={inviter?.user.name ?? snapshot.group.name}
        avatarUrl={inviter?.user.avatarUrl}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{snapshot.group.name}</p>
        <p className="text-xs text-muted-foreground">Convite pendente</p>
        <div className="mt-1.5 flex gap-1.5">
          <Button size="sm" className="min-h-9 flex-1" disabled={busy} onClick={onAccept}>
            Aceitar
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="min-h-9 flex-1"
            disabled={busy}
            onClick={onDecline}
          >
            Recusar
          </Button>
        </div>
      </div>
    </li>
  );
}

export function NotificationsSheet({
  open,
  onOpenChange,
  invitations,
  meId,
  anchor,
}: NotificationsSheetProps) {
  const { accept, decline, pendingGroupId } = useInvitationActions();
  const events = useAppStore(useShallow((s) => s.activity.items));
  const read = useAppStore(useShallow((s) => s.activity.read));
  const groups = useAppStore(useShallow((s) => s.groups));

  useEffect(() => {
    // One read per open boundary, and only when nothing has been loaded yet:
    // reopening a populated preview must not hit the network again.
    if (!open || read.status !== "idle") return;
    void loadActivity().catch(() => {
      // The store carries the failure; the retry control renders it.
    });
  }, [open, read.status]);

  const retry = useCallback(() => {
    void loadActivity().catch(() => {
      // Same as above: the error lives in the store.
    });
  }, []);

  // Invitations first, then the newest activity, capped at five rows total.
  const previewEvents = useMemo<GroupEvent[]>(
    () => events.slice(0, Math.max(0, PREVIEW_LIMIT - invitations.length)),
    [events, invitations.length],
  );
  const previewInvitations = invitations.slice(0, PREVIEW_LIMIT);

  const empty =
    previewInvitations.length === 0 && previewEvents.length === 0 && read.status === "ready";

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverContent anchor={anchor} side="bottom" align="end" aria-label="Notificações">
        <PopoverTitle>Notificações</PopoverTitle>

        {read.status === "loading" && previewEvents.length === 0 && (
          <div className="space-y-2" aria-hidden="true">
            <div className="h-12 animate-pulse rounded-lg bg-muted" />
            <div className="h-12 animate-pulse rounded-lg bg-muted" />
          </div>
        )}

        {/* A failed read is not an empty inbox, and must never claim to be. */}
        {read.status === "error" && previewEvents.length === 0 && (
          <div className="rounded-lg border border-dashed p-3 text-center">
            <p className="text-sm text-muted-foreground">Não conseguimos carregar a atividade.</p>
            <Button size="sm" variant="outline" className="mt-2 min-h-9" onClick={retry}>
              Tentar de novo
            </Button>
          </div>
        )}

        {empty && (
          <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma notificação</p>
        )}

        {(previewInvitations.length > 0 || previewEvents.length > 0) && (
          <ul className="flex flex-col gap-2">
            {previewInvitations.map((snapshot) => (
              <InvitationRow
                key={snapshot.group.id}
                snapshot={snapshot}
                meId={meId}
                busy={pendingGroupId === snapshot.group.id}
                onAccept={() => {
                  void accept(snapshot.group.id);
                }}
                onDecline={() => {
                  void decline(snapshot.group.id);
                }}
              />
            ))}
            {previewEvents.map((event) => {
              const nameOf = makeNameOf(event.groupId, groups, meId);
              const actorName = event.actor?.name ?? (event.actorId ? nameOf(event.actorId) : "Alguém");
              return (
                <li key={event.id}>
                  <Link
                    href={event.expenseId ? `/app/bill/${event.expenseId}` : "/app/activity"}
                    onClick={() => onOpenChange(false)}
                    className="flex items-start gap-2 rounded-lg p-2 transition-colors hover:bg-accent/40"
                  >
                    <UserAvatar
                      name={actorName}
                      avatarUrl={event.actor?.avatarUrl}
                      size="sm"
                      isBot={event.actor?.isBot}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug">
                        {describeEvent(event, {
                          actorName,
                          nameOf,
                          expenseTitle: event.expenseTitle,
                          viewerId: meId,
                        })}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {getGroupName(event.groupId, groups, meId)} · {formatRelativeDate(event.createdAt)}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex gap-2">
          <Link
            href="/app/scan-invite"
            onClick={() => onOpenChange(false)}
            className={buttonVariants({ variant: "ghost", className: "h-11 flex-1" })}
          >
            Ler convite
          </Link>
          <Link
            href="/app/activity"
            onClick={() => onOpenChange(false)}
            className={buttonVariants({ variant: "ghost", className: "h-11 flex-1" })}
          >
            Ver atividade
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
