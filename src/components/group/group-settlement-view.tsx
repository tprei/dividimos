"use client";

import { useReducedMotion } from "framer-motion";
import { CheckCheck, ChevronDown, RefreshCw } from "lucide-react";
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
import { Money } from "@/components/shared/money";
import { SectionCard } from "@/components/ui/section-card";
import { haptics } from "@/hooks/use-haptics";
import { Button } from "@/components/ui/button";
import { ListRow } from "@/components/ui/list-row";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatBRL } from "@/lib/currency";
import { displayNames } from "@/lib/people";
import type { DebtEdge } from "@/types";
import { recordSettlement } from "@/lib/sync/mutations";
import { selectTransfers } from "@/stores/app-selectors";
import { useAppStore } from "@/stores/app-store";
import type { GroupSnapshot, Transfer } from "@/types/ledger";

const PixQrModal = dynamic(
  () =>
    import("@/components/settlement/pix-qr-modal").then((m) => ({
      default: m.PixQrModal,
    })),
  { ssr: false, loading: () => <ModalLoadingSkeleton /> }
);

interface GroupSettlementViewProps {
  groupId: string;
  snapshot: GroupSnapshot;
  meId: string;
}

interface PixTarget {
  counterpartyId: string;
  recipientName: string;
  mode: "pay" | "collect";
}

function toEdge(transfer: Transfer): DebtEdge {
  return {
    fromUserId: transfer.fromId,
    toUserId: transfer.toId,
    amountCents: transfer.amountCents,
  };
}

