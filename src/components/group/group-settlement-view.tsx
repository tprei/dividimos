"use client";

import { useReducedMotion } from "framer-motion";
import { CheckCheck, RefreshCw } from "lucide-react";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { DebtGraph } from "@/components/settlement/debt-graph";
import {
  ConsolidatedBalanceCard,
  type SettlementPerson,
} from "@/components/settlement/consolidated-balance-card";
import { TransferRow } from "@/components/settlement/transfer-row";
import { ModalLoadingSkeleton } from "@/components/shared/skeleton";
import { SectionHeading } from "@/components/shared/section-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/currency";
import type { DebtEdge } from "@/lib/simplify";
import { recordSettlement } from "@/lib/sync/mutations";
import { selectTransfers } from "@/stores/app-selectors";
import { useAppStore } from "@/stores/app-store";
import type { GroupSnapshot, Transfer } from "@/types/ledger";

const PixQrModal = dynamic(
  () => import("@/components/settlement/pix-qr-modal").then((m) => ({ default: m.PixQrModal })),
  { ssr: false, loading: () => <ModalLoadingSkeleton /> },
);

interface GroupSettlementViewProps {
  groupId: string;
  snapshot: GroupSnapshot;
  meId: string;
}

interface PixTarget {
  counterpartyId: string;
  recipientName: string;
  amountCents: number;
  mode: "pay" | "collect";
}

function toEdge(transfer: Transfer): DebtEdge {
  return {
    fromUserId: transfer.fromId,
    toUserId: transfer.toId,
    amountCents: transfer.amountCents,
  };
}

export function GroupSettlementView({ groupId, snapshot, meId }: GroupSettlementViewProps) {
  const transfers = useAppStore((s) => selectTransfers(s, groupId));
  const reducedMotion = useReducedMotion();
  const [pixTarget, setPixTarget] = useState<PixTarget | null>(null);
  const [selected, setSelected] = useState<{ from: string; to: string } | null>(null);
  const [replayKey, setReplayKey] = useState(0);

  const settled = snapshot.balances.every((balance) => balance.netCents === 0);

  const people = useMemo<SettlementPerson[]>(
    () => [
      ...snapshot.members.map((member) => ({
        id: member.userId,
        name: member.user.name,
        avatarUrl: member.user.avatarUrl,
        isGuest: false,
        isPending: member.status === "invited",
      })),
      ...snapshot.guests.map((guest) => ({
        id: guest.id,
        name: guest.displayName,
        avatarUrl: null,
        isGuest: true,
        isPending: false,
      })),
    ],
    [snapshot.members, snapshot.guests],
  );

  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const graphParticipants = useMemo(() => {
    const involved = new Set<string>();
    for (const edge of [...snapshot.pairwiseEdges, ...transfers]) {
      involved.add(edge.fromId);
      involved.add(edge.toId);
    }
    return people.filter((person) => involved.has(person.id));
  }, [snapshot.pairwiseEdges, transfers, people]);

  const selectedTransfer = selected
    ? transfers.find((t) => t.fromId === selected.from && t.toId === selected.to)
    : undefined;
  const announcement = selectedTransfer
    ? `Transferência selecionada: ${peopleById.get(selectedTransfer.fromId)?.name ?? selectedTransfer.fromId} paga ${formatBRL(selectedTransfer.amountCents)} para ${peopleById.get(selectedTransfer.toId)?.name ?? selectedTransfer.toId}`
    : "";

  if (settled) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <div className="rounded-2xl bg-success/10 p-3">
          <CheckCheck className="h-8 w-8 text-success" />
        </div>
        <p className="mt-3 text-base font-semibold text-foreground">Tudo liquidado!</p>
        <p className="mt-1 max-w-[240px] text-sm text-muted-foreground">
          Nenhuma dívida pendente no grupo. Quando uma conta for ativada, os saldos aparecem aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ConsolidatedBalanceCard
        balances={snapshot.balances}
        people={people}
        debtsCount={snapshot.pairwiseEdges.length}
        pixCount={transfers.length}
      />

      <section aria-label="Transferências">
        <SectionHeading
          title="Transferências"
          trailing={<Badge variant="secondary">{transfers.length}</Badge>}
        />
        <div className="divide-y divide-border rounded-2xl border bg-card">
          {transfers.map((transfer) => {
            const from = peopleById.get(transfer.fromId);
            const to = peopleById.get(transfer.toId);
            if (!from || !to) return null;
            const highlighted =
              selected !== null &&
              selected.from === transfer.fromId &&
              selected.to === transfer.toId;
            return (
              <TransferRow
                key={`${transfer.fromId}-${transfer.toId}`}
                transfer={transfer}
                from={from}
                to={to}
                meId={meId}
                highlighted={highlighted}
                onPay={() =>
                  setPixTarget({
                    counterpartyId: transfer.toId,
                    recipientName: to.name,
                    amountCents: transfer.amountCents,
                    mode: "pay",
                  })
                }
                onCollect={() =>
                  setPixTarget({
                    counterpartyId: transfer.fromId,
                    recipientName: from.name,
                    amountCents: transfer.amountCents,
                    mode: "collect",
                  })
                }
              />
            );
          })}
        </div>
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </section>

      <section aria-label="Plano sugerido">
        <SectionHeading
          title="Plano sugerido"
          trailing={
            !reducedMotion && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Repetir animação"
                onClick={() => setReplayKey((key) => key + 1)}
              >
                <RefreshCw className="size-4" />
              </Button>
            )
          }
        />
        <div className="rounded-2xl border bg-card p-2">
          <DebtGraph
            participants={graphParticipants}
            edges={transfers.map(toEdge)}
            rawEdges={snapshot.pairwiseEdges.map(toEdge)}
            replayKey={replayKey}
            selected={selected}
            onSelectEdge={setSelected}
          />
          <p className="px-2 pb-2 text-xs text-muted-foreground">
            Simplificação · {snapshot.pairwiseEdges.length} → {transfers.length}
          </p>
        </div>
      </section>

      {pixTarget && (
        <PixQrModal
          open
          onClose={() => setPixTarget(null)}
          recipientName={pixTarget.recipientName}
          amountCents={pixTarget.amountCents}
          recipientUserId={
            pixTarget.mode === "pay" ? pixTarget.counterpartyId : meId
          }
          groupId={groupId}
          mode={pixTarget.mode}
          onMarkPaid={(amountCents: number, operationId: string) =>
            recordSettlement({
              groupId,
              operationId,
              fromUserId:
                pixTarget.mode === "pay" ? meId : pixTarget.counterpartyId,
              toUserId:
                pixTarget.mode === "pay" ? pixTarget.counterpartyId : meId,
              amountCents,
            }).then(() => undefined)
          }
        />
      )}
    </div>
  );
}
