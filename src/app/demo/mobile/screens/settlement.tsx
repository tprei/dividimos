"use client";

import { ArrowRight, ChevronRight, RefreshCw } from "lucide-react";
import { useState } from "react";
import { DebtGraph } from "@/components/settlement/debt-graph";
import { PixQrModal } from "@/components/settlement/pix-qr-modal";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";
import type { DebtEdge } from "@/lib/simplify";
import { cn } from "@/lib/utils";
import {
  BALANCES,
  firstName,
  ME,
  ORIGINAL_TRANSFERS,
  personById,
  PIX_KEYS,
  SETTLEMENT_PARTICIPANTS,
  TRANSFERS,
} from "../fixtures";
import type { ScreenProps } from "../mobile-preview";
import { PreviewShell } from "../preview-shell";
import { Money } from "../ui/money";
import { ScreenHeader } from "../ui/screen-header";
import { SectionHeading } from "../ui/section-heading";

type Balance = (typeof BALANCES)[number];
type BalanceSide = "debt" | "credit";

function signedAmountLabel(cents: number): string {
  let prefix = "";
  if (cents < 0) prefix = "−";
  if (cents > 0) prefix = "+";
  return `${prefix}${formatBRL(Math.abs(cents))}`;
}

function shortAmountLabel(cents: number): string {
  return formatBRL(Math.abs(cents)).slice(3);
}

function segmentCenters(balances: Balance[], total: number): number[] {
  const centers: number[] = [];
  let cumulative = 0;
  for (const balance of balances) {
    const width = Math.abs(balance.netCents);
    centers.push(((cumulative + width / 2) / total) * 100);
    cumulative += width;
  }
  return centers;
}

