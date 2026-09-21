"use client";

import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { formatRoomTicks } from "@/lib/assignment-room-quantity";
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
}: RoomItemRowProps) {
  const capacityTicks = item.quantityMilliunits * ROOM_TICKS_PER_MILLIUNIT;
  const original = formatRoomTicks(capacityTicks);
  const visibleOwners = owners.slice(0, VISIBLE_OWNERS);
  const hiddenOwnerCount = owners.length - visibleOwners.length;
  const action =
    mode === "host"
      ? `Editar escolhas de ${item.description}`
      : `Escolher quantidade de ${item.description}`;
  const ownerNames =
    mode === "host" && owners.length > 0
      ? `. Com ${owners.map((owner) => owner.displayName).join(", ")}`
      : "";
  const taken = availableTicks === 0;

  return (
    <li data-item-id={item.id}>
      <div className="flex min-h-14 items-center gap-1 pr-2">
        <button
          type="button"
          disabled={disabled}
          aria-label={`${action}${ownerNames}`}
          onClick={(event) => onOpen(event.currentTarget)}
          className="flex min-h-14 min-w-0 flex-1 items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-[-2px] disabled:pointer-events-none disabled:opacity-60"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm leading-5 font-semibold wrap-anywhere">
              {item.description}
            </span>
            <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
              {mode === "mine"
                ? `Você: ${formatRoomTicks(ownTicks)} un. · toque para editar`
                : taken
                  ? "Tudo escolhido"
                  : `Restam ${formatRoomTicks(availableTicks)} de ${original} un.`}
            </span>
            {mode !== "mine" && ownTicks > 0 && (
              <span className="mt-1 inline-flex rounded-full bg-primary/15 px-2 text-[11px] font-semibold text-primary-text">
                Você: {formatRoomTicks(ownTicks)} un.
              </span>
            )}
            {pending && (
              <span role="status" className="mt-1 flex items-center gap-1 text-xs leading-4 text-muted-foreground">
                <Loader2 className="size-3 motion-safe:animate-spin" />
                Salvando...
              </span>
            )}
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            {mode !== "mine" ? (
              <Money cents={item.totalPriceCents} className="text-sm font-semibold tabular-nums" />
            ) : (
              <span className="text-xs font-medium text-muted-foreground">{formatRoomTicks(ownTicks)} un.</span>
            )}
          {mode !== "mine" && owners.length > 0 && (
            <span aria-hidden="true" className="flex shrink-0 items-center">
              {visibleOwners.map((owner) => (
                <UserAvatar
                  key={owner.id}
                  name={owner.displayName}
                  avatarUrl={owner.avatarUrl}
                  size="xs"
                  className="-ml-1.5 ring-2 ring-card first:ml-0"
                />
              ))}
              {hiddenOwnerCount > 0 && (
                <span className="-ml-1.5 flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-bold ring-2 ring-card">
                  +{hiddenOwnerCount}
                </span>
              )}
            </span>
          )}
          </span>
        </button>
        {onToggleDetails && (claims.length > 0 || (mode === "host" && availableTicks > 0)) && (
          <button
            type="button"
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            aria-expanded={expanded}
            aria-label={`${expanded ? "Ocultar" : "Ver"} escolhas de ${item.description}`}
            onClick={onToggleDetails}
          >
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        )}
      </div>
      {expanded && (claims.length > 0 || (mode === "host" && availableTicks > 0)) && (
        <ul className="space-y-1 border-t border-dashed bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          {claims
            .filter((claim) => claim.ticks > 0)
            .map((claim) => {
              const owner = owners.find((candidate) => candidate.id === claim.participantId);
              return (
                <li key={`${claim.itemId}:${claim.participantId}`} className="flex min-h-11 items-center justify-between gap-3">
                  {owner && <UserAvatar name={owner.displayName} avatarUrl={owner.avatarUrl} size="xs" />}
                  {mode === "host" && owner ? (
                    <button
                      type="button"
                      aria-label={`Editar escolha de ${owner.displayName}`}
                      disabled={disabled || pending}
                      className="min-h-11 min-w-0 flex-1 text-left font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-60"
                      onClick={(event) => onOpen(event.currentTarget, claim.participantId)}
                    >
                      {owner.displayName}
                    </button>
                  ) : (
                    <span className="min-w-0 truncate">{owner?.displayName ?? "Pessoa removida"}</span>
                  )}
                  <span className="shrink-0 font-medium">{formatRoomTicks(claim.ticks)} un.</span>
                </li>
              );
            })}
          {mode === "host" && availableTicks > 0 && (
            <li className="flex min-h-11 items-center justify-between gap-3 border-t pt-1">
              <button
                type="button"
                disabled={disabled || pending}
                className="min-h-11 font-medium text-primary-text underline-offset-2 hover:underline disabled:opacity-60"
                onClick={(event) => onOpen(event.currentTarget)}
              >
                Atribuir
              </button>
              <span className="shrink-0">{formatRoomTicks(availableTicks)} un. livres</span>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
