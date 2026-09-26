"use client";

import { ChatRailRow } from "@/components/chat/chat-rail-row";
import { RoomOpenedCard } from "@/components/chat/room-opened-card";
import type { OpenableGroupRoom } from "@/hooks/use-open-group-room";
import { useAppStore } from "@/stores/app-store";
import {
  selectAssignmentRoomAccess,
  selectAssignmentRoomSummary,
} from "@/stores/assignment-room-selectors";
import type { GroupEvent } from "@/types/ledger";

interface RoomOpenedEventProps {
  event: GroupEvent;
  meId: string;
  actorName: string;
  spaced: boolean;
  pendingRoomId: string | null;
  onOpenRoom: (room: OpenableGroupRoom) => void;
}

export function RoomOpenedEvent({
  event,
  meId,
  actorName,
  spaced,
  pendingRoomId,
  onOpenRoom,
}: RoomOpenedEventProps) {
  const payloadRoomId = event.payload.roomId;
  const roomId = typeof payloadRoomId === "string" ? payloadRoomId : "";
  const summary = useAppStore((state) =>
    selectAssignmentRoomSummary(state, roomId, event.assignmentRoom),
  );
  const access = useAppStore((state) =>
    summary === null
      ? "none"
      : selectAssignmentRoomAccess(state, summary, meId, event.assignmentRoomAccess),
  );
  if (summary === null) return null;

  return (
    <ChatRailRow marker={{ kind: "expense" }} spaced={spaced}>
      <RoomOpenedCard
        summary={summary}
        actorName={actorName}
        at={event.createdAt}
        viewerId={meId}
        joined={access === "joined"}
        removed={access === "removed"}
        pending={pendingRoomId === summary.id}
        disabled={pendingRoomId !== null}
        onOpenRoom={() => onOpenRoom(summary)}
      />
    </ChatRailRow>
  );
}
