"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { NotificationRow } from "./notification-row";
import { UserAvatar } from "@/components/shared/user-avatar";
import { useInvitationActions } from "@/hooks/use-invitation-actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle } from "@/components/ui/popover";
import { haptics } from "@/hooks/use-haptics";
import { displayNames } from "@/lib/people";
import { isEventUnread } from "@/lib/activity-badge";
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
    <li className="flex items-start gap-3 rounded-xl bg-muted/40 p-2">
      <UserAvatar
        id={inviter?.user.id}
        name={inviter?.user.name ?? snapshot.group.name}
        avatarUrl={inviter?.user.avatarUrl}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold" title={snapshot.group.name}>{snapshot.group.name}</p>
        <p className="text-xs text-muted-foreground">Convite pendente</p>
        <div className="mt-1.5 flex gap-1.5">
          <Button size="sm" className="min-h-11 flex-1" disabled={busy} onClick={onAccept}>
            Aceitar
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 flex-1"
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
  const readIds = useAppStore(useShallow((s) => s.activity.readIds));
  const dismissedIds = useAppStore(useShallow((s) => s.activity.dismissedIds));
  const viewedAt = useAppStore(useShallow((s) => s.activityViewedAt[meId]));
  const markEventRead = useAppStore(useShallow((s) => s.markEventRead));
  const dismissEvent = useAppStore(useShallow((s) => s.dismissEvent));

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
  // Dismissed rows leave before the cap, so the next row fills the slot.
  const previewEvents = useMemo<GroupEvent[]>(
    () =>
      events
        .filter((event) => !dismissedIds.includes(event.id))
        .slice(0, Math.max(0, PREVIEW_LIMIT - invitations.length)),
    [events, dismissedIds, invitations.length],
  );
  const previewInvitations = invitations.slice(0, PREVIEW_LIMIT);
  const actorNames = useMemo(() => displayNames(
    previewEvents.flatMap((event) => event.actor ? [event.actor] : []),
    { style: "full", viewerId: meId },
  ), [previewEvents, meId]);
  const unreadEvents = events.filter((event) =>
    !dismissedIds.includes(event.id) && isEventUnread(event, readIds, viewedAt));

  // Only the snapshots the preview names: a refresh of any other group must
  // not re-render the sheet. useShallow keeps the record stable while every
  // referenced snapshot is unchanged.
  const previewGroupIds = useMemo(
    () => Array.from(new Set(previewEvents.map((event) => event.groupId))),
    [previewEvents],
  );
  const groups = useAppStore(
    useShallow((s) => {
      const referenced: Record<string, GroupSnapshot> = {};
      for (const groupId of previewGroupIds) {
        const snapshot = s.groups[groupId];
        if (snapshot !== undefined) referenced[groupId] = snapshot;
      }
      return referenced;
    }),
  );

  const empty =
    previewInvitations.length === 0 && previewEvents.length === 0 && read.status === "ready";

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverContent anchor={anchor} side="bottom" align="end" aria-label="Notificações" className="gap-3 p-3">
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
            <Button size="sm" variant="outline" className="mt-2 min-h-11" onClick={retry}>
              Tentar de novo
            </Button>
          </div>
        )}

        {empty && (
          <p className="py-4 text-center text-sm text-muted-foreground">Nenhuma notificação</p>
        )}

        {(previewInvitations.length > 0 || previewEvents.length > 0) && (
          <ul className="flex min-h-0 flex-col divide-y divide-border overflow-y-auto overscroll-contain">
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
              const actorName = (event.actorId ? actorNames.get(event.actorId) : undefined) ?? event.actor?.name ?? (event.actorId ? nameOf(event.actorId) : "Alguém");
              return (
                <li key={event.id}>
                  <NotificationRow
                    eventId={event.id}
                    unread={isEventUnread(event, readIds, viewedAt)}
                    href={event.expenseId ? `/app/bill/${event.expenseId}` : "/app/activity"}
                    onNavigate={() => {
                      markEventRead(event.id);
                      onOpenChange(false);
                    }}
                    onMarkRead={() => markEventRead(event.id)}
                    onDismiss={() => dismissEvent(event.id)}
                  >
                    <UserAvatar
                      id={event.actorId ?? undefined}
                      name={event.actor?.name ?? actorName}
                      avatarUrl={event.actor?.avatarUrl}
                      size="sm"
                      isBot={event.actor?.isBot}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-1 text-sm leading-snug">
                        {describeEvent(event, {
                          actorName,
                          nameOf,
                          expenseTitle: event.expenseTitle,
                          viewerId: meId,
                        })}
                      </p>
                      <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="truncate" title={getGroupName(event.groupId, groups, meId)}>{getGroupName(event.groupId, groups, meId)}</span>
                        <time className="shrink-0" dateTime={event.createdAt}>{formatRelativeDate(event.createdAt)}</time>
                      </p>
                    </div>
                  </NotificationRow>
                </li>
              );
            })}
          </ul>
        )}

        {unreadEvents.length > 0 && (
          <Button
            variant="ghost"
            className="min-h-11 shrink-0 text-primary-text"
            onClick={() => {
              unreadEvents.forEach((event) => markEventRead(event.id));
              haptics.success();
            }}
          >
            Marcar todas como lidas
          </Button>
        )}
        <div className="flex shrink-0 gap-2 border-t border-border pt-2">
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
