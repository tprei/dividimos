"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ClaimerAvatars, itemsWithOwnerText } from "@/components/assignment-room/claimer-avatars";
import { Money } from "@/components/shared/money";
import { SectionHeading } from "@/components/shared/section-heading";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ListRow } from "@/components/ui/list-row";
import { haptics } from "@/hooks/use-haptics";
import { fadeUp } from "@/lib/animations";
import { displayNames } from "@/lib/people";
import type { OpenAssignmentRoom } from "@/types/assignment-room";

const COLLAPSED_ROOM_COUNT = 3;

interface OpenRoomsCardProps {
  rooms: OpenAssignmentRoom[];
  viewerId: string;
  pendingRoomId: string | null;
  onOpenRoom: (room: OpenAssignmentRoom) => void;
}

type RoomCta = { label: string; tone: "primary" | "neutral"; busy: boolean };

function ctaFor(room: OpenAssignmentRoom, viewerId: string, pending: boolean): RoomCta {
  if (pending) return { label: "Abrindo…", tone: "neutral", busy: true };
  if (room.joined || room.host.id === viewerId) {
    return { label: "Ver conta", tone: "neutral", busy: false };
  }
  return { label: "Marcar meus itens", tone: "primary", busy: false };
}

function formatOccurredOn(occurredOn: string): string {
  return new Date(`${occurredOn.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "short",
  });
}

function OpenRoomRow({
  room,
  viewerId,
  pending,
  disabled,
  hostName,
  onOpenRoom,
}: {
  room: OpenAssignmentRoom;
  viewerId: string;
  pending: boolean;
  disabled: boolean;
  hostName: string;
  onOpenRoom: (room: OpenAssignmentRoom) => void;
}) {
  const cta = ctaFor(room, viewerId, pending);
  return (
    <ListRow
      onClick={() => {
        haptics.tap();
        onOpenRoom(room);
      }}
      disabled={disabled}
      title={room.title}
      subtitle={`${hostName} · ${formatOccurredOn(room.occurredOn)}`}
      footer={
        <span className="flex min-h-6 items-center gap-2 pl-11">
          <ClaimerAvatars claimers={room.claimers} />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {itemsWithOwnerText(room.ownedItemCount, room.itemCount)}
          </span>
        </span>
      }
      leading={
        <UserAvatar
          id={room.host.id}
          name={room.host.name}
          avatarUrl={room.host.avatarUrl}
          isBot={room.host.isBot}
          size="sm"
        />
      }
      trailing={
        <span className="flex flex-col items-end gap-1" aria-busy={pending}>
          <Money cents={room.totalCents} size="sm" />
          <Chip tone={cta.tone}>
            {cta.busy && <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />}
            {cta.label}
          </Chip>
        </span>
      }
    />
  );
}

export function OpenRoomsCard({ rooms, viewerId, pendingRoomId, onOpenRoom }: OpenRoomsCardProps) {
  const [expanded, setExpanded] = useState(false);
  const reducedMotion = useReducedMotion();
  const hostNames = useMemo(
    () => displayNames(rooms.map((room) => room.host), { style: "short", viewerId }),
    [rooms, viewerId],
  );

  if (rooms.length === 0) return null;

  const visibleRooms = expanded ? rooms : rooms.slice(0, COLLAPSED_ROOM_COUNT);
  const collapsible = rooms.length > COLLAPSED_ROOM_COUNT;

  return (
    <motion.section
      variants={fadeUp()}
      initial={reducedMotion ? false : "hidden"}
      animate="visible"
      className="mt-5"
    >
      <SectionHeading title="Contas abertas" count={rooms.length} />
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {visibleRooms.map((room) => (
          <OpenRoomRow
            key={room.id}
            room={room}
            viewerId={viewerId}
            pending={pendingRoomId === room.id}
            disabled={pendingRoomId !== null}
            hostName={hostNames.get(room.host.id) ?? room.host.name}
            onOpenRoom={onOpenRoom}
          />
        ))}
        {collapsible && (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 w-full rounded-none text-xs font-semibold text-muted-foreground"
            aria-expanded={expanded}
            onClick={() => {
              haptics.selectionChanged();
              setExpanded(!expanded);
            }}
          >
            {expanded ? "Ver menos" : `Ver todas (${rooms.length})`}
          </Button>
        )}
      </div>
    </motion.section>
  );
}
