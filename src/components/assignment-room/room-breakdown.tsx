"use client";

import { Check } from "lucide-react";
import { RoomFinalBoard } from "@/components/assignment-room/room-final-board";
import { Money } from "@/components/shared/money";
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

  return (
    <section className="flex min-h-full flex-1 flex-col" aria-label={heading}>
      <ScreenHeader title={heading} subtitle={bill.title} leading={
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-success/15 text-success-text">
          <Check aria-hidden className="size-5" />
        </span>
      } />
      <div className="flex-1 space-y-6 px-4 py-3">

        {selfIndex !== null && (
          <section aria-label="Sua parte" className="gradient-primary rounded-2xl p-5 text-primary-foreground">
            <p className="text-sm font-medium opacity-90">Sua parte</p>
            <Money cents={bill.shares[selfIndex]} className="mt-1 block text-4xl font-bold tracking-tight" />
            <p className="mt-3 text-sm opacity-90">{selfItemCount} {selfItemCount === 1 ? "item" : "itens"}</p>
            {bill.serviceFeeBasisPoints > 0 && (
              <p className="mt-1 text-xs opacity-90">inclui taxa de serviço de {serviceFeePercentText(bill.serviceFeeBasisPoints)}%</p>
            )}
          </section>
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
