"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ChevronDown, Loader2, Undo2 } from "lucide-react";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { GuestAvatar } from "@/components/shared/guest-avatar";
import { AvatarStack } from "@/components/shared/avatar-stack";
import { claimQuantityLabel, formatRoomTicks } from "@/lib/assignment-room-quantity";
import { ROOM_TICKS_PER_MILLIUNIT } from "@/lib/assignment-room-money";
import type { RoomItemMoney } from "@/lib/assignment-room-projection";
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
  claimMoney?: RoomItemMoney["claims"];
  selfParticipantId?: string;
  onUndoParticipant?: (participantId: string) => void;
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
  claimMoney,
  selfParticipantId,
  onUndoParticipant,
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
        transition={{ duration: 0.2, ease: "easeOut" }}
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
                {ownTicks > 0 && <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-primary-foreground">Você: {ownLabel}</span>}
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
          {visibleOwners.length > 0 && (
            <span aria-hidden="true" className="flex items-center py-0.5 pl-0.5">
              <AvatarStack people={visibleOwners.map((owner) => ({ ...owner, name: owner.displayName }))} />
            </span>
          )}
          {availableTicks > 0 && <span className="rounded-full bg-primary/25 px-2 py-0.5 text-xs font-semibold text-primary-text">{owners.length === 0 ? "Sem dono" : multiUnit ? `${formatRoomTicks(availableTicks)} sobrando` : "incompleto"}</span>}
        </span>
        <ChevronDown aria-hidden="true" className={`size-4 shrink-0 text-muted-foreground motion-safe:transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-dashed bg-muted/30 px-3 py-3">
          <ul className="space-y-1">
            {claims.filter((claim) => claim.ticks > 0).map((claim) => {
              const owner = owners.find((candidate) => candidate.id === claim.participantId);
              if (!owner) return null;
              const amount = claimMoney?.find((entry) => entry.participantId === claim.participantId);
              const percent = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 }).format(claim.ticks / capacityTicks);
              const width = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 2 }).format(claim.ticks / capacityTicks);
              return (
                <li key={claim.participantId} className="flex items-center gap-1">
                  <button type="button" aria-label={`Mudar ${item.description} de ${owner.displayName}`} disabled={disabled || pending} onClick={(event) => onOpen(event.currentTarget, owner.id)} className="flex min-h-14 min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60">
                    {owner.isGuest
                      ? <GuestAvatar id={owner.id} name={owner.displayName} size="sm" />
                      : <UserAvatar id={owner.id} name={owner.displayName} avatarUrl={owner.avatarUrl} size="sm" />}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2 text-xs"><span className="truncate font-medium">{owner.id === selfParticipantId ? "Você" : owner.displayName}</span><span className="shrink-0 text-muted-foreground">{claimQuantityLabel(item.quantityMilliunits, claim.ticks)}{multiUnit ? ` de ${original}` : ""}</span></span>
                      <span className="mt-1 flex items-center gap-2"><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width }} /></span><span className="text-xs text-muted-foreground tabular-nums">{percent}</span></span>
                    </span>
                    {amount && <Money cents={amount.amountCents} className="shrink-0 text-xs font-medium tabular-nums" />}
                  </button>
                  <button type="button" aria-label={`Desfazer ${item.description} de ${owner.displayName}`} disabled={disabled || pending} onClick={() => onUndoParticipant?.(owner.id)} className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40"><Undo2 aria-hidden="true" className="size-4" /></button>
                </li>
              );
            })}
          </ul>
          {availableTicks > 0 && <button type="button" disabled={disabled || pending} className="min-h-11 w-full rounded-xl border bg-card px-3 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50" onClick={(event) => onOpen(event.currentTarget)}>{owners.length > 0 ? "Atribuir o que sobrou" : "Atribuir a alguém"}</button>}
        </div>
      )}
    </li>
  );
}
