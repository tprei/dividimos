"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { ClaimerAvatars, itemsWithOwnerText } from "@/components/assignment-room/claimer-avatars";
import { Money } from "@/components/shared/money";
import { SectionHeading } from "@/components/shared/section-heading";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ListRow } from "@/components/ui/list-row";
import { SectionCard } from "@/components/ui/section-card";
import { haptics } from "@/hooks/use-haptics";
import { fadeUp } from "@/lib/animations";
import type { OpenAssignmentRoom } from "@/types/assignment-room";

const COLLAPSED_ROOM_COUNT = 3;

export interface OpenRoomCardItem {
  room: OpenAssignmentRoom;
  placeLabel: string;
}

interface OpenRoomsCardProps {
  rooms: OpenRoomCardItem[];
  pendingRoomId: string | null;
  onOpen: (room: OpenAssignmentRoom) => void;
}

function OpenRoomRow({ room, placeLabel, pending, onOpen }: OpenRoomCardItem & {
  pending: boolean;
  onOpen: (room: OpenAssignmentRoom) => void;
}) {
  return (
    <ListRow
      title={room.title}
      subtitle={`${room.host.name} · ${placeLabel}`}
      leading={
        <UserAvatar id={room.host.id} name={room.host.name} avatarUrl={room.host.avatarUrl} />
      }
      disabled={pending}
      className={room.joined ? "text-foreground" : "bg-accent/10 text-foreground"}
      onClick={() => {
        if (pending) return;
        haptics.tap();
        onOpen(room);
      }}
      footer={
        <span className="flex flex-col gap-2 pt-1">
          <span className="flex items-center justify-between gap-3">
            <span className="text-xs tabular-nums text-muted-foreground">
              {itemsWithOwnerText(room.ownedItemCount, room.itemCount)}
            </span>
            <ClaimerAvatars claimers={room.claimers} />
          </span>
          <span className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <Money cents={room.totalCents} size="sm" />
              {!room.joined && <Chip tone="neutral">Nova</Chip>}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-foreground" aria-live="polite">
              {pending ? "Abrindo…" : room.joined ? "Continuar" : "Entrar"}
              {pending ? (
                <Loader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />
              ) : (
                <ArrowRight aria-hidden="true" className="size-4" />
              )}
            </span>
          </span>
        </span>
      }
    />
  );
}

export function OpenRoomsCard({ rooms, pendingRoomId, onOpen }: OpenRoomsCardProps) {
  const [expanded, setExpanded] = useState(false);
  const reducedMotion = useReducedMotion();
  const listId = useId();

  if (rooms.length === 0) return null;

  const visibleRooms = expanded ? rooms : rooms.slice(0, COLLAPSED_ROOM_COUNT);

  return (
    <motion.section
      aria-label="Salas pra você"
      variants={fadeUp()}
      initial={reducedMotion ? false : "hidden"}
      animate="visible"
    >
      <SectionHeading title="Salas pra você" count={rooms.length} />
      <SectionCard id={listId}>
        {visibleRooms.map(({ room, placeLabel }) => (
          <OpenRoomRow
            key={room.id}
            room={room}
            placeLabel={placeLabel}
            pending={pendingRoomId === room.id}
            onOpen={onOpen}
          />
        ))}
        {rooms.length > COLLAPSED_ROOM_COUNT && (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 w-full rounded-none border-t border-border text-xs font-semibold text-muted-foreground"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => {
              haptics.selectionChanged();
              setExpanded(!expanded);
            }}
          >
            {expanded ? "Ver menos" : `Ver todas (${rooms.length})`}
          </Button>
        )}
      </SectionCard>
    </motion.section>
  );
}
