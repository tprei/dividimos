"use client";

import { useMemo } from "react";
import { PayerStep, type PayerStepParticipant } from "@/components/bill/payer-step";
import { RoomBreakdown } from "@/components/assignment-room/room-breakdown";
import { Button } from "@/components/ui/button";
import { buildAssignmentDivision } from "@/lib/assignment-room-money";
import type { AssignmentRoomView } from "@/types/assignment-room";

export interface RoomPayerDraft {
  userId: string;
  amountCents: number;
}

interface RoomReviewProps {
  view: Extract<AssignmentRoomView, { role: "host" }>;
  pending: boolean;
  blockerMessage?: string | null;
  payers: RoomPayerDraft[];
  onSetPayerFull: (userId: string) => void;
  onSplitPaymentEqually: (userIds: string[]) => void;
  onSetPayerAmount: (userId: string, amountCents: number) => void;
  onRemovePayerEntry: (userId: string) => void;
  onEditClaims: () => void;
  onFinalize: () => void;
}

export function buildAssignmentRoomFailureMessage(code: string): string {
  if (code === "incomplete_expense") return "Ainda há itens com quantidade sem dono.";
  if (code === "allocation_exceeds_total") {
    return "Uma escolha ficou acima da quantidade do item. Atualize a sala.";
  }
  return "A divisão mudou ou está incompleta. Atualize a sala antes de registrar.";
}

export function RoomReview({
  view,
  pending,
  blockerMessage,
  payers,
  onSetPayerFull,
  onSplitPaymentEqually,
  onSetPayerAmount,
  onRemovePayerEntry,
  onEditClaims,
  onFinalize,
}: RoomReviewProps) {
  const activeParticipants = useMemo(
    () =>
      view.room.participants
        .map((participant, snapshotIndex) => ({ participant, snapshotIndex }))
        .filter(({ participant }) => !participant.removed)
        .sort((left, right) =>
          left.participant.ordinal === right.participant.ordinal
            ? left.snapshotIndex - right.snapshotIndex
            : left.participant.ordinal - right.participant.ordinal,
        ),
    [view.room.participants],
  );
  const refByParticipantId = useMemo(
    () => new Map(view.participantRefs.map((entry) => [entry.participantId, entry.ref])),
    [view.participantRefs],
  );
  const eligiblePayers = useMemo(
    () =>
      activeParticipants
        .map(({ participant }, participantIndex) => ({ participant, participantIndex }))
        .filter(({ participant }) => {
          const ref = refByParticipantId.get(participant.id);
          return !participant.isGuest && ref?.kind === "user" && ref.userId.length > 0;
        }),
    [activeParticipants, refByParticipantId],
  );
  const payerParticipants: PayerStepParticipant[] = eligiblePayers.flatMap(({ participant }) => {
    const ref = refByParticipantId.get(participant.id);
    return ref?.kind === "user" && ref.userId.length > 0
      ? [{ id: ref.userId, name: participant.displayName, avatarUrl: participant.avatarUrl }]
      : [];
  });
  const payerIndexes = new Map(
    eligiblePayers.flatMap(({ participant, participantIndex }) => {
      const ref = refByParticipantId.get(participant.id);
      return ref?.kind === "user" && ref.userId.length > 0
        ? [[ref.userId, participantIndex] as const]
        : [];
    }),
  );
  const payerPayloads = payers
    .map((payer) => {
      const participantIndex = payerIndexes.get(payer.userId);
      return participantIndex === undefined
        ? null
        : { participantIndex, amountCents: payer.amountCents };
    })
    .filter((payer): payer is { participantIndex: number; amountCents: number } => payer !== null);
  const divisionResult = buildAssignmentDivision(view);
  const previewBill = divisionResult.ok
    ? {
        status: "active" as const,
        versionNo: 0,
        title: view.room.title,
        occurredOn: view.room.occurredOn,
        items: divisionResult.value.items,
        itemAssignments: divisionResult.value.itemAssignments,
        participants: activeParticipants.map(({ participant }, participantIndex) => ({
          participantIndex,
          displayName: participant.displayName,
          avatarUrl: participant.avatarUrl,
          isGuest: participant.isGuest,
        })),
        shares: divisionResult.value.shares,
        payers: payerPayloads,
        totalCents: view.room.totalCents,
        serviceFeeBasisPoints: view.room.serviceFeeBasisPoints,
        fixedFeeCents: view.room.fixedFeeCents,
      }
    : null;
  const paidCents = payers.reduce((sum, payer) => sum + payer.amountCents, 0);

  let blocker = blockerMessage ?? null;
  if (!blocker && view.room.status !== "closed") {
    blocker = "Feche as escolhas antes de registrar a conta.";
  } else if (!blocker && eligiblePayers.length === 0) {
    blocker = "Nenhuma pessoa com conta no Dividimos pode ser pagadora.";
  } else if (!blocker && !divisionResult.ok) {
    blocker = buildAssignmentRoomFailureMessage(divisionResult.issue.code);
  } else if (!blocker && payers.length === 0) {
    blocker = "Escolha pelo menos uma pessoa que pagou a conta.";
  } else if (!blocker && paidCents !== view.room.totalCents) {
    blocker = "Os valores pagos precisam somar exatamente o total da conta.";
  }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Aguardando confirmação</p>
        <h2 className="mt-2 font-heading text-2xl font-bold tracking-tight">Tudo escolhido. Vamos fechar?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Confira a divisão atual e escolha uma ou mais pessoas que pagaram o valor total.
        </p>
      </div>


      <section className="space-y-4 rounded-2xl border bg-card p-4" aria-labelledby="room-payer-heading">
        <div>
          <h2 id="room-payer-heading" className="sr-only">Quem pagou a conta?</h2>
          <p className="text-sm text-muted-foreground">
            Pessoas convidadas sem conta podem escolher itens, mas não podem ser pagadoras.
          </p>
        </div>
        <PayerStep
          participants={payerParticipants}
          payers={payers}
          grandTotal={view.room.totalCents}
          onSetPayerFull={onSetPayerFull}
          onSplitPaymentEqually={onSplitPaymentEqually}
          onSetPayerAmount={onSetPayerAmount}
          onRemovePayerEntry={onRemovePayerEntry}
          hasGuests={activeParticipants.some(({ participant }) => participant.isGuest)}
        />
      </section>
      {previewBill && (
        <RoomBreakdown
          bill={previewBill}
          selfParticipantIndex={null}
          heading="Divisão proposta"
          statusLabel="Aguardando confirmação"
        />
      )}

      {blocker && (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {blocker}
        </p>
      )}

      <details className="text-xs text-muted-foreground">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium">O que acontece ao registrar?</summary>
        <p className="pb-2">Se precisar, volte para corrigir escolhas ou remover pessoas antes de registrar.</p>
        <p className="pb-2">Ao registrar, quem entrou com uma conta recebe um convite para o grupo. Quem já participa continua no grupo; convidados continuam sem precisar de conta.</p>
      </details>
      <div className="grid gap-2 border-t pt-4 sm:grid-cols-2">
        <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={onEditClaims}>
          Corrigir escolhas
        </Button>
        <Button
          type="button"
          className="min-h-12 font-semibold"
          disabled={pending || blocker !== null || previewBill === null}
          onClick={onFinalize}
        >
          {pending ? "Registrando..." : "Registrar conta"}
        </Button>
      </div>
    </div>
  );
}
