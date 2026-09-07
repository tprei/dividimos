"use client";

import Link from "next/link";
import { ArrowRight, Receipt, Undo2 } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";
import { describeEvent } from "@/lib/ledger/event-copy";
import { voidSettlement } from "@/lib/sync/mutations";
import { ledgerErrorMessage } from "@/lib/sync/errors";
import { cn } from "@/lib/utils";
import type { GroupEvent, Settlement, SettlementStatus } from "@/types/ledger";

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
  confirmed: { label: "Confirmado", className: "bg-success/15 text-success" },
  voided: { label: "Desfeito", className: "bg-muted text-muted-foreground" },
};

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
  const actorName = event.actor?.name ?? (event.actorId ? nameOf(event.actorId) : "");
  const copy = describeEvent(event, {
    actorName,
    nameOf,
    expenseTitle: event.expenseTitle,
    viewerId: meId,
  });

  if (!(event.kind in EXPENSE_KINDS) && !(event.kind in SETTLEMENT_KINDS)) {
    return (
      <div className="py-1 text-center">
        <p className="text-[11px] text-muted-foreground" data-testid="event-sentence">
          {copy}
        </p>
      </div>
    );
  }

  if (event.kind in EXPENSE_KINDS) {
    const totalCents = eventTotalCents(event);
    const deleted = event.kind === "expense_deleted";
    const card = (
      <div
        className={cn(
          "rounded-2xl border bg-card p-3 transition-colors",
          !deleted && "hover:bg-muted/30",
        )}
        data-testid="event-expense-card"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted">
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{eventTitle(event)}</p>
            <p className="text-xs text-muted-foreground">
              {new Date(event.createdAt).toLocaleDateString("pt-BR")}
            </p>
          </div>
          {totalCents !== null && (
            <span className="text-sm font-semibold tabular-nums">{formatBRL(totalCents)}</span>
          )}
        </div>
      </div>
    );

    return (
      <div className="mx-auto w-full max-w-xs py-1">
        <p className="mb-1 text-center text-[11px] text-muted-foreground">{copy}</p>
        {event.expenseId && !deleted ? (
          <Link href={`/app/bill/${event.expenseId}`}>{card}</Link>
        ) : (
          card
        )}
      </div>
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
    } catch (error) {
      toast.error(ledgerErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-xs py-1">
      <p className="mb-1 text-center text-[11px] text-muted-foreground">{copy}</p>
      <div className="rounded-2xl border bg-card p-3" data-testid="event-settlement-card">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            {fromUserId && toUserId && (
              <p className="flex items-center gap-1 truncate text-sm font-medium">
                {nameOf(fromUserId)}
                <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                {nameOf(toUserId)}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {new Date(event.createdAt).toLocaleDateString("pt-BR")}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-sm font-semibold tabular-nums">{formatBRL(amountCents)}</span>
            <span
              className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", cfg.className)}
            >
              {cfg.label}
            </span>
          </div>
        </div>
        {canUndo && (
          <div className="mt-2.5 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 flex-1 gap-1.5 text-xs"
              onClick={() => void handleVoid()}
              disabled={busy}
              data-testid="event-undo-settlement"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Desfazer
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
