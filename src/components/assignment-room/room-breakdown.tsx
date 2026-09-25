"use client";

import { Check } from "lucide-react";
import { RoomFinalBoard } from "@/components/assignment-room/room-final-board";
import { AmountHeroCard, type AmountHeroDetail } from "@/components/shared/amount-hero-card";
import { ScreenHeader } from "@/components/shared/screen-header";
import { Button } from "@/components/ui/button";
import type { AssignmentBillBreakdown } from "@/types/assignment-room";

interface RoomBreakdownProps {
  bill: AssignmentBillBreakdown;
  selfParticipantIndex?: number | null;
  heading?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
}

function serviceFeePercentText(basisPoints: number): string {
  return (basisPoints / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export function RoomBreakdown({
  bill,
  selfParticipantIndex,
  heading = "Conta registrada",
  actionLabel,
  onAction,
  actionDisabled = false,
}: RoomBreakdownProps) {
  if (bill.status === "deleted") {
    return (
      <section className="rounded-2xl border bg-card p-5">
        <h2 className="font-heading text-lg font-semibold">Conta excluída</h2>
      </section>
    );
  }

  const selfIndex = selfParticipantIndex != null &&
    bill.participants.some((participant) => participant.participantIndex === selfParticipantIndex) &&
    bill.shares[selfParticipantIndex] !== undefined ? selfParticipantIndex : null;
  const selfItemCount = bill.itemAssignments?.filter((assignment) => assignment.participantIndex === selfIndex).length ?? 0;
  const shareDetails: AmountHeroDetail[] = [{ label: "Itens", value: selfItemCount }];
  if (bill.serviceFeeBasisPoints > 0) {
    shareDetails.push({ label: "Serviço", value: `${serviceFeePercentText(bill.serviceFeeBasisPoints)}%` });
  }
  const payerIndexes = bill.payers.map((payer) => payer.participantIndex);
  if (payerIndexes.length > 1) shareDetails.push({ label: "Quem pagou", value: `${payerIndexes.length} pessoas` });
  else if (payerIndexes.length === 1) {
    const payer = bill.participants.find((person) => person.participantIndex === payerIndexes[0]);
    shareDetails.push({ label: "Quem pagou", value: payerIndexes[0] === selfIndex ? "Você" : (payer?.displayName ?? "—") });
  }

  return (
    <section className="flex min-h-full flex-1 flex-col" aria-label={heading}>
      <ScreenHeader title={heading} subtitle={bill.title} leading={
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-success/15 text-success-text">
          <Check aria-hidden className="size-5" />
        </span>
      } />
      <div className="flex-1 space-y-6 px-4 py-3">

        {selfIndex !== null && (
          <AmountHeroCard role="region" aria-label="Sua parte" label="Sua parte" cents={bill.shares[selfIndex]} details={shareDetails} />
        )}

        <section className="space-y-3" aria-labelledby="room-final-board-heading">
          <h2 id="room-final-board-heading" className="text-base font-medium">Quadro final</h2>
          <RoomFinalBoard key={selfIndex} bill={bill} selfParticipantIndex={selfIndex} />
        </section>
      </div>

      {onAction && (
        <footer className="sticky bottom-0 z-10 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <Button type="button" className="h-12 w-full whitespace-normal text-sm font-semibold" disabled={actionDisabled} onClick={onAction}>
            {actionLabel}
          </Button>
        </footer>
      )}
    </section>
  );
}
