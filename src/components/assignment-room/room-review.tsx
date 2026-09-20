"use client";

import { useMemo, useState } from "react";
import { RoomBreakdown } from "@/components/assignment-room/room-breakdown";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { buildAssignmentExpense } from "@/lib/assignment-room-money";
import type { AssignmentRoomView } from "@/types/assignment-room";
import type { ExpensePayload } from "@/types/ledger";

interface RoomReviewProps {
  view: Extract<AssignmentRoomView, { role: "host" }>;
  pending: boolean;
  blockerMessage?: string | null;
  onEditClaims: () => void;
  onFinalize: (payload: ExpensePayload) => void;
}

function buildFailureMessage(code: string): string {
  if (code === "incomplete_expense") return "Ainda há itens com quantidade sem dono.";
  if (code === "allocation_exceeds_total") return "Uma escolha ficou acima da quantidade do item. Atualize a sala.";
  return "A divisão mudou ou está incompleta. Atualize a sala antes de registrar.";
}

export function RoomReview({
  view,
  pending,
  blockerMessage,
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
  const eligiblePayers = activeParticipants
    .map(({ participant }, participantIndex) => ({ participant, participantIndex }))
    .filter(({ participant }) => {
      const ref = refByParticipantId.get(participant.id);
      return !participant.isGuest && ref?.kind === "user" && ref.userId.length > 0;
    });
  const [selectedPayerId, setSelectedPayerId] = useState<string | null>(null);
  const selectedPayer = eligiblePayers.find(
    ({ participant }) => participant.id === selectedPayerId,
  );
  const previewPayer = selectedPayer ?? eligiblePayers[0];
  const buildResult = previewPayer
    ? buildAssignmentExpense(view, [
        {
          participantIndex: previewPayer.participantIndex,
          amountCents: view.room.totalCents,
        },
      ])
    : null;
  const payload = buildResult?.ok ? buildResult.value : null;
  const previewBill = payload
    ? {
        status: "active" as const,
        versionNo: 0,
        title: view.room.title,
        occurredOn: view.room.occurredOn,
        items: payload.items,
        itemAssignments: payload.itemAssignments,
        participants: activeParticipants.map(({ participant }, participantIndex) => ({
          participantIndex,
          displayName: participant.displayName,
          avatarUrl: participant.avatarUrl,
          isGuest: participant.isGuest,
        })),
        shares: payload.shares,
        payers: payload.payers,
        totalCents: view.room.totalCents,
        serviceFeeBasisPoints: view.room.serviceFeeBasisPoints,
        fixedFeeCents: view.room.fixedFeeCents,
      }
    : null;

  let blocker = blockerMessage ?? null;
  if (!blocker && view.room.status !== "closed") {
    blocker = "Feche as escolhas antes de registrar a conta.";
  } else if (!blocker && eligiblePayers.length === 0) {
    blocker = "Nenhuma pessoa com conta no Dividimos pode ser pagadora.";
  } else if (!blocker && buildResult && !buildResult.ok) {
    blocker = buildFailureMessage(buildResult.issue.code);
  } else if (!blocker && !selectedPayer) {
    blocker = "Selecione quem pagou a conta.";
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border bg-card p-5">
        <p className="text-sm font-medium text-primary">Aguardando confirmação</p>
        <h2 className="mt-1 font-heading text-xl font-semibold">Revise antes de registrar</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Confira a divisão atual e escolha quem pagou o valor total.
        </p>
      </section>

      {previewBill && (
        <RoomBreakdown
          bill={previewBill}
          roomId={view.room.id}
          heading="Divisão proposta"
          statusLabel="Aguardando confirmação"
        />
      )}

      <section className="space-y-3 rounded-2xl border bg-card p-4" aria-labelledby="room-payer-heading">
        <div>
          <h2 id="room-payer-heading" className="font-heading font-semibold">Quem pagou?</h2>
          <p className="text-sm text-muted-foreground">
            Apenas pessoas com conta no Dividimos podem ser pagadoras.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {eligiblePayers.map(({ participant }) => {
            const selected = participant.id === selectedPayerId;
            return (
              <Button
                key={participant.id}
                type="button"
                variant={selected ? "default" : "outline"}
                className="min-h-11"
                aria-pressed={selected}
                disabled={pending}
                onClick={() => setSelectedPayerId(participant.id)}
              >
                <UserAvatar name={participant.displayName} avatarUrl={participant.avatarUrl} size="xs" />
                {participant.displayName}
              </Button>
            );
          })}
        </div>
      </section>

      {blocker && (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {blocker}
        </p>
      )}

      <p className="text-sm text-muted-foreground">
        Se precisar, volte para corrigir escolhas ou remover pessoas antes de registrar.
      </p>
      <p className="text-sm text-muted-foreground">
        Ao registrar, quem entrou com uma conta recebe um convite para o grupo. Quem já
        participa continua no grupo; convidados continuam sem precisar de conta.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={onEditClaims}>
          Corrigir escolhas
        </Button>
        <Button
          type="button"
          className="min-h-11"
          disabled={pending || blocker !== null || payload === null || selectedPayer === undefined}
          onClick={() => payload && selectedPayer && onFinalize(payload)}
        >
          {pending ? "Registrando..." : "Registrar conta"}
        </Button>
      </div>
    </div>
  );
}
