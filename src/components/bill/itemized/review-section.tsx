"use client";

import { AlertTriangle } from "lucide-react";
import { BillSummary } from "@/components/bill/bill-summary";
import { GuestAvatar, GuestBadge } from "@/components/shared/guest-avatar";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/shared/section-heading";
import { formatBRL } from "@/lib/currency";
import type { ExpenseSplit, Guest } from "@/stores/bill-store";
import type { Expense, ExpenseItem, ExpensePayer, User } from "@/types";

export interface ReviewIssue {
  id: string;
  message: string;
  onResolve: () => void;
}

export interface ReviewParticipantTotal {
  id: string;
  name: string;
  avatarUrl: string | null;
  isGuest: boolean;
  cents: number;
}

export interface ReviewSectionProps {
  expense: Expense | null;
  items: ExpenseItem[];
  splits: ExpenseSplit[];
  participants: User[];
  guests: Guest[];
  payers: ExpensePayer[];
  totals: ReviewParticipantTotal[];
  partial: boolean;
  remainingCents: number;
  issues: ReviewIssue[];
}

export function ReviewSection({
  expense,
  items,
  splits,
  participants,
  guests,
  payers,
  totals,
  partial,
  remainingCents,
  issues,
}: ReviewSectionProps) {
  if (!expense) return null;
  const participantById = new Map(
    participants.map((participant) => [participant.id, participant.name]),
  );

  return (
    <div className="space-y-4 px-4 py-3">
      {issues.length > 0 && (
        <div className="space-y-2" aria-label="Pendências">
          {issues.map((issue) => (
            <div
              key={issue.id}
              className="flex min-h-14 items-center gap-2 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-2"
            >
              <AlertTriangle className="size-4 shrink-0 text-warning" />
              <span className="min-w-0 flex-1 text-sm">{issue.message}</span>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 shrink-0 px-2 text-xs font-bold text-primary"
                onClick={issue.onResolve}
              >
                Resolver
              </Button>
            </div>
          ))}
        </div>
      )}

      <SectionHeading title="Itens" />
      <div className="divide-y divide-border rounded-2xl border bg-card">
        {items.map((item) => (
          <div key={item.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
              {item.description || "Item sem nome"}
            </span>
            <Money cents={item.totalPriceCents} className="shrink-0 text-sm" />
          </div>
        ))}
      </div>

      <BillSummary
        expense={expense}
        items={items}
        itemSplits={splits}
        participants={participants}
        guests={guests}
      />

      <SectionHeading title="Por pessoa" trailing={partial ? "Parcial" : undefined} />
      <div className="divide-y divide-border rounded-2xl border bg-card">
        {totals.map((total) => (
          <div key={total.id} className="flex min-h-12 items-center gap-3 px-4 py-2">
            {total.isGuest ? (
              <GuestAvatar size="sm" />
            ) : (
              <UserAvatar name={total.name} avatarUrl={total.avatarUrl} size="sm" />
            )}
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {total.name}
              {total.isGuest && <GuestBadge />}
            </span>
            <Money cents={total.cents} className="text-sm" />
          </div>
        ))}
      </div>
      {partial && remainingCents > 0 && (
        <p className="px-1 text-xs font-semibold text-muted-foreground">
          A distribuir: {formatBRL(remainingCents)}.
        </p>
      )}

      <SectionHeading title="Pagamento" />
      <div className="divide-y divide-border rounded-2xl border bg-card">
        {payers.length > 0 ? (
          payers.map((payer) => (
            <div key={payer.userId} className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
              <span className="min-w-0 truncate text-sm font-semibold">
                {participantById.get(payer.userId) ?? "Participante"}
              </span>
              <Money cents={payer.amountCents} className="shrink-0 text-sm" />
            </div>
          ))
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">Nenhum pagamento informado.</p>
        )}
      </div>
    </div>
  );
}
