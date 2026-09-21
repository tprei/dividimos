"use client";

import { ChevronDown, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Money } from "@/components/shared/money";
import { PersonLabel } from "@/components/shared/person-label";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AssignmentBillBreakdown } from "@/types/assignment-room";

interface RoomBreakdownProps {
  bill: AssignmentBillBreakdown;
  selfParticipantIndex?: number | null;
  heading?: string;
  statusLabel?: string;
  actionLabel?: string;
  actionDescription?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
}

function serviceFeePercentText(basisPoints: number): string {
  return (basisPoints / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function feeDescription(bill: AssignmentBillBreakdown): string | null {
  const parts: string[] = [];
  if (bill.serviceFeeBasisPoints > 0) {
    parts.push(`taxa de serviço de ${serviceFeePercentText(bill.serviceFeeBasisPoints)}%`);
  }
  if (bill.fixedFeeCents > 0) {
    parts.push("taxa fixa");
  }
  return parts.length > 0 ? `Inclui ${parts.join(" e ")}` : null;
}

function itemsCountLine(count: number): string {
  return count === 1 ? "1 item" : count === 0 ? "sem itens" : `${count} itens`;
}

export function RoomBreakdown({
  bill,
  selfParticipantIndex,
  heading = "Conta registrada",
  statusLabel = "Conta registrada",
  actionLabel,
  actionDescription,
  onAction,
  actionDisabled = false,
}: RoomBreakdownProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [expandedParticipantIndex, setExpandedParticipantIndex] = useState<number | null>(null);
  const [detailView, setDetailView] = useState<"people" | "items">("people");

  const expandedParticipantPresent =
    expandedParticipantIndex !== null &&
    bill.participants.some((participant) => participant.participantIndex === expandedParticipantIndex);

  useEffect(() => {
    if (expandedParticipantIndex !== null && !expandedParticipantPresent) {
      headingRef.current?.focus();
    }
  }, [expandedParticipantIndex, expandedParticipantPresent]);

  if (bill.status === "deleted") {
    return (
      <section className="space-y-4 rounded-2xl border bg-card p-5">
        <div>
          <h2 className="font-heading text-lg font-semibold">Conta excluída</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Esta conta não entra mais nos saldos do grupo.
          </p>
        </div>
      </section>
    );
  }

  const subtotalCents = bill.items.reduce((sum, item) => sum + item.totalPriceCents, 0);
  const serviceFeeCents = bill.totalCents - subtotalCents - bill.fixedFeeCents;
  const assignmentsByParticipant = new Map<number, NonNullable<AssignmentBillBreakdown["itemAssignments"]>>();
  for (const assignment of bill.itemAssignments ?? []) {
    const owned = assignmentsByParticipant.get(assignment.participantIndex);
    if (owned) {
      owned.push(assignment);
    } else {
      assignmentsByParticipant.set(assignment.participantIndex, [assignment]);
    }
  }

  const requestedSelfIndex = selfParticipantIndex ?? null;
  const selfIndex =
    requestedSelfIndex !== null &&
    bill.participants[requestedSelfIndex] !== undefined &&
    bill.shares[requestedSelfIndex] !== undefined
      ? requestedSelfIndex
      : null;
  const selfShareCents = selfIndex === null ? 0 : bill.shares[selfIndex];
  const selfAssignments = selfIndex === null ? [] : assignmentsByParticipant.get(selfIndex) ?? [];
  const feeLine = feeDescription(bill);

  return (
    <section className="space-y-5" aria-labelledby="room-breakdown-heading">
      <div className="border-b pb-5">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{statusLabel}</p>
        <div className="mt-2 flex flex-col gap-2">
          <h2
            id="room-breakdown-heading"
            ref={headingRef}
            tabIndex={-1}
            className="font-heading text-lg font-semibold outline-none"
          >
            {heading}
          </h2>
          <Money cents={bill.totalCents} className="text-4xl font-semibold tracking-tight" />
        </div>
        <dl className="mt-4 space-y-2 border-t pt-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Itens</dt>
            <dd><Money cents={subtotalCents} /></dd>
          </div>
          {serviceFeeCents > 0 && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Taxa de serviço</dt>
              <dd><Money cents={serviceFeeCents} /></dd>
            </div>
          )}
          {bill.fixedFeeCents > 0 && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Taxa fixa</dt>
              <dd><Money cents={bill.fixedFeeCents} /></dd>
            </div>
          )}
        </dl>
      </div>

      {selfIndex !== null && (
        <section
          aria-label="Sua parte"
          className="gradient-primary rounded-2xl p-5 text-primary-foreground"
        >
          <p className="text-sm font-medium opacity-90">Sua parte</p>
          <Money cents={selfShareCents} className="mt-1 block text-3xl font-bold" />
          <p className="mt-2 text-sm opacity-90">{itemsCountLine(selfAssignments.length)}</p>
          {feeLine && <p className="mt-0.5 text-xs opacity-75">{feeLine}</p>}
        </section>
      )}

      <div className="flex items-center gap-1 border-b" role="group" aria-label="Visualização da divisão">
        <Button type="button" variant="ghost" aria-pressed={detailView === "items"} className={cn("min-h-11 rounded-none border-x-0 border-t-0 border-b-2 border-b-transparent px-3", detailView === "items" && "border-b-primary text-primary-text")} onClick={() => setDetailView("items")}>
          Por item
        </Button>
        <Button type="button" variant="ghost" aria-pressed={detailView === "people"} className={cn("min-h-11 rounded-none border-x-0 border-t-0 border-b-2 border-b-transparent px-3", detailView === "people" && "border-b-primary text-primary-text")} onClick={() => setDetailView("people")}>
          Por pessoa
        </Button>
      </div>

      {detailView === "items" && (
        <section aria-label="Divisão por item" className="space-y-2">
          {bill.items.map((item, itemIndex) => (
            <article key={itemIndex} className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <h3 className="min-w-0 text-sm font-semibold wrap-anywhere">{item.description}</h3>
                <Money cents={item.totalPriceCents} className="shrink-0 text-sm font-semibold" />
              </div>
              <ul className="mt-3 space-y-2 border-t border-dashed pt-3">
                {(bill.itemAssignments ?? []).filter((assignment) => assignment.itemIndex === itemIndex).map((assignment) => {
                  const participant = bill.participants.find((person) => person.participantIndex === assignment.participantIndex);
                  return (
                    <li key={assignment.participantIndex} className="flex items-center gap-2 text-xs">
                      {participant && <UserAvatar name={participant.displayName} avatarUrl={participant.avatarUrl} size="xs" />}
                      <span className="min-w-0 flex-1 wrap-anywhere">{participant?.displayName ?? "Pessoa removida"}</span>
                      <Money cents={assignment.amountCents} className="shrink-0 font-semibold" />
                    </li>
                  );
                })}
              </ul>
              {bill.itemAssignments === null && <p className="mt-2 text-xs text-muted-foreground">As escolhas por item não estão disponíveis nesta conta.</p>}
            </article>
          ))}
        </section>
      )}

      <section hidden={detailView !== "people"} aria-label="Por pessoa">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 id="room-people-breakdown-heading" className="text-sm font-semibold">
            Sala de itens
          </h2>
          <Badge variant="outline" className="gap-1">
            <Lock aria-hidden className="size-3" />
            só leitura
          </Badge>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          Todo mundo na sala vê este quadro. Correções aparecem aqui e no detalhe da conta.
        </p>
        <ul className="space-y-2">
          {bill.participants.map((participant) => {
            const index = participant.participantIndex;
            const assignments = assignmentsByParticipant.get(index) ?? [];
            const itemCents = assignments.reduce((sum, assignment) => sum + assignment.amountCents, 0);
            const feeCents = bill.shares[index] - itemCents;
            const isSelf = index === selfIndex;
            const expanded = expandedParticipantIndex === index;
            const detailsId = `room-person-details-${index}`;
            return (
              <li
                key={index}
                className={cn(
                  "overflow-hidden rounded-2xl border bg-card",
                  isSelf && "border-primary/40 bg-primary/5",
                )}
              >
                <button
                  type="button"
                  className="flex min-h-14 w-full items-center gap-2 px-3 py-3 text-left"
                  aria-expanded={expanded}
                  aria-controls={detailsId}
                  onClick={() => setExpandedParticipantIndex(expanded ? null : index)}
                >
                  <UserAvatar name={participant.displayName} avatarUrl={participant.avatarUrl} size="sm" />
                  <span className="min-w-0 flex-1">
                    <PersonLabel name={participant.displayName} />
                    <span className="block text-xs text-muted-foreground">
                      {itemsCountLine(assignments.length)}
                    </span>
                  </span>
                  {isSelf && <span className="sr-only">Sua parte</span>}
                  <Money cents={bill.shares[index]} className="shrink-0" />
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground motion-safe:transition-transform",
                      expanded && "rotate-180",
                    )}
                  />
                </button>
                <div
                  id={detailsId}
                  hidden={!expanded}
                  className="space-y-2 border-t px-4 py-3 text-sm"
                >
                  {assignments.map((assignment) => (
                    <div key={assignment.itemIndex} className="flex justify-between gap-3">
                      <span className="text-muted-foreground">
                        {bill.items[assignment.itemIndex]?.description ?? "Item"}
                      </span>
                      <Money cents={assignment.amountCents} />
                    </div>
                  ))}
                  {feeCents > 0 && (
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">Taxas</span>
                      <Money cents={feeCents} />
                    </div>
                  )}
                  {assignments.length === 0 && bill.fixedFeeCents > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Sem consumo, com a parte da taxa fixa incluída.
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      {actionDescription && (
        <p className="text-sm text-muted-foreground">{actionDescription}</p>
      )}

      {onAction && (
        <Button
          type="button"
          className="min-h-11 w-full"
          disabled={actionDisabled}
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      )}
    </section>
  );
}
