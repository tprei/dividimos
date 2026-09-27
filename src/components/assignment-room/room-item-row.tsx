"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ChevronDown, Loader2, Undo2 } from "lucide-react";
import { Money } from "@/components/shared/money";
import type { ReactNode } from "react";
import { PersonShareButton } from "@/components/bill/person-toggle";
import { shareToPercent } from "@/lib/assignment-room-split";
import { AvatarStack } from "@/components/shared/avatar-stack";
import { Chip } from "@/components/ui/chip";
import { springs } from "@/lib/animations";
import { claimQuantityLabel, formatRoomTicks } from "@/lib/assignment-room-quantity";
import { ROOM_TICKS_PER_MILLIUNIT } from "@/lib/assignment-room-money";
import type {
  AssignmentRoomClaim,
  AssignmentRoomItem,
  AssignmentRoomParticipant,
} from "@/types/assignment-room";

const VISIBLE_OWNERS = 3;

interface RoomItemRowProps {
  item: AssignmentRoomItem;
  availableTicks: number;
  ownTicks: number;
  owners: AssignmentRoomParticipant[];
  pending: boolean;
  disabled: boolean;
  mode: "host" | "available" | "mine";
  claims?: AssignmentRoomClaim[];
  expanded?: boolean;
  onOpen: (trigger: HTMLButtonElement, participantId?: string) => void;
  onToggleDetails?: () => void;
  money?: { lineCents: number; unitCents: number; ownCents: number };
  onUndo?: () => void;
  labels?: ReadonlyMap<string, string>;
  editor?: ReactNode;
  onFocusParticipant?: (participantId: string) => void;
}

export function RoomItemRow({
  item,
  availableTicks,
  ownTicks,
  owners,
  pending,
  disabled,
  mode,
  claims = [],
  expanded = false,
  onOpen,
  onToggleDetails,
  money,
  onUndo,
  labels,
  editor,
  onFocusParticipant,
}: RoomItemRowProps) {
  const reducedMotion = useReducedMotion();
  const capacityTicks = item.quantityMilliunits * ROOM_TICKS_PER_MILLIUNIT;
  const original = formatRoomTicks(capacityTicks);
  const visibleOwners = owners.slice(0, VISIBLE_OWNERS);
  const action = `Escolher quantidade de ${item.description}`;
  const ownLabel = claimQuantityLabel(item.quantityMilliunits, ownTicks);
  const multiUnit = item.quantityMilliunits >= 2_000;

  if (mode !== "host") {
    return (
      <motion.li
        data-item-id={item.id}
        initial={false}
        exit={reducedMotion ? undefined : { height: 0, opacity: 0 }}
        transition={springs.snappy}
        className="overflow-hidden"
      >
        <div className="flex min-h-14 items-center">
          <button
            type="button"
            disabled={disabled || pending}
            aria-label={action}
            onClick={(event) => onOpen(event.currentTarget)}
            className="flex min-h-14 min-w-0 flex-1 items-center gap-2 px-4 py-2 text-left hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary disabled:pointer-events-none"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-base leading-5 font-semibold wrap-anywhere">{item.description}</span>
              {mode === "available" && (
                <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                  {multiUnit ? (
                    <>Restam {formatRoomTicks(availableTicks)} de {original}{money && <> · <Money cents={money.unitCents} />/un</>}</>
                  ) : availableTicks === capacityTicks ? "Inteira" : (
                    <>Falta {claimQuantityLabel(item.quantityMilliunits, availableTicks)}</>
                  )}
                </span>
              )}
              {pending && <span role="status" className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 aria-hidden="true" className="size-3 motion-safe:animate-spin" />Salvando...</span>}
            </span>
            {mode === "mine" ? (
              <>
                <span className="shrink-0 text-xs text-muted-foreground">{ownLabel}{multiUnit ? ` de ${original}` : ""}</span>
                {money && <Money cents={money.ownCents} className="shrink-0 text-sm font-medium tabular-nums" />}
              </>
            ) : (
              <span className="flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 max-[380px]:max-w-32">
                {visibleOwners.length > 0 && (
                  <span aria-hidden="true" className="flex shrink-0 items-center py-0.5 pl-0.5">
                    <AvatarStack people={visibleOwners.map((owner) => ({ ...owner, name: owner.displayName }))} />
                  </span>
                )}
                {ownTicks > 0 && <Chip className="border-transparent bg-primary text-primary-foreground">Você: {ownLabel}</Chip>}
                {money && <Money cents={money.lineCents} className="text-sm font-medium tabular-nums" />}
              </span>
            )}
          </button>
          {mode === "mine" && onUndo && (
            <button type="button" disabled={disabled || pending} onClick={onUndo} aria-label={`Desfazer ${item.description}`} className="mr-1 flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40">
              <Undo2 className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </motion.li>
    );
  }

  return (
    <li data-item-id={item.id}>
      <button
        type="button"
        aria-label={item.description}
        aria-expanded={expanded}
        onClick={onToggleDetails}
        className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-base leading-5 font-semibold wrap-anywhere">{item.description}</span>
          <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
            {multiUnit ? <>{original}× {money && <Money cents={money.unitCents} />}{availableTicks > 0 && <> · restam {formatRoomTicks(availableTicks)}</>}</> : "inteira"}
          </span>
          {pending && <span role="status" className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 aria-hidden="true" className="size-3 motion-safe:animate-spin" />Salvando...</span>}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {money && <Money cents={money.lineCents} className="text-sm font-medium tabular-nums" />}
          {availableTicks > 0 && <Chip tone="neutral">{owners.length === 0 ? "Sem dono" : multiUnit ? `${formatRoomTicks(availableTicks)} sobrando` : "incompleto"}</Chip>}
        </span>
        <ChevronDown aria-hidden="true" className={`size-4 shrink-0 text-muted-foreground motion-safe:transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {!expanded && owners.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pb-3">
          {owners.map((owner) => {
            const ticks = claims.find((claim) => claim.participantId === owner.id)?.ticks ?? 0;
            const sweepDegrees = shareToPercent(capacityTicks, ticks) * 3.6;
            return <PersonShareButton key={owner.id} id={owner.id} name={owner.displayName} label={`Ajustar ${labels?.get(owner.id) ?? owner.displayName}`} avatarUrl={owner.avatarUrl} isGuest={owner.isGuest} selected arc={{ startDegrees: 0, sweepDegrees }} onOpen={() => onFocusParticipant?.(owner.id)} />;
          })}
        </div>
      )}
      {expanded && editor}
    </li>
  );
}
