"use client";

import Link from "next/link";
import { ListChecks, Loader2 } from "lucide-react";
import { ClaimerAvatars, itemsWithOwnerText } from "@/components/assignment-room/claimer-avatars";
import { formatChatTime } from "@/components/chat/chat-rail-row";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { haptics } from "@/hooks/use-haptics";
import { cn } from "@/lib/utils";
import type { AssignmentRoomStatus, AssignmentRoomSummary } from "@/types/assignment-room";

interface RoomOpenedCardProps {
  summary: AssignmentRoomSummary;
  actorName: string;
  at: string;
  viewerId: string;
  joined: boolean;
  removed: boolean;
  pending: boolean;
  disabled: boolean;
  onOpenRoom: () => void;
}

const STATUS_LABELS: Partial<Record<AssignmentRoomStatus, { label: string; className: string }>> = {
  closed: { label: "Em revisão", className: "text-primary-text" },
  finalized: { label: "Conta registrada", className: "text-success-text" },
  cancelled: { label: "Cancelada", className: "text-muted-foreground" },
};

function openCtaLabel(marking: boolean, pending: boolean): string {
  if (pending) return "Abrindo…";
  return marking ? "Marcar meus itens" : "Ver conta";
}

export function RoomOpenedCard({
  summary,
  actorName,
  at,
  viewerId,
  joined,
  removed,
  pending,
  disabled,
  onOpenRoom,
}: RoomOpenedCardProps) {
  const cancelled = summary.status === "cancelled";
  const status = STATUS_LABELS[summary.status] ?? null;
  const viewerParticipates = joined || summary.host.id === viewerId;
  const marking = summary.status === "open" && !viewerParticipates;
  const closedCanView = summary.status === "closed" && viewerParticipates;
  const removedFromRoom = removed && (summary.status === "open" || summary.status === "closed");
  const billHref =
    summary.status === "finalized" && summary.expenseId !== null
      ? `/app/bill/${summary.expenseId}`
      : null;

  const handleOpen = () => {
    haptics.tap();
    onOpenRoom();
  };

  return (
    <div
      className="max-w-80 rounded-[0.75rem] border border-dashed border-border bg-card px-3 py-2"
      data-testid="room-opened-card"
    >
      <div className="flex items-center gap-2">
        <ListChecks
          aria-hidden="true"
          className={cn("size-4 shrink-0", cancelled ? "text-muted-foreground" : "text-primary-text")}
        />
        <p
          title={summary.title}
          className={cn("min-w-0 flex-1 truncate text-sm font-semibold", cancelled && "text-muted-foreground")}
        >
          {summary.title}
        </p>
        <Money cents={summary.totalCents} size="sm" className={cn(cancelled && "text-muted-foreground")} />
      </div>
      <div className="mt-0.5 flex items-baseline gap-2 pl-6">
        <p title={`${actorName} abriu`} className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {actorName} abriu
        </p>
        <time dateTime={at} className="shrink-0 text-2xs leading-4 tabular-nums text-muted-foreground">
          {formatChatTime(at)}
        </time>
      </div>
      {!cancelled && (
        <div className="mt-1.5 flex min-h-6 items-center gap-2 pl-6">
          <ClaimerAvatars claimers={summary.claimers} />
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {itemsWithOwnerText(summary.ownedItemCount, summary.itemCount)}
          </p>
        </div>
      )}
      {removedFromRoom && (
        <p className="mt-1.5 pl-6 text-xs font-semibold text-muted-foreground">
          Você foi removido dessa conta
        </p>
      )}
      {!removedFromRoom && (summary.status === "open" ? (
        <Button
          variant={marking ? "default" : "outline"}
          className="mt-2 h-11 w-full"
          disabled={pending || disabled}
          aria-busy={pending}
          onClick={handleOpen}
          data-testid="room-opened-card-action"
        >
          {pending && <Loader2 aria-hidden="true" className="motion-safe:animate-spin" />}
          {openCtaLabel(marking, pending)}
        </Button>
      ) : (
        <div className="mt-1.5 flex items-center justify-between gap-2 pl-6">
          {status && (
            <span className={cn("min-w-0 truncate text-xs font-semibold", status.className)}>
              {status.label}
            </span>
          )}
          {billHref !== null && (
            <Link
              href={billHref}
              className={buttonVariants({ variant: "outline", className: "h-11 shrink-0 px-4" })}
              data-testid="room-opened-card-link"
            >
              Ver conta
            </Link>
          )}
          {billHref === null && closedCanView && (
            <Button
              variant="outline"
              className="h-11 shrink-0 px-4"
              disabled={pending || disabled}
              aria-busy={pending}
              onClick={handleOpen}
              data-testid="room-opened-card-action"
            >
              {pending && <Loader2 aria-hidden="true" className="motion-safe:animate-spin" />}
              {pending ? "Abrindo…" : "Ver conta"}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
