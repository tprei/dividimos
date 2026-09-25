"use client";

import Link from "next/link";
import { ArrowRight, ReceiptText } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { formatChatTime } from "@/components/chat/chat-rail-row";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/shared/money";
import { describeEvent } from "@/lib/ledger/event-copy";
import { voidSettlement } from "@/lib/sync/mutations";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { cn } from "@/lib/utils";
import { SettlementDetailPopover } from "@/components/settlement/settlement-detail-popover";
import { VoidSettlementDialog } from "@/components/settlement/void-settlement-dialog";
import { useConfirmationPreferences } from "@/hooks/use-confirmation-preferences";
import type { GroupEvent, Settlement, SettlementStatus } from "@/types/ledger";

const EXPENSE_VERBS: Record<string, string> = {
  expense_created: "adicionou",
  expense_deleted: "apagou",
  expense_restored: "restaurou",
};

const EXPENSE_KINDS: Record<string, true> = {
  expense_created: true,
  expense_edited: true,
  expense_deleted: true,
  expense_restored: true,
};

const SETTLEMENT_KINDS: Record<string, true> = {
  settlement_recorded: true,
  settlement_voided: true,
};

const STATUS_CONFIG: Record<SettlementStatus, { label: string; className: string }> = {
  confirmed: { label: "Confirmado", className: "text-success-text" },
  voided: { label: "Desfeito", className: "text-muted-foreground" },
};

function CardTime({ at }: { at: string }) {
  return (
    <time dateTime={at} className="shrink-0 text-2xs leading-4 tabular-nums text-muted-foreground">
      {formatChatTime(at)}
    </time>
  );
}

function payloadNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function payloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function eventTotalCents(event: GroupEvent): number | null {
  if (event.kind === "expense_created") {
    return payloadNumber(event.payload, "totalCents");
  }
  if (event.kind === "expense_edited") {
    const change = event.payload.totalCents;
    return Array.isArray(change) && typeof change[1] === "number" ? change[1] : null;
  }
  return null;
}

function eventTitle(event: GroupEvent): string {
  if (event.kind === "expense_edited") {
    const change = event.payload.title;
    if (Array.isArray(change) && typeof change[1] === "string" && change[1].length > 0) {
      return change[1];
    }
  }
  const fromPayload = payloadString(event.payload, "title");
  if (fromPayload) return fromPayload;
  return event.expenseTitle ?? "Conta";
}

interface EventCardProps {
  event: GroupEvent;
  groupId: string;
  meId: string;
  settlement: Settlement | null;
  latestStatus: SettlementStatus | null;
  nameOf: (userId: string) => string;
}

