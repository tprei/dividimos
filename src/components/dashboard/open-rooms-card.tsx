"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Loader2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
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
import { displayNames } from "@/lib/people";
import type { OpenAssignmentRoom } from "@/types/assignment-room";
import type { OpenRoomCardItem } from "./home-selectors";

const COLLAPSED_ROOM_COUNT = 3;

interface HomeOpenRoomsCardProps {
  rooms: OpenRoomCardItem[];
  pendingRoomId: string | null;
  onOpen: (room: OpenAssignmentRoom) => void;
}

function OpenRoomRow({ room, placeLabel, hostName, pending, disabled, onOpen }: OpenRoomCardItem & {
  hostName: string;
  pending: boolean;
  disabled: boolean;
  onOpen: (room: OpenAssignmentRoom) => void;
}) {
  return (
    <ListRow
      title={room.title}
      subtitle={`${hostName} · ${placeLabel}`}
      leading={
        <UserAvatar
          id={room.host.id}
          name={room.host.name}
          avatarUrl={room.host.avatarUrl}
          isBot={room.host.isBot}
        />
      }
      disabled={disabled}
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

export function HomeOpenRoomsCard({ rooms, pendingRoomId, onOpen }: HomeOpenRoomsCardProps) {
  const [expanded, setExpanded] = useState(false);
  const reducedMotion = useReducedMotion();
  const listId = useId();
  const hostNames = useMemo(
    () => displayNames(rooms.map((item) => item.room.host), { style: "short" }),
    [rooms],
  );

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
            hostName={hostNames.get(room.host.id) ?? room.host.name}
            pending={pendingRoomId === room.id}
            disabled={pendingRoomId !== null}
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
