"use client";

import { Clock, Loader2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useShallow } from "zustand/react/shallow";
import { EmptyState } from "@/components/shared/empty-state";
import { ActivityCardSkeleton } from "@/components/shared/skeleton";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { markActivityViewed } from "@/lib/activity-badge";
import { describeEvent } from "@/lib/ledger/event-copy";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { voidSettlement } from "@/lib/sync/mutations";
import { loadActivity } from "@/lib/sync/refresh";
import { useAppStore } from "@/stores/app-store";
import type { GroupEvent, GroupSnapshot } from "@/types/ledger";

function formatRelativeDate(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin}min`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

function getGroupName(
  groupId: string,
  groups: Record<string, GroupSnapshot>,
  meId: string | undefined,
): string {
  const snapshot = groups[groupId];
  if (!snapshot) return "Grupo";
  if (snapshot.group.kind === "dm") {
    const counterparty = snapshot.members.find((m) => m.user.id !== meId);
    return counterparty?.user.name ?? snapshot.group.name;
  }
  return snapshot.group.name;
}

function makeNameOf(
  groupId: string,
  groups: Record<string, GroupSnapshot>,
  meId: string | undefined,
): (userId: string) => string {
  return (userId: string) => {
    if (userId && userId === meId) return "você";
    const currentGroup = groups[groupId];
    if (currentGroup) {
      const member = currentGroup.members.find((m) => m.user.id === userId);
      if (member) return member.user.name;
      const guest = currentGroup.guests.find((g) => g.id === userId);
      if (guest) return guest.displayName;
    }
    for (const group of Object.values(groups)) {
      const member = group.members.find((m) => m.user.id === userId);
      if (member) return member.user.name;
      const guest = group.guests.find((g) => g.id === userId);
      if (guest) return guest.displayName;
    }
    return "alguém";
  };
}

interface ActivityRowProps {
  event: GroupEvent;
  items: GroupEvent[];
  groups: Record<string, GroupSnapshot>;
  meId: string | undefined;
}

function ActivityRow({ event, items, groups, meId }: ActivityRowProps) {
  const [isUndoing, setIsUndoing] = useState(false);

  const nameOf = useMemo(
    () => makeNameOf(event.groupId, groups, meId),
    [event.groupId, groups, meId],
  );

  const actorName = event.actor?.name ?? (event.actorId ? nameOf(event.actorId) : "Alguém");
  const sentence = describeEvent(event, {
    actorName,
    nameOf,
    expenseTitle: event.expenseTitle,
    viewerId: meId ?? "",
  });
  const groupLabel = getGroupName(event.groupId, groups, meId);
  const relativeTime = formatRelativeDate(event.createdAt);

  const canUndo = useMemo(() => {
    if (!event.settlementId) return false;
    if (event.kind !== "settlement_confirmed") return false;

    const fromUserId =
      (typeof event.payload?.fromUserId === "string"
        ? event.payload.fromUserId
        : null) ?? event.subjectUserId;
    const toUserId =
      (typeof event.payload?.toUserId === "string"
        ? event.payload.toUserId
        : null) ?? event.actorId;
    const isParty =
      Boolean(meId) &&
      (meId === fromUserId ||
        meId === toUserId ||
        meId === event.actorId ||
        meId === event.subjectUserId);

    if (!isParty) return false;

    const latestForSettlement = items.find(
      (i) => i.settlementId === event.settlementId,
    );
    return latestForSettlement?.kind === "settlement_confirmed";
  }, [event, items, meId]);

  const handleUndo = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isUndoing || !event.settlementId) return;
    setIsUndoing(true);
    try {
      await voidSettlement(event.groupId, event.settlementId, true);
      toast.success("Pagamento desfeito");
    } catch (err) {
      toast.error(ledgerErrorMessage(err));
    } finally {
      setIsUndoing(false);
    }
  };

  const cardContent = (
    <div className="flex items-start gap-3">
      <UserAvatar
        name={actorName}
        avatarUrl={event.actor?.avatarUrl}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">{sentence}</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {groupLabel}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {relativeTime}
            </span>
          </div>
          {canUndo && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
              onClick={handleUndo}
              disabled={isUndoing}
            >
              {isUndoing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <>
                  <Undo2 className="mr-1 h-3 w-3" />
                  Desfazer
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  if (event.expenseId) {
    return (
      <Link
        href={`/app/bill/${event.expenseId}`}
        className="block rounded-xl border bg-card p-3 transition-colors hover:bg-accent/40"
      >
        {cardContent}
      </Link>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-3">
      {cardContent}
    </div>
  );
}

export function ActivityContent() {
  const hydrated = useAppStore((s) => s.hydrated);
  const items = useAppStore(useShallow((s) => s.activity.items));
  const oldestId = useAppStore((s) => s.activity.oldestId);
  const groups = useAppStore(useShallow((s) => s.groups));
  const me = useAppStore((s) => s.me);

  const [isLoadingMore, setIsLoadingMore] = useState(false);

  useEffect(() => {
    markActivityViewed();
    void loadActivity().catch(() => {});
  }, []);

  const handleLoadMore = useCallback(async () => {
    if (oldestId === null || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      await loadActivity(oldestId);
    } catch (err) {
      toast.error(ledgerErrorMessage(err));
    } finally {
      setIsLoadingMore(false);
    }
  }, [oldestId, isLoadingMore]);

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-4 py-4">
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <ActivityCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-4">
        <EmptyState
          icon={Clock}
          title="Nenhuma atividade ainda"
          description="As atividades dos seus grupos aparecerão aqui."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-4">
      <div className="space-y-2.5">
        {items.map((event) => (
          <ActivityRow
            key={event.id}
            event={event}
            items={items}
            groups={groups}
            meId={me?.id}
          />
        ))}
      </div>

      {oldestId !== null && (
        <div className="pt-2 text-center">
          <Button
            variant="outline"
            size="sm"
            onClick={handleLoadMore}
            disabled={isLoadingMore}
            className="w-full"
          >
            {isLoadingMore ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Carregando...
              </>
            ) : (
              "Carregar mais"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
