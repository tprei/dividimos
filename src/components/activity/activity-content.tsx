"use client";

import { Clock, Loader2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useShallow } from "zustand/react/shallow";
import { EmptyState } from "@/components/shared/empty-state";
import { ActivityCardSkeleton } from "@/components/shared/skeleton";
import { SyncErrorState } from "@/components/shared/sync-error-state";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { newestActivityAt } from "@/lib/activity-badge";
import { describeEvent } from "@/lib/ledger/event-copy";
import { LedgerError, ledgerErrorMessage } from "@/lib/sync/errors";
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
  groups: Record<string, GroupSnapshot>;
  meId: string | undefined;
}

function ActivityRow({ event, groups, meId }: ActivityRowProps) {
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
    if (!event.settlementId || event.kind !== "settlement_recorded") return false;

    const fromUserId =
      typeof event.payload?.fromUserId === "string" ? event.payload.fromUserId : null;
    const toUserId =
      typeof event.payload?.toUserId === "string" ? event.payload.toUserId : null;

    if (meId !== fromUserId && meId !== toUserId) return false;

    return (
      groups[event.groupId]?.settlements.some(
        (s) => s.id === event.settlementId,
      ) ?? false
    );
  }, [event, groups, meId]);

  const handleUndo = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isUndoing || !event.settlementId) return;
    setIsUndoing(true);
    try {
      await voidSettlement(event.groupId, event.settlementId);
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
  const complete = useAppStore((s) => s.activity.complete);
  const read = useAppStore(useShallow((s) => s.activity.read));
  const groups = useAppStore(useShallow((s) => s.groups));
  const me = useAppStore((s) => s.me);

  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const load = useCallback(() => {
    void loadActivity().catch(() => {
      // The store already carries the failure; the retry control renders it.
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const newestAt = useMemo(() => newestActivityAt(groups), [groups]);
  const accountId = me?.id ?? null;

  useEffect(() => {
    // Viewed is recorded only once this account's activity read succeeded and
    // these rows rendered: a failed or pending load has not been seen.
    if (read.status !== "ready" || accountId === null || newestAt === null) return;
    useAppStore.getState().markActivityViewed(accountId, newestAt);
  }, [read.status, accountId, newestAt]);

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

  if (!hydrated || (items.length === 0 && read.status === "loading")) {
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

  // A failed first read is not an empty history.
  if (items.length === 0 && read.status === "error") {
    return (
      <div className="mx-auto max-w-lg px-4 py-4">
        <SyncErrorState
          message={ledgerErrorMessage(new LedgerError(read.code))}
          onRetry={load}
        />
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
            groups={groups}
            meId={me?.id}
          />
        ))}
      </div>

      {oldestId !== null && !complete && (
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
