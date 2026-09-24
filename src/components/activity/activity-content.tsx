"use client";

import { Clock, Loader2, Undo2 } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useShallow } from "zustand/react/shallow";
import { EmptyState } from "@/components/shared/empty-state";
import { ActivityCardSkeleton } from "@/components/shared/skeleton";
import { SyncErrorState } from "@/components/shared/sync-error-state";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { SettlementDetailPopover } from "@/components/settlement/settlement-detail-popover";
import { VoidSettlementDialog } from "@/components/settlement/void-settlement-dialog";
import { useConfirmationPreferences } from "@/hooks/use-confirmation-preferences";
import { haptics } from "@/hooks/use-haptics";
import { newestActivityAt } from "@/lib/activity-badge";
import { formatRelativeDate } from "@/lib/datetime";
import { popIn, staggerContainer, tapScale } from "@/lib/animations";
import { displayNames } from "@/lib/people";
import { describeEvent } from "@/lib/ledger/event-copy";
import { getGroupName, makeNameOf } from "@/lib/ledger/group-names";
import { LedgerError, ledgerErrorMessage } from "@/lib/sync/errors";
import { voidSettlement } from "@/lib/sync/mutations";
import { loadActivity } from "@/lib/sync/refresh";
import { useAppStore } from "@/stores/app-store";
import type { GroupEvent, GroupSnapshot } from "@/types/ledger";


interface ActivityRowProps {
  event: GroupEvent;
  groups: Record<string, GroupSnapshot>;
  meId: string | undefined;
  actorLabel?: string;
}

