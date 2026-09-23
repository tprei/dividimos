"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { cn } from "@/lib/utils";
import type { AssignmentBillBreakdown } from "@/types/assignment-room";

export interface RoomFinalBoardProps {
  bill: AssignmentBillBreakdown;
  selfParticipantIndex?: number | null;
}

export function RoomFinalBoard({ bill, selfParticipantIndex = null }: RoomFinalBoardProps) {
  const id = useId();
  const regionRef = useRef<HTMLElement>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(selfParticipantIndex);
  const expandedPresent = bill.participants.some((person) => person.participantIndex === expandedIndex);

  useEffect(() => {
    if (expandedIndex !== null && !expandedPresent) regionRef.current?.focus();
  }, [expandedIndex, expandedPresent]);

  const assignmentsByParticipant = new Map<number, NonNullable<AssignmentBillBreakdown["itemAssignments"]>>();
  for (const assignment of bill.itemAssignments ?? []) {
    const assignments = assignmentsByParticipant.get(assignment.participantIndex);
    if (assignments) assignments.push(assignment);
    else assignmentsByParticipant.set(assignment.participantIndex, [assignment]);
  }

  return (
    <section ref={regionRef} aria-label="Por pessoa" tabIndex={-1} className="rounded-2xl focus-visible:outline-2 focus-visible:outline-ring">
      <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
        {bill.participants.map((participant) => {
          const index = participant.participantIndex;
          const assignments = assignmentsByParticipant.get(index) ?? [];
          const expanded = expandedIndex === index;
          const isSelf = index === selfParticipantIndex;
          const detailsId = `${id}-person-${index}`;
          return (
            <li key={index} className={cn(isSelf && "bg-primary/10")}>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={detailsId}
                onClick={() => setExpandedIndex(expanded ? null : index)}
                className="flex min-h-18 w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <UserAvatar name={participant.displayName} avatarUrl={participant.avatarUrl} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium wrap-anywhere">{participant.displayName}</span>
                  <span className="block text-xs text-muted-foreground">{assignments.length} {assignments.length === 1 ? "item" : "itens"}</span>
                </span>
                {isSelf && <span className="sr-only">Sua parte</span>}
                <Money cents={bill.shares[index]} className="shrink-0 text-sm font-semibold" />
              </button>
              <div id={detailsId} hidden={!expanded} className="mr-4 ml-15 border-t border-dashed py-3">
                {assignments.map((assignment) => (
                  <div key={assignment.itemIndex} className="flex items-baseline justify-between gap-3 py-1 text-sm">
                    <span className="min-w-0 wrap-anywhere">{bill.items[assignment.itemIndex]?.description ?? "Item"}</span>
                    <Money cents={assignment.amountCents} className="shrink-0" />
                  </div>
                ))}
                {bill.itemAssignments === null && <p className="text-xs text-muted-foreground">Escolhas indisponíveis</p>}
                {bill.itemAssignments !== null && assignments.length === 0 && <p className="text-xs text-muted-foreground">Sem itens</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}