import type { ValidationResult } from "@/lib/expense-money";
import type { ExpenseDetail, WireIssue } from "@/types/ledger";
import {
  decodeExpenseDetail,
  exactKeys,
  fail,
  id,
  isRecord,
  ok,
  type Path,
} from "./decode-expense";

export interface AssignmentRoomExpenseMetadata {
  id: string;
  hostUserId: string;
}

export interface ExpenseContext {
  detail: ExpenseDetail;
  assignmentRoom: AssignmentRoomExpenseMetadata | null;
}

const CONTEXT_KEYS = ["detail", "assignmentRoom"] as const;
const ROOM_KEYS = ["id", "hostUserId"] as const;

export function decodeExpenseContext(
  raw: unknown,
  path: Path = []
): ValidationResult<ExpenseContext, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const keys = exactKeys(raw, CONTEXT_KEYS, path);
  if (!keys.ok) return keys;

  const detail = decodeExpenseDetail(raw.detail, [...path, "detail"]);
  if (!detail.ok) return detail;
  if (raw.assignmentRoom === null) {
    return ok({ detail: detail.value, assignmentRoom: null });
  }
  if (!isRecord(raw.assignmentRoom)) {
    return fail([...path, "assignmentRoom"]);
  }
  const roomKeys = exactKeys(
    raw.assignmentRoom,
    ROOM_KEYS,
    [...path, "assignmentRoom"]
  );
  if (!roomKeys.ok) return roomKeys;
  const roomId = id(raw.assignmentRoom.id, [...path, "assignmentRoom", "id"]);
  if (!roomId.ok) return roomId;
  const hostUserId = id(
    raw.assignmentRoom.hostUserId,
    [...path, "assignmentRoom", "hostUserId"]
  );
  if (!hostUserId.ok) return hostUserId;

  return ok({
    detail: detail.value,
    assignmentRoom: { id: roomId.value, hostUserId: hostUserId.value },
  });
}