function ConsolidatedSide({
  balances,
  totalCents,
  side,
}: {
  balances: Balance[];
  totalCents: number;
  side: BalanceSide;
}) {
  const total = Math.abs(totalCents);
  const isDebt = side === "debt";
  const accentClass = isDebt ? "bg-destructive/75" : "bg-success/75";
  const edgeClass = isDebt ? "rounded-l-full" : "rounded-r-full";
  const balanceKind = isDebt ? "Dívida" : "Crédito";
  const toneClass = isDebt ? "text-destructive" : "text-success";
  const gridTemplateColumns = balances.map((balance) => `${Math.abs(balance.netCents)}fr`).join(" ");
  const centers = segmentCenters(balances, total);

  return (
    <div className="min-w-0 flex-1" role="group" aria-label={isDebt ? "Dívidas" : "Créditos"}>
      <div className="relative h-6" aria-hidden="true">
        {balances.map((balance, index) => (
          <span
            key={balance.userId}
            className="absolute top-0 -translate-x-1/2"
            style={{ left: `clamp(14px, ${centers[index]}%, calc(100% - 14px))` }}
          >
            <UserAvatar
              name={personById(balance.userId).name}
              size="xs"
              className={isDebt ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"}
            />
          </span>
        ))}
      </div>
      <div
        className={cn("grid h-2 gap-px overflow-hidden", edgeClass)}
        style={{ gridTemplateColumns }}
      >
        {balances.map((balance) => {
          const profile = personById(balance.userId);
          return (
            <div
              key={balance.userId}
              role="img"
              aria-label={`${balanceKind} de ${firstName(profile)}: ${signedAmountLabel(balance.netCents)}`}
              className={accentClass}
            />
          );
        })}
      </div>
      <div className="relative h-4" aria-hidden="true">
        {balances.map((balance, index) => (
          <span
            key={balance.userId}
            className={cn(
              "absolute top-0 -translate-x-1/2 font-mono text-[10px] font-medium tabular-nums",
              toneClass,
            )}
            style={{ left: `clamp(22px, ${centers[index]}%, calc(100% - 22px))` }}
          >
            {shortAmountLabel(balance.netCents)}
          </span>
        ))}
      </div>
    </div>
  );
}

function ConsolidatedBalanceCard() {
  const debtBalances = BALANCES.filter((balance) => balance.netCents < 0)
    .sort((a, b) => Math.abs(b.netCents) - Math.abs(a.netCents));
  const creditBalances = BALANCES.filter((balance) => balance.netCents > 0)
    .sort((a, b) => Math.abs(a.netCents) - Math.abs(b.netCents));
  const debtTotal = debtBalances.reduce((total, balance) => total + balance.netCents, 0);
  const creditTotal = creditBalances.reduce((total, balance) => total + balance.netCents, 0);

  return (
    <section className="rounded-2xl border bg-card px-4 py-3" aria-label="Saldo consolidado">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold">
          Saldo consolidado
        </p>
        <span className="font-mono text-xs text-muted-foreground">
          {ORIGINAL_TRANSFERS.length} dívidas → {TRANSFERS.length} Pix
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span role="img" aria-label={`Dívida total: ${signedAmountLabel(debtTotal)}`}>
          <Money signed cents={debtTotal} className="text-lg font-semibold text-destructive" />
        </span>
        <span role="img" aria-label={`Crédito total: ${signedAmountLabel(creditTotal)}`}>
          <Money signed cents={creditTotal} className="text-lg font-semibold text-success" />
        </span>
      </div>
      <div className="mt-3 flex items-stretch">
        <ConsolidatedSide balances={debtBalances} totalCents={debtTotal} side="debt" />
        <div className="mx-2 w-px self-stretch bg-border" aria-hidden="true" />
        <ConsolidatedSide balances={creditBalances} totalCents={creditTotal} side="credit" />
      </div>
    </section>
  );
}

function TransferRow({
  edge,
  onPay,
}: {
  edge: DebtEdge;
  onPay: (edge: DebtEdge) => void;
}) {
  const from = personById(edge.fromUserId);
  const to = personById(edge.toUserId);
  const mine = edge.fromUserId === ME.id;
  const content = (
    <>
      <span className="flex items-center gap-1">
        <UserAvatar name={from.name} size="xs" />
        <ArrowRight className="size-3 text-muted-foreground" />
        <UserAvatar name={to.name} size="xs" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">
          {firstName(from)} → {firstName(to)}
        </span>
        <span className="block text-xs text-muted-foreground">
          {mine ? "Você paga" : "Outro acerto"}
        </span>
      </span>
      <Money
        cents={edge.amountCents}
        className={cn("text-sm font-semibold", mine && "text-destructive")}
      />
      {mine && <ChevronRight className="size-4 text-muted-foreground" />}
    </>
  );
  const rowClass = "flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left";
  if (!mine) return <div className={rowClass}>{content}</div>;
  return (
    <button type="button" className={rowClass} onClick={() => onPay(edge)}>
      {content}
    </button>
  );
}
export function SettlementScreen({ sheet }: ScreenProps) {
  const [openSheet, setOpenSheet] = useState<string | null>(sheet);
  const [payEdge, setPayEdge] = useState<DebtEdge>(TRANSFERS[0]);

  return (
    <PreviewShell nav="groups">
      <ScreenHeader back eyebrow="Churras do Ap 42" title="Acerto do grupo" />
      <div className="space-y-5 px-4">
        <ConsolidatedBalanceCard />
        <section>
          <SectionHeading
            title="Transferências"
            trailing={<Badge variant="secondary">{TRANSFERS.length}</Badge>}
          />
          <div className="divide-y divide-border rounded-2xl border bg-card">
            {TRANSFERS.map((edge) => (
              <TransferRow
                key={`${edge.fromUserId}-${edge.toUserId}`}
                edge={edge}
                onPay={(next) => {
                  setPayEdge(next);
                  setOpenSheet("pay");
                }}
              />
            ))}
          </div>
        </section>
        <section>
          <SectionHeading
            title="Plano sugerido"
            trailing={
              <Button variant="ghost" size="icon-sm" aria-label="Repetir animação">
                <RefreshCw className="size-4" />
              </Button>
            }
          />
          <div className="rounded-2xl border bg-card p-2">
            <DebtGraph participants={SETTLEMENT_PARTICIPANTS} edges={TRANSFERS} />
            <p className="px-2 pb-2 text-xs text-muted-foreground">
              Simplificação · {ORIGINAL_TRANSFERS.length} → {TRANSFERS.length}
            </p>
          </div>
        </section>
      </div>
      <PixQrModal
        open={openSheet === "pay"}
        onClose={() => setOpenSheet(null)}
        recipientName={personById(payEdge.toUserId).name}
        amountCents={payEdge.amountCents}
        mode="pay"
        pixKey={PIX_KEYS[payEdge.toUserId]}
        onMarkPaid={async () => {
          throw new Error("Esta prévia não registra pagamentos.");
        }}
      />
    </PreviewShell>
  );
}

