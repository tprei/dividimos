"use client";

import { ChevronDown, ChevronUp, LogIn } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ExpenseItems } from "@/components/expense/expense-items";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { attributePayers } from "@/lib/expense-attribution";
import type { AssignmentBillBreakdown } from "@/types/assignment-room";

interface RoomBreakdownProps {
  bill: AssignmentBillBreakdown;
  roomId: string;
  showLogin?: boolean;
  heading?: string;
  statusLabel?: string;
}

function participantKey(
  participant: AssignmentBillBreakdown["participants"][number],
): string {
  return `${participant.displayName}\u0000${participant.avatarUrl ?? ""}\u0000${participant.isGuest}`;
}

export function RoomBreakdown({
  bill,
  roomId,
  showLogin = false,
  heading = "Conta registrada",
  statusLabel = "Conta registrada",
}: RoomBreakdownProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const peopleHeadingRef = useRef<HTMLHeadingElement>(null);
  const participantKeys = useMemo(
    () => new Set(bill.participants.map(participantKey)),
    [bill.participants],
  );

  useEffect(() => {
    if (!expandedKey || participantKeys.has(expandedKey)) return;
    const timer = setTimeout(() => {
      setExpandedKey(null);
      peopleHeadingRef.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [expandedKey, participantKeys]);

  const login = showLogin ? (
    <Button render={<Link href={`/auth?next=${encodeURIComponent(`/room/${roomId}`)}`} />} variant="outline" className="min-h-11 w-full">
      <LogIn className="size-4" />
      Entrar no Dividimos
    </Button>
  ) : null;

  if (bill.status === "deleted") {
    return (
      <section className="space-y-4 rounded-2xl border bg-card p-5">
        <div>
          <h2 className="font-heading text-lg font-semibold">Conta excluída</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Esta conta não entra mais nos saldos do grupo.
          </p>
        </div>
        {login}
      </section>
    );
  }

  const subtotalCents = bill.items.reduce((sum, item) => sum + item.totalPriceCents, 0);
  const serviceFeeCents = bill.totalCents - subtotalCents - bill.fixedFeeCents;
  const payers = attributePayers(bill.payers, bill.totalCents);
  const participantName = (index: number) =>
    bill.participants[index]?.displayName ?? "Participante";
  const participantAvatarUrl = (index: number) =>
    bill.participants[index]?.avatarUrl ?? null;
  const participantIsGuest = (index: number) =>
    bill.participants[index]?.isGuest ?? true;

  return (
    <section className="space-y-5" aria-labelledby="room-breakdown-heading">
      <div className="rounded-2xl border bg-card p-5">
        <p className="text-sm font-medium text-primary">{statusLabel}</p>
        <div className="mt-1 flex items-end justify-between gap-3">
          <h2 id="room-breakdown-heading" className="font-heading text-xl font-semibold">
            {heading}
          </h2>
          <Money cents={bill.totalCents} className="text-xl font-bold" />
        </div>
        <dl className="mt-4 space-y-2 border-t pt-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Itens</dt>
            <dd><Money cents={subtotalCents} /></dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Taxa de serviço</dt>
            <dd><Money cents={serviceFeeCents} /></dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Taxa fixa</dt>
            <dd><Money cents={bill.fixedFeeCents} /></dd>
          </div>
        </dl>
      </div>

      <ExpenseItems
        items={bill.items}
        itemAssignments={bill.itemAssignments}
        payers={payers}
        participantName={participantName}
        participantAvatarUrl={participantAvatarUrl}
        participantIsGuest={participantIsGuest}
      />

      <section aria-labelledby="room-people-breakdown-heading">
        <h2
          ref={peopleHeadingRef}
          id="room-people-breakdown-heading"
          tabIndex={-1}
          className="mb-2 text-sm font-semibold outline-none"
        >
          Por pessoa
        </h2>
        <ul className="space-y-2">
          {bill.participants.map((participant, index) => {
            const key = participantKey(participant);
            const expanded = expandedKey === key;
            const assignments = (bill.itemAssignments ?? []).filter(
              (assignment) => assignment.participantIndex === index,
            );
            const itemCents = assignments.reduce(
              (sum, assignment) => sum + assignment.amountCents,
              0,
            );
            const feeCents = bill.shares[index] - itemCents;
            return (
              <li key={key} className="overflow-hidden rounded-2xl border bg-card">
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-14 w-full justify-start rounded-none px-4"
                  aria-expanded={expanded}
                  onClick={() => setExpandedKey(expanded ? null : key)}
                >
                  <UserAvatar name={participant.displayName} avatarUrl={participant.avatarUrl} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-left font-semibold">
                    {participant.displayName}
                  </span>
                  <Money cents={bill.shares[index]} className="shrink-0" />
                  {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                </Button>
                {expanded && (
                  <div className="space-y-2 border-t px-4 py-3 text-sm">
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
                    {itemCents === 0 && bill.fixedFeeCents > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Sem consumo, com a parte da taxa fixa incluída.
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {login}
    </section>
  );
}
