"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ChevronRight, ListChecks, Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { ClaimerAvatars } from "@/components/assignment-room/claimer-avatars";
import { Money } from "@/components/shared/money";
import { SectionHeading } from "@/components/shared/section-heading";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ListRow, type ListRowProps } from "@/components/ui/list-row";
import { SectionCard } from "@/components/ui/section-card";
import { haptics } from "@/hooks/use-haptics";
import { fadeUp } from "@/lib/animations";
import type { OpenAssignmentRoom } from "@/types/assignment-room";
import type { HomeRoomCardItem } from "./home-selectors";

const COLLAPSED_ROOM_COUNT = 3;

interface HomeOpenRoomsCardProps {
  rooms: HomeRoomCardItem[];
  pendingRoomId: string | null;
  onOpen: (room: OpenAssignmentRoom) => void;
}

function HomeRoomRow({ item, pending, disabled, onOpen }: {
  item: HomeRoomCardItem;
  pending: boolean;
  disabled: boolean;
  onOpen: (room: OpenAssignmentRoom) => void;
}) {
  const { room, hostLabel, placeLabel } = item;
  const navigation: ListRowProps = item.kind === "hosted"
    ? { title: room.title, href: `/room/${room.id}` }
    : {
        title: room.title,
        disabled,
        onClick: () => {
          haptics.tap();
          onOpen(item.room);
        },
      };

  return (
    <ListRow
      {...navigation}
      subtitle={`${hostLabel} abriu · ${placeLabel}`}
      className="py-3"
      leading={
        <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-primary-text">
          <ListChecks aria-hidden="true" className="size-5" />
        </span>
      }
      trailing={
        <span className="flex flex-col items-end gap-1">
          <Money cents={room.totalCents} size="sm" />
          {pending ? (
            <Loader2 aria-label="Abrindo sala" className="size-4 text-muted-foreground motion-safe:animate-spin" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
          )}
        </span>
      }
      footer={
        <span className="flex min-w-0 items-center justify-between gap-3 pt-1 pl-13">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs font-normal tabular-nums text-muted-foreground">
              {room.ownedItemCount}/{room.itemCount} itens atribuídos
            </span>
            {room.status === "closed" && <Chip tone="neutral">Em revisão</Chip>}
          </span>
          <ClaimerAvatars claimers={room.claimers} />
        </span>
      }
    />
  );
}

export function HomeOpenRoomsCard({ rooms, pendingRoomId, onOpen }: HomeOpenRoomsCardProps) {
  const [expanded, setExpanded] = useState(false);
  const reducedMotion = useReducedMotion();
  const listId = useId();

  if (rooms.length === 0) return null;

  const visibleRooms = expanded ? rooms : rooms.slice(0, COLLAPSED_ROOM_COUNT);

  return (
    <motion.section
      aria-label="Suas salas"
      variants={fadeUp()}
      initial={reducedMotion ? false : "hidden"}
      animate="visible"
    >
      <SectionHeading title="Suas salas" count={rooms.length} />
      <SectionCard id={listId}>
        {visibleRooms.map((item) => (
          <HomeRoomRow
            key={item.room.id}
            item={item}
            pending={pendingRoomId === item.room.id}
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
