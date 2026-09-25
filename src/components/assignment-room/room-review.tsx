"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PayerStep, type PayerStepParticipant } from "@/components/bill/payer-step";
import { RoomFinalBoard } from "@/components/assignment-room/room-final-board";
import { Money } from "@/components/shared/money";
import { ScreenHeader } from "@/components/shared/screen-header";
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
  const [attempted, setAttempted] = useState(false);
  const [payerEdited, setPayerEdited] = useState(false);
  const initializedPayer = useRef(false);
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
  const hostPayerId = eligiblePayers.find(
    ({ participant }) => participant.id === view.room.selfParticipantId,
  )?.participant.id;
  const hostRef = hostPayerId ? refByParticipantId.get(hostPayerId) : undefined;
  const hostUserId = hostRef?.kind === "user" ? hostRef.userId : undefined;
  useEffect(() => {
    if (initializedPayer.current) return;
    initializedPayer.current = true;
    if (payers.length === 0 && hostUserId) onSetPayerFull(hostUserId);
  }, [hostUserId, onSetPayerFull, payers.length]);
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
    <div className="flex min-h-full flex-1 flex-col">
      <ScreenHeader title="Revisão" subtitle={view.room.title} />
      <div className="flex-1 space-y-6 px-4 py-3">

      <section className="rounded-2xl border bg-card p-4" aria-label="Quem pagou?">
        <PayerStep
          participants={payerParticipants}
          payers={payers}
          grandTotal={view.room.totalCents}
          onSetPayerFull={(userId) => { setPayerEdited(true); onSetPayerFull(userId); }}
          onSplitPaymentEqually={(userIds) => { setPayerEdited(true); onSplitPaymentEqually(userIds); }}
          onSetPayerAmount={(userId, amountCents) => { setPayerEdited(true); onSetPayerAmount(userId, amountCents); }}
          onRemovePayerEntry={(userId) => { setPayerEdited(true); onRemovePayerEntry(userId); }}
        />
      </section>
      {previewBill && (
        <section className="space-y-3" aria-labelledby="room-review-board-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="room-review-board-heading" className="text-base font-medium">Quadro final</h2>
            <Money cents={previewBill.totalCents} className="text-base font-semibold" />
          </div>
          <RoomFinalBoard
            bill={previewBill}
            selfParticipantIndex={activeParticipants.findIndex(({ participant }) => participant.id === view.room.selfParticipantId)}
          />
        </section>
      )}

      {blocker && (attempted || (payerEdited && paidCents !== view.room.totalCents)) && (
        <p role="alert" className="text-sm text-destructive-text">
          {blocker}
        </p>
      )}

      </div>
      <footer className="sticky bottom-0 z-10 grid gap-2 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:grid-cols-[auto_1fr]">
        <Button type="button" variant="outline" className="h-12" disabled={pending} onClick={onEditClaims}>
          Corrigir escolhas
        </Button>
        <Button
          type="button"
          className="h-12 font-semibold"
          disabled={pending}
          aria-busy={pending}
          onClick={() => {
            setAttempted(true);
            if (!blocker && previewBill) onFinalize();
          }}
        >
          Registrar conta · <Money cents={view.room.totalCents} />
        </Button>
      </footer>
    </div>
  );
}