export function GroupSettlementView({
  groupId,
  snapshot,
  meId,
}: GroupSettlementViewProps) {
  const transfers = useAppStore((s) => selectTransfers(s, groupId));
  const reducedMotion = useReducedMotion();
  const [pixTarget, setPixTarget] = useState<PixTarget | null>(null);
  const [selected, setSelected] = useState<{ from: string; to: string } | null>(
    null
  );
  const [replayKey, setReplayKey] = useState(0);
  const [choosingTransfer, setChoosingTransfer] = useState(false);

  const settled = snapshot.balances.every((balance) => balance.netCents === 0);

  const people = useMemo<SettlementPerson[]>(
    () => [
      ...snapshot.members.map((member) => ({
        id: member.userId,
        name: member.user.name,
        handle: member.user.handle,
        avatarUrl: member.user.avatarUrl,
        isGuest: false,
        isPending: member.status === "invited",
      })),
      ...snapshot.guests.map((guest) => ({
        id: guest.id,
        name: guest.displayName,
        handle: null,
        avatarUrl: null,
        isGuest: true,
        isPending: false,
      })),
    ],
    [snapshot.members, snapshot.guests]
  );

  const peopleById = useMemo(
    () => new Map(people.map((p) => [p.id, p])),
    [people]
  );
  const labels = displayNames(people, { style: "short", viewerId: meId });
  const fullNames = displayNames(people, { style: "full" });
  const myBalance =
    snapshot.balances.find(
      (balance) => balance.kind === "user" && balance.participantId === meId
    )?.netCents ?? 0;
  const myTransfers = transfers.filter((transfer) => {
    if (transfer.fromKind !== "user") return false;
    const counterparty = peopleById.get(
      transfer.fromId === meId ? transfer.toId : transfer.fromId
    );
    return (
      (transfer.fromId === meId || transfer.toId === meId) &&
      counterparty &&
      !counterparty.isGuest &&
      !counterparty.isPending
    );
  });
  const openTransfer = (transfer: Transfer) => {
    const paying = transfer.fromId === meId;
    const counterparty = peopleById.get(
      paying ? transfer.toId : transfer.fromId
    );
    if (!counterparty) return;
    haptics.tap();
    setChoosingTransfer(false);
    setPixTarget({
      counterpartyId: counterparty.id,
      recipientName: counterparty.name,
      mode: paying ? "pay" : "collect",
    });
  };
  let singleTransferLabel: string | undefined;
  if (myTransfers.length === 1) {
    const [transfer] = myTransfers;
    const paying = transfer.fromId === meId;
    const name =
      peopleById.get(paying ? transfer.toId : transfer.fromId)?.name ?? "";
    const amount = formatBRL(transfer.amountCents);
    singleTransferLabel = paying
      ? `Pagar ${amount} para ${name}`
      : `Cobrar ${amount} de ${name}`;
  }

  const graphParticipants = useMemo(() => {
    const involved = new Set<string>();
    for (const edge of [...snapshot.pairwiseEdges, ...transfers]) {
      involved.add(edge.fromId);
      involved.add(edge.toId);
    }
    return people.filter((person) => involved.has(person.id));
  }, [snapshot.pairwiseEdges, transfers, people]);

  const selectedTransfer = selected
    ? transfers.find(
        (t) => t.fromId === selected.from && t.toId === selected.to
      )
    : undefined;
  const announcement = selectedTransfer
    ? `Transferência selecionada: ${
        peopleById.get(selectedTransfer.fromId)?.name ?? selectedTransfer.fromId
      } paga ${formatBRL(selectedTransfer.amountCents)} para ${
        peopleById.get(selectedTransfer.toId)?.name ?? selectedTransfer.toId
      }`
    : "";

  // Built before the settled early return so an open modal survives the
  // moment the last balance clears and shows its own settled state.
  const pixModal = pixTarget ? (
    <PixQrModal
      open
      onClose={() => setPixTarget(null)}
      recipientName={fullNames.get(pixTarget.counterpartyId) ?? pixTarget.recipientName}
      counterpartyId={pixTarget.counterpartyId}
      counterpartyAvatarUrl={peopleById.get(pixTarget.counterpartyId)?.avatarUrl}
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
  ) : null;

  if (settled) {
    return (
      <div
        role="status"
        className="flex flex-col items-center py-12 text-center"
      >
        <div className="rounded-full bg-success/10 p-3">
          <CheckCheck className="size-7 text-success-text" aria-hidden="true" />
        </div>
        <h2 className="mt-3 text-lg font-bold">Tudo acertado</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Ninguém deve nada por aqui.
        </p>
        {pixModal}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section
        aria-label="Seu saldo"
        className="flex items-center justify-between gap-3"
      >
        <p className="min-w-0 flex-1 text-base leading-snug">
          {myBalance === 0 ? (
            "Você está em dia"
          ) : (
            <>
              {myBalance > 0 ? "Você tem " : "Você deve "}
              <Money
                cents={myBalance}
                tone="auto"
                size="md"
                className="text-lg font-bold"
              />
              {myBalance > 0 && (
                <span className="whitespace-nowrap"> pra receber</span>
              )}
            </>
          )}
        </p>
        {myTransfers.length === 1 && (
          <Button
            size="sm"
            aria-label={singleTransferLabel}
            title={singleTransferLabel}
            onClick={() => openTransfer(myTransfers[0])}
          >
            {myBalance < 0 ? "Pagar" : "Cobrar"}
          </Button>
        )}
        {myTransfers.length > 1 && (
          <Popover open={choosingTransfer} onOpenChange={setChoosingTransfer}>
            <PopoverTrigger
              render={<Button size="sm" onClick={() => haptics.tap()} />}
            >
              {myBalance < 0 ? "Pagar" : "Cobrar"}
            </PopoverTrigger>
            <PopoverContent align="end">
              <PopoverTitle>
                {myBalance < 0 ? "Pagar para quem?" : "Cobrar de quem?"}
              </PopoverTitle>
              {myTransfers.map((transfer) => {
                const counterpartyId =
                  transfer.fromId === meId ? transfer.toId : transfer.fromId;
                const counterparty = peopleById.get(counterpartyId);
                if (!counterparty) return null;
                return (
                  <ListRow
                    key={counterpartyId}
                    title={labels.get(counterpartyId) ?? counterparty.name}
                    trailing={<Money cents={transfer.amountCents} size="sm" />}
                    onClick={() => openTransfer(transfer)}
                    className="rounded-xl px-2"
                  />
                );
              })}
            </PopoverContent>
          </Popover>
        )}
      </section>
      <div className="grid items-start gap-6 md:grid-cols-2">
        <section
          aria-label="Quem paga quem"
          className="min-w-0"
        >
          <SectionHeading title="Quem paga quem" />
          <SectionCard className="divide-y divide-border">
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
                  fromLabel={labels.get(from.id) ?? from.name}
                  toLabel={labels.get(to.id) ?? to.name}
                  meId={meId}
                  highlighted={highlighted}
                  onPay={() =>
                    setPixTarget({
                      counterpartyId: transfer.toId,
                      recipientName: to.name,
                      mode: "pay",
                    })
                  }
                  onCollect={() =>
                    setPixTarget({
                      counterpartyId: transfer.fromId,
                      recipientName: from.name,
                      mode: "collect",
                    })
                  }
                />
              );
            })}
          </SectionCard>
          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </section>

        <div className="min-w-0 space-y-3">
          <ConsolidatedBalanceCard
            balances={snapshot.balances}
            viewerId={meId}
            people={people}
          />
          <details className="group rounded-2xl border bg-card">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-2xl px-4 py-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Como os pagamentos se simplificam
              <ChevronDown
                className="size-4 shrink-0 group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <section aria-label="Plano sugerido" className="px-2 pb-2">
              {!reducedMotion && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Repetir animação"
                  onClick={() => {
                    haptics.tap();
                    setReplayKey((key) => key + 1);
                  }}
                >
                  <RefreshCw className="size-4" />
                </Button>
              )}
              <div className="rounded-2xl border bg-card p-2">
                <DebtGraph
                  participants={graphParticipants}
                  viewerId={meId}
                  edges={transfers.map(toEdge)}
                  rawEdges={snapshot.pairwiseEdges.map(toEdge)}
                  replayKey={replayKey}
                  selected={selected}
                  onSelectEdge={setSelected}
                />
              </div>
            </section>
          </details>
        </div>
      </div>

      {pixModal}
    </div>
  );
}