export function EventCard({ event, groupId, meId, settlement, latestStatus, nameOf }: EventCardProps) {
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [preferences, updatePreferences] = useConfirmationPreferences(meId);
  const actorName = event.actor?.name ?? (event.actorId ? nameOf(event.actorId) : "");
  const copy = describeEvent(event, {
    actorName,
    nameOf,
    expenseTitle: event.expenseTitle,
    viewerId: meId,
  });

  if (!(event.kind in EXPENSE_KINDS) && !(event.kind in SETTLEMENT_KINDS)) {
    return (
      <div className="flex min-h-6 max-w-80 items-baseline gap-2 pr-3">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground" data-testid="event-sentence">
          {copy}
        </p>
        <CardTime at={event.createdAt} />
      </div>
    );
  }

  if (event.kind in EXPENSE_KINDS) {
    const totalCents = eventTotalCents(event);
    const deleted = event.kind === "expense_deleted";
    const verb = EXPENSE_VERBS[event.kind];
    const meta = verb && actorName ? `${actorName} ${verb}` : copy;
    const title = eventTitle(event);
    const card = (
      <div
        className={cn(
          "max-w-80 rounded-[0.75rem] border border-dashed border-border bg-card px-3 py-2 transition-colors",
          !deleted && "hover:bg-muted/40",
        )}
        data-testid="event-expense-card"
      >
        <div className="flex items-center gap-2">
          <ReceiptText aria-hidden="true" className="size-4 shrink-0 text-primary-text" />
          <p
            title={title}
            className={cn(
              "min-w-0 flex-1 truncate text-sm font-semibold",
              deleted && "text-muted-foreground line-through",
            )}
          >
            {title}
          </p>
          {totalCents !== null && <Money cents={totalCents} size="sm" />}
        </div>
        <div className="mt-0.5 flex items-baseline gap-2 pl-6">
          <p title={meta} className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {meta}
          </p>
          <CardTime at={event.createdAt} />
        </div>
      </div>
    );

    return event.expenseId && !deleted ? (
      <Link
        href={`/app/bill/${event.expenseId}`}
        className="block max-w-80 rounded-[0.75rem] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {card}
      </Link>
    ) : (
      card
    );
  }

  const status: SettlementStatus =
    settlement?.status ??
    latestStatus ??
    (event.kind === "settlement_voided" ? "voided" : "confirmed");
  const cfg = STATUS_CONFIG[status];
  const settlementId = settlement?.id ?? event.settlementId ?? null;
  const toUserId =
    settlement?.toUserId ??
    payloadString(event.payload, "toUserId") ??
    event.subjectUserId ??
    null;
  const fromUserId =
    settlement?.fromUserId ?? payloadString(event.payload, "fromUserId") ?? event.actorId ?? null;
  const amountCents =
    settlement?.amountCents ?? payloadNumber(event.payload, "amountCents") ?? 0;

  const isParty = toUserId === meId || fromUserId === meId;
  const canUndo = settlementId !== null && status === "confirmed" && isParty;


  const handleVoid = async () => {
    if (!settlementId || busy) return;
    setBusy(true);
    try {
      await voidSettlement(groupId, settlementId);
      toast.success("Pagamento desfeito");
      setConfirmOpen(false);
    } catch (error) {
      toast.error(ledgerErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative max-w-80">
      <div
        className="rounded-[0.75rem] border border-success/30 bg-success/5 px-3 py-2"
        data-testid="event-settlement-card"
      >
        <div className="flex items-center gap-2">
          <p className="flex min-w-0 flex-1 items-center gap-1 text-sm font-semibold">
            {fromUserId && toUserId ? (
              <>
                <span className="truncate">{nameOf(fromUserId)}</span>
                <ArrowRight aria-label="para" className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{nameOf(toUserId)}</span>
              </>
            ) : (
              <span className="truncate">{copy}</span>
            )}
          </p>
          <Money
            cents={amountCents}
            size="sm"
            className={cn(status === "voided" && "text-muted-foreground line-through")}
          />
        </div>
        <div className="mt-0.5 flex items-center gap-1">
          <span className={cn("text-xs font-semibold", cfg.className)}>{cfg.label}</span>
          {canUndo && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={() => {
                if (preferences.confirmVoidSettlement) setConfirmOpen(true);
                else void handleVoid();
              }}
              disabled={busy}
              data-testid="event-undo-settlement"
            >
              Desfazer
            </Button>
          )}
          {settlementId !== null && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={() => setDetailOpen(true)}
              data-testid="event-view-settlement"
            >
              Detalhes
            </Button>
          )}
          <span className="ml-auto">
            <CardTime at={event.createdAt} />
          </span>
        </div>
      </div>
      {canUndo && (
        <VoidSettlementDialog
          open={confirmOpen && canUndo}
          amountCents={amountCents}
          payerName={fromUserId ? nameOf(fromUserId) : "Alguém"}
          recipientName={toUserId ? nameOf(toUserId) : "Alguém"}
          busy={busy}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            void handleVoid();
          }}
          onSkipFutureConfirmations={() => updatePreferences({ confirmVoidSettlement: false })}
        />
      )}
      {settlementId !== null && (
        <SettlementDetailPopover
          settlementId={settlementId}
          groupId={groupId}
          open={detailOpen}
          onOpenChange={setDetailOpen}
        />
      )}
    </div>
  );
}
