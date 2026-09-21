"use client";

import { ChevronRight, Loader2 } from "lucide-react";
import { Money } from "@/components/shared/money";
import { UserAvatar } from "@/components/shared/user-avatar";
import { formatRoomTicks } from "@/lib/assignment-room-quantity";
import { ROOM_TICKS_PER_MILLIUNIT } from "@/lib/assignment-room-money";
import type {
  AssignmentRoomItem,
  AssignmentRoomParticipant,
} from "@/types/assignment-room";

/** Owner avatars shown before the row collapses the rest into a count. */
const VISIBLE_OWNERS = 3;

interface RoomItemRowProps {
  item: AssignmentRoomItem;
  availableTicks: number;
  ownTicks: number;
  owners: AssignmentRoomParticipant[];
  pending: boolean;
  disabled: boolean;
  mode: "host" | "available" | "mine";
  onOpen: (trigger: HTMLButtonElement) => void;
}

export function RoomItemRow({
  item,
  availableTicks,
  ownTicks,
  owners,
  pending,
  disabled,
  mode,
  onOpen,
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

  return (
    <li data-item-id={item.id}>
      <button
        type="button"
        disabled={disabled}
        aria-label={`${action}${ownerNames}`}
        onClick={(event) => onOpen(event.currentTarget)}
        className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 disabled:pointer-events-none disabled:opacity-60"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm leading-5 font-semibold wrap-anywhere">
            {item.description}
          </span>
          <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
            {availableTicks === 0
              ? "Tudo escolhido"
              : `Disponível: ${formatRoomTicks(availableTicks)} de ${original} un.`}
          </span>
          {ownTicks > 0 && (
            <span className="mt-0.5 block text-xs leading-4 font-semibold text-primary">
              Você: {formatRoomTicks(ownTicks)} un.
            </span>
          )}
          {pending && (
            <span
              role="status"
              className="mt-0.5 flex items-center gap-1 text-xs leading-4 text-muted-foreground"
            >
              <Loader2 className="size-3 animate-spin" />
              Salvando...
            </span>
          )}
        </span>
        {mode === "host" && owners.length > 0 && (
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
        <Money
          cents={item.totalPriceCents}
          className="shrink-0 text-sm font-semibold tabular-nums"
        />
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}
