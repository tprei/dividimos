"use client";

import { useMemo } from "react";
import { GuestAvatar, GuestBadge } from "@/components/shared/guest-avatar";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import type { GroupSpending, GroupSpendingRow } from "@/types/ledger";

const ptBrCollator = new Intl.Collator("pt-BR", { sensitivity: "base" });

export function GroupSpendingSection({
  spending,
  meId,
}: {
  spending: GroupSpending | null | undefined;
  meId: string;
}) {
  const rows = useMemo(
    () =>
      spending
        ? [...spending.participants].sort((a, b) => {
            const aName = a.kind === "user" ? a.user.name : a.displayName;
            const bName = b.kind === "user" ? b.user.name : b.displayName;
            return (
              b.shareCents - a.shareCents ||
              ptBrCollator.compare(aName, bName) ||
              (a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0)
            );
          })
        : [],
    [spending],
  );

  if (spending === null) return null;

  if (spending === undefined) {
    return (
      <section
        aria-label="Gastos do grupo"
        className="rounded-2xl border bg-card p-4"
        data-testid="group-spending-loading"
      >
        <p className="text-sm font-semibold">Gastos do grupo</p>
        <p className="mt-1 text-xs text-muted-foreground">Carregando o total e a divisão por pessoa…</p>
      </section>
    );
  }

  return (
    <section aria-label="Gastos do grupo" className="rounded-2xl border bg-card p-4" data-testid="group-spending">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Gastos do grupo</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Inclui as despesas ativas e as taxas. Acertos não entram nesse total.
          </p>
        </div>
        <Money cents={spending.totalCents} className="shrink-0 text-base" label="Total gasto no grupo" />
      </div>

      <div className="mt-4 divide-y divide-border">
        {rows.map((row: GroupSpendingRow) => {
          const name = row.kind === "user" ? row.user.name : row.displayName;
          const displayName = row.kind === "user" && row.participantId === meId ? "Você" : name;
          return (
            <div
              key={`${row.kind}:${row.participantId}`}
              className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
              data-testid={`group-spending-row-${row.participantId}`}
            >
              {row.kind === "user" ? (
                <UserAvatar
                  name={name}
                  avatarUrl={row.user.avatarUrl}
                  isBot={row.user.isBot}
                  size="sm"
                />
              ) : (
                <GuestAvatar size="sm" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <p className="truncate text-sm font-medium">{displayName}</p>
                  {row.kind === "guest" && <GuestBadge />}
                </div>
                {row.kind === "user" && row.participantId === meId && (
                  <p className="text-[11px] text-muted-foreground">Sua parte</p>
                )}
              </div>
              <Money cents={row.shareCents} className="text-sm" label={`${displayName}: gasto compartilhado`} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
