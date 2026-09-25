"use client";

import { Activity } from "lucide-react";
import { useEffect, useState } from "react";
import { AvatarStack } from "@/components/shared/avatar-stack";
import { claimQuantityLabel, formatRoomTicks } from "@/lib/assignment-room-quantity";
import { ROOM_TICKS_PER_MILLIUNIT } from "@/lib/assignment-room-money";
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
  variant?: "default" | "ticker";
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


function tickerSummary(activity: AssignmentRoomActivity, participants: AssignmentRoomParticipant[], items: AssignmentRoomItem[]) {
  const first = (id: string) => participantName(id, participants).trim().split(/\s+/)[0];
  if (activity.kind === "joined" || activity.kind === "removed") {
    const names = activity.participantIds.map(first);
    const people = names.length < 3 ? names.join(" e ") : `${names[0]}, ${names[1]} e mais ${names.length - 2}`;
    return { name: people, text: activity.kind === "joined" ? (names.length === 1 ? " entrou" : " entraram") : (names.length === 1 ? " saiu da sala" : " saíram da sala") };
  }
  if (activity.kind === "claims") {
    const people = new Set(activity.changes.map((change) => change.participantId));
    if (activity.changes.length !== 1) {
      return people.size === 1
        ? { name: first(activity.changes[0].participantId), text: ` mudou ${new Set(activity.changes.map((change) => change.itemId)).size} itens` }
        : { text: `${activity.changes.length} escolhas mudaram` };
    }
    const change = activity.changes[0];
    const item = items.find((candidate) => candidate.id === change.itemId);
    const verb = change.afterTicks === 0 ? "desfez" : change.afterTicks > change.beforeTicks ? "pegou" : "mudou";
    const quantity = item && change.afterTicks > 0
      ? ` · ${claimQuantityLabel(item.quantityMilliunits, change.afterTicks)}${item.quantityMilliunits >= 2_000 ? ` de ${formatRoomTicks(item.quantityMilliunits * ROOM_TICKS_PER_MILLIUNIT)}` : ""}`
      : undefined;
    return { name: first(change.participantId), text: ` ${verb} ${item?.description ?? "item"}`, quantity };
  }
  if (activity.kind === "status") {
    return { text: activity.status === "cancelled" ? "Sala cancelada" : activity.status === "open" ? "Sala aberta" : "Sala encerrada" };
  }
  return { text: "Sala atualizada" };
}
export function RoomActivity({
  activity,
  participants,
  items,
  connected,
  live = true,
  variant = "default",
}: RoomActivityProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (variant !== "ticker") return;
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [variant]);
  if (!activity) return null;

  const observedAt = new Date(activity.observedAt);

  if (variant === "ticker") {
    const ticker = tickerSummary(activity, participants, items);
    return (
      <div className="flex min-h-11 min-w-0 items-center gap-2 rounded-xl bg-muted px-3 py-2 text-xs">
        <Activity className="size-4 shrink-0 text-primary-text" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate" aria-live={live ? "polite" : "off"}>
          {ticker.name && <strong className="font-semibold">{ticker.name}</strong>}{ticker.text}
          {"quantity" in ticker && <span className="text-muted-foreground">{ticker.quantity}</span>}
        </span>
        <time className="shrink-0 text-[11px] text-muted-foreground" dateTime={observedAt.toISOString()} title={observationLabel(activity.observedAt)}>
          {now - activity.observedAt < 60_000 ? "agora" : new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(observedAt)}
        </time>
      </div>
    );
  }
  const summary = activitySummary(activity, participants, items);
  const joinParticipants =
    activity.kind === "joined"
      ? activity.participantIds
          .map((id) => participants.find((participant) => participant.id === id))
          .filter((participant): participant is AssignmentRoomParticipant => participant !== undefined)
      : [];

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
      {joinParticipants.length > 0 ? (
        <span aria-hidden="true">
          <AvatarStack people={joinParticipants.map((person) => ({ ...person, name: person.displayName }))} surface="muted" />
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
        title={observationLabel(activity.observedAt)}
      >
        {new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(observedAt)}
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