function ActivityRow({ event, groups, meId, actorLabel }: ActivityRowProps) {
  const [isUndoing, setIsUndoing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [settlementAnchor, setSettlementAnchor] = useState<HTMLElement | null>(null);
  const [preferences, updatePreferences] = useConfirmationPreferences(meId ?? "");

  const nameOf = useMemo(
    () => makeNameOf(event.groupId, groups, meId),
    [event.groupId, groups, meId],
  );

  const actorName = actorLabel ?? event.actor?.name ?? (event.actorId ? nameOf(event.actorId) : "Alguém");
  const sentence = describeEvent(event, {
    actorName,
    nameOf,
    expenseTitle: event.expenseTitle,
    viewerId: meId ?? "",
  });
  const groupLabel = getGroupName(event.groupId, groups, meId);
  const relativeTime = formatRelativeDate(event.createdAt);

  const fromUserId =
    typeof event.payload?.fromUserId === "string" ? event.payload.fromUserId : null;
  const toUserId =
    typeof event.payload?.toUserId === "string" ? event.payload.toUserId : null;
  const amountCents =
    typeof event.payload?.amountCents === "number" ? event.payload.amountCents : 0;

  const canUndo = useMemo(() => {
    if (!event.settlementId || event.kind !== "settlement_recorded") return false;
    if (meId !== fromUserId && meId !== toUserId) return false;

    return (
      groups[event.groupId]?.settlements.some(
        (s) => s.id === event.settlementId,
      ) ?? false
    );
  }, [event.groupId, event.kind, event.settlementId, fromUserId, groups, meId, toUserId]);

  const handleConfirmUndo = async () => {
    if (isUndoing || !event.settlementId) return;
    setIsUndoing(true);
    try {
      await voidSettlement(event.groupId, event.settlementId);
      toast.success("Pagamento desfeito");
      haptics.success();
      setConfirmOpen(false);
    } catch (err) {
      toast.error(ledgerErrorMessage(err));
      haptics.error();
    } finally {
      setIsUndoing(false);
    }
  };

  const cardContent = (
    <div className="flex items-center gap-3">
      <UserAvatar
        id={event.actorId ?? undefined}
        name={event.actor?.name ?? actorName}
        avatarUrl={event.actor?.avatarUrl}
        size="sm"
        isBot={event.actor?.isBot}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm leading-5" title={sentence}>{sentence}</p>
        <div className="flex h-6 items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={groupLabel}>
            <span>{groupLabel}</span>
            <span aria-hidden="true"> · </span>
            <time dateTime={event.createdAt}>{relativeTime}</time>
          </p>
          {event.settlementId !== null && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setSettlementAnchor(e.currentTarget);
                haptics.tap();
                setDetailOpen(true);
              }}
              data-testid="activity-view-settlement"
            >
              Ver pagamento
            </Button>
          )}
          {canUndo && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-1.5 text-xs text-muted-foreground hover:text-destructive-text"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setSettlementAnchor(e.currentTarget);
                if (preferences.confirmVoidSettlement) setConfirmOpen(true);
                else void handleConfirmUndo();
              }}
              disabled={isUndoing}
              data-testid="activity-undo-settlement"
            >
              {isUndoing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <>
                  <Undo2 className="h-3 w-3" />
                  Desfazer
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  const sheet =
    event.settlementId !== null ? (
      <SettlementDetailPopover
        settlementId={event.settlementId}
        groupId={event.groupId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        anchor={settlementAnchor}
        busy={isUndoing}
        onUndo={canUndo ? () => {
          setDetailOpen(false);
          if (preferences.confirmVoidSettlement) setConfirmOpen(true);
          else void handleConfirmUndo();
        } : undefined}
      />
    ) : null;

  const dialog = canUndo ? (
    <VoidSettlementDialog
      open={confirmOpen && canUndo}
      anchor={settlementAnchor}
      amountCents={amountCents}
      payerName={fromUserId ? nameOf(fromUserId) : "Alguém"}
      recipientName={toUserId ? nameOf(toUserId) : "Alguém"}
      busy={isUndoing}
      onCancel={() => setConfirmOpen(false)}
      onConfirm={() => {
        void handleConfirmUndo();
      }}
      onSkipFutureConfirmations={() => updatePreferences({ confirmVoidSettlement: false })}
    />
  ) : null;

  const href = event.expenseId ? `/app/bill/${event.expenseId}` : `/app/groups/${event.groupId}`;

  return (
    <div className="relative rounded-xl px-3 py-2 transition-colors hover:bg-accent/40 focus-within:bg-accent/40">
      <Link
        href={href}
        aria-label={sentence}
        onClick={(e) => {
          haptics.tap();
          if (event.settlementId) {
            e.preventDefault();
            setSettlementAnchor(e.currentTarget);
            setDetailOpen(true);
          }
        }}
        className="absolute inset-0 rounded-xl focus-visible:outline-2 focus-visible:outline-ring"
      />
      <div className="pointer-events-none relative [&_button]:pointer-events-auto">
        {cardContent}
      </div>
      {dialog}
      {sheet}
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
  const reducedMotion = useReducedMotion();
  const actorNames = useMemo(() => displayNames(
    items.flatMap((event) => event.actor ? [event.actor] : []),
    { style: "short", viewerId: me?.id },
  ), [items, me?.id]);
  const days = useMemo(() => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const sections = new Map<string, { label: string; events: GroupEvent[] }>();
    for (const event of items) {
      const date = new Date(event.createdAt);
      const key = date.toDateString();
      const label = key === today.toDateString() ? "Hoje"
        : key === yesterday.toDateString() ? "Ontem"
        : date.toLocaleDateString("pt-BR", { day: "numeric", month: "long", ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } as const : {}) });
      const section = sections.get(key);
      if (section) section.events.push(event);
      else sections.set(key, { label, events: [event] });
    }
    return Array.from(sections.values());
  }, [items]);

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

  if (
    !hydrated ||
    (items.length === 0 && (read.status === "idle" || read.status === "loading"))
  ) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-4 py-6 md:max-w-2xl">
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
      <div className="mx-auto max-w-lg px-4 py-6 md:max-w-2xl">
        <SyncErrorState
          message={ledgerErrorMessage(new LedgerError(read.code))}
          onRetry={load}
        />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-6 md:max-w-2xl">
        <EmptyState
          icon={Clock}
          title="Nenhuma atividade ainda"
          description="As atividades dos seus grupos aparecerão aqui."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6 md:max-w-2xl">
      {days.map((day, dayIndex) => (
        <section key={day.label} aria-label={day.label}>
          <h2 className="mb-2 px-3 text-sm font-semibold text-muted-foreground">{day.label}</h2>
          <motion.ul variants={staggerContainer} initial={reducedMotion ? false : "hidden"} animate="visible" className="divide-y divide-border">
            {day.events.map((event, eventIndex) => (
              <motion.li
                key={event.id}
                variants={!reducedMotion && dayIndex === 0 && eventIndex < 6 ? popIn : undefined}
                whileTap={reducedMotion ? undefined : { scale: tapScale.card }}
              >
                <ActivityRow event={event} groups={groups} meId={me?.id} actorLabel={event.actorId ? actorNames.get(event.actorId) : undefined} />
              </motion.li>
            ))}
          </motion.ul>
        </section>
      ))}

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
