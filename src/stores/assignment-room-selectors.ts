import type { AssignmentRoomAccess, AssignmentRoomSummary } from "@/types/assignment-room";
import type { AppState } from "./app-store";

export function selectAssignmentRoomSummary(
  state: AppState,
  roomId: string,
  embedded: AssignmentRoomSummary | null | undefined,
): AssignmentRoomSummary | null {
  const cached = state.assignmentRoomSummaries[roomId];
  if (cached === undefined) return embedded ?? null;
  if (embedded === undefined || embedded === null) return cached;
  return cached.revision >= embedded.revision ? cached : embedded;
}

export function selectAssignmentRoomAccess(
  state: AppState,
  summary: AssignmentRoomSummary,
  meId: string | null,
  embedded: AssignmentRoomAccess | undefined,
): AssignmentRoomAccess {
  const live = state.assignmentRoomAccess[summary.id];
  if (live !== undefined) return live;
  const listed =
    state.openAssignmentRoomsByGroupId[summary.groupId]?.some(
      (room) => room.id === summary.id && room.joined,
    ) ?? false;
  if (listed) return "joined";
  if (meId !== null && summary.claimers.some((claimer) => claimer.userId === meId)) {
    return "joined";
  }
  return embedded ?? "none";
}
