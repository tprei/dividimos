"use client";

import { Activity } from "lucide-react";
import { UserAvatar } from "@/components/shared/user-avatar";
import type {
  AssignmentRoomActivity,
  AssignmentRoomItem,
  AssignmentRoomParticipant,
} from "@/types/assignment-room";

interface RoomActivityProps {
  activity: AssignmentRoomActivity | null;
  participants: AssignmentRoomParticipant[];
  items: AssignmentRoomItem[];
  connected: boolean;
  live?: boolean;
}

function participantName(
  participantId: string,
  participants: AssignmentRoomParticipant[],
): string {
  return participants.find((participant) => participant.id === participantId)?.displayName ?? "Alguém";
}

function joinedSummary(
  participantIds: string[],
  participants: AssignmentRoomParticipant[],
): string {
  const names = participantIds.map((id) => participantName(id, participants));
  if (names.length === 1) return `${names[0]} entrou`;
  if (names.length === 2) return `${names[0]} e ${names[1]} entraram`;
  return `${names[0]}, ${names[1]} e mais ${names.length - 2} entraram`;
}

function activitySummary(
  activity: AssignmentRoomActivity,
  participants: AssignmentRoomParticipant[],
  items: AssignmentRoomItem[],
): string {
  if (activity.kind === "joined") return joinedSummary(activity.participantIds, participants);
  if (activity.kind === "removed") {
    const names = activity.participantIds.map((id) => participantName(id, participants));
    return names.length === 1
      ? `${names[0]} não está mais na sala`
      : `${names.join(", ")} não estão mais na sala`;
  }
  if (activity.kind === "claims") {
    if (activity.changes.length !== 1) {
      return `Escolhas de ${activity.changes.length} itens atualizadas`;
    }
    const change = activity.changes[0];
    const participant = participantName(change.participantId, participants);
    const item = items.find((candidate) => candidate.id === change.itemId)?.description ?? "item";
    return `Escolha de ${participant} em ${item} atualizada`;
  }
  if (activity.kind === "status") {
    if (activity.status === "open") return "Sala aberta";
    if (activity.status === "closed") return "Escolhas encerradas";
    if (activity.status === "finalized") return "Sala finalizada";
    return "Sala cancelada";
  }
  return "Sala atualizada";
}

function observationLabel(observedAt: number): string {
  return `Visto às ${new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(observedAt))}`;
}

export function RoomActivity({
  activity,
  participants,
  items,
  connected,
  live = true,
}: RoomActivityProps) {
  if (!activity) return null;

  const summary = activitySummary(activity, participants, items);
  const observedAt = new Date(activity.observedAt);
  const joinParticipants =
    activity.kind === "joined"
      ? activity.participantIds
          .map((id) => participants.find((participant) => participant.id === id))
          .filter((participant): participant is AssignmentRoomParticipant => participant !== undefined)
      : [];

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
      {joinParticipants.length > 0 ? (
        <span className="flex shrink-0" aria-hidden="true">
          {joinParticipants.slice(0, 3).map((participant, index) => (
            <span key={participant.id} className={index > 0 ? "-ml-1" : undefined}>
              <UserAvatar
                name={participant.displayName}
                avatarUrl={participant.avatarUrl}
                size="xs"
              />
            </span>
          ))}
        </span>
      ) : (
        <Activity className="size-4 shrink-0 text-primary" aria-hidden="true" />
      )}
      <span
        className="min-w-0 flex-1 truncate font-medium text-foreground"
        aria-live={live ? "polite" : "off"}
      >
        {summary}
      </span>
      <time
        className="shrink-0 whitespace-nowrap text-[11px]"
        dateTime={observedAt.toISOString()}
        title={observedAt.toLocaleString("pt-BR")}
      >
        {observationLabel(activity.observedAt)}
      </time>
      {connected && (
        <span
          className="size-2 shrink-0 rounded-full bg-success"
          aria-label="Conectado"
          title="Conectado"
        />
      )}
    </div>
  );
}
