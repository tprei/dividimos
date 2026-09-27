"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ListChecks, Receipt } from "lucide-react";
import { useId, useState } from "react";
import { ClaimerAvatars, itemsWithOwnerText } from "@/components/assignment-room/claimer-avatars";
import { Money } from "@/components/shared/money";
import { SectionHeading } from "@/components/shared/section-heading";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ListRow } from "@/components/ui/list-row";
import { SectionCard } from "@/components/ui/section-card";
import { haptics } from "@/hooks/use-haptics";
import { fadeUp } from "@/lib/animations";
import type { AssignmentRoomStatus, HostedAssignmentRoom } from "@/types/assignment-room";

const COLLAPSED_ROOM_COUNT = 3;
const STATUS_LABELS: Record<AssignmentRoomStatus, string> = {
  open: "Em aberto",
  closed: "Em revisão",
  finalized: "Conta registrada",
  cancelled: "Cancelada",
};

interface HostedRoomsCardProps {
  rooms: HostedAssignmentRoom[];
}

function HostedRoomRow({ room }: { room: HostedAssignmentRoom }) {
  const inReview = room.status === "closed";
  const progressText = itemsWithOwnerText(room.ownedItemCount, room.itemCount);
  const progress = room.itemCount > 0 ? (room.ownedItemCount / room.itemCount) * 100 : 0;
  const Icon = inReview ? Receipt : ListChecks;

  return (
    <ListRow
      href={`/room/${room.id}`}
      title={room.title}
      subtitle={room.groupId === null ? "Sem grupo" : room.groupName ?? "Grupo"}
      className={inReview ? "bg-primary/5" : undefined}
      trailing={<Money cents={room.totalCents} size="sm" />}
      footer={
        <span className="flex flex-col gap-2 pt-1">
          <span className="flex items-center justify-between gap-2">
            <Chip tone={inReview ? "primary" : "neutral"} icon={<Icon />}>
              {STATUS_LABELS[room.status]}
            </Chip>
            <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-primary-text" />
          </span>
          {inReview && (
            <span className="text-sm font-semibold text-primary-text">Falta registrar a conta</span>
          )}
          <span className="flex items-center gap-3">
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-xs tabular-nums text-muted-foreground">{progressText}</span>
              <span
                role="progressbar"
                aria-label={`Itens com dono: ${room.title}`}
                aria-valuemin={0}
                aria-valuemax={Math.max(1, room.itemCount)}
                aria-valuenow={room.ownedItemCount}
                aria-valuetext={progressText}
                className="block h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <span className="block h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
              </span>
            </span>
            <ClaimerAvatars claimers={room.claimers} />
          </span>
        </span>
      }
    />
  );
}

export function HostedRoomsCard({ rooms }: HostedRoomsCardProps) {
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
        {visibleRooms.map((room) => <HostedRoomRow key={room.id} room={room} />)}
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
