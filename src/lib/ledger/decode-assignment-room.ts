import type { ValidationResult } from "@/lib/expense-money";
import type {
  AssignmentBillBreakdown,
  AssignmentGroupTarget,
  AssignmentRoomClaim,
  AssignmentRoomItem,
  AssignmentRoomParticipant,
  AssignmentRoomSnapshot,
  AssignmentRoomView,
} from "@/types/assignment-room";
import type {
  ExpenseDetail,
  MutationAck,
  ParticipantRef,
  WireIssue,
} from "@/types/ledger";
import { decodeMutationAck } from "./decode";
import {
  arrayOf,
  bool,
  decodeExpenseItemAssignmentPayload,
  decodeExpenseItemPayload,
  decodeExpensePayerPayload,
  decodeParticipantRef,
  decodeExpenseDetail,
  exactKeys,
  fail,
  id,
  int,
  isRecord,
  nullableStr,
  ok,
  oneOf,
  str,
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

export interface FinalizeAssignmentRoomResult {
  room: AssignmentRoomView;
  ack: MutationAck;
}

const CONTEXT_KEYS = ["detail", "assignmentRoom"] as const;
const ROOM_METADATA_KEYS = ["id", "hostUserId"] as const;
const SNAPSHOT_KEYS = [
  "id",
  "revision",
  "status",
  "title",
  "occurredOn",
  "serviceFeeBasisPoints",
  "fixedFeeCents",
  "totalCents",
  "selfParticipantId",
  "items",
  "participants",
  "claims",
  "topic",
  "currentBill",
] as const;
const ITEM_KEYS = [
  "id",
  "ordinal",
  "revision",
  "description",
  "quantityMilliunits",
  "unitPriceCents",
  "totalPriceCents",
] as const;
const PARTICIPANT_KEYS = [
  "id",
  "ordinal",
  "displayName",
  "avatarUrl",
  "isGuest",
  "removed",
] as const;
const CLAIM_KEYS = ["itemId", "participantId", "ticks"] as const;
const BILL_KEYS = [
  "status",
  "versionNo",
  "title",
  "occurredOn",
  "items",
  "itemAssignments",
  "participants",
  "shares",
  "payers",
  "totalCents",
  "serviceFeeBasisPoints",
  "fixedFeeCents",
] as const;
const BILL_PARTICIPANT_KEYS = [
  "participantIndex",
  "displayName",
  "avatarUrl",
  "isGuest",
] as const;

function decodeRoomItem(
  raw: unknown,
  path: Path
): ValidationResult<AssignmentRoomItem, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const keys = exactKeys(raw, ITEM_KEYS, path);
  if (!keys.ok) return keys;
  const expenseItem = decodeExpenseItemPayload(
    {
      description: raw.description,
      quantityMilliunits: raw.quantityMilliunits,
      unitPriceCents: raw.unitPriceCents,
      totalPriceCents: raw.totalPriceCents,
    },
    path
  );
  if (!expenseItem.ok) return expenseItem;
  const itemId = id(raw.id, [...path, "id"]);
  if (!itemId.ok) return itemId;
  const ordinal = int(raw.ordinal, [...path, "ordinal"]);
  if (!ordinal.ok) return ordinal;
  const revision = int(raw.revision, [...path, "revision"]);
  if (!revision.ok) return revision;
  return ok({
    ...expenseItem.value,
    id: itemId.value,
    ordinal: ordinal.value,
    revision: revision.value,
  });
}

function decodeRoomParticipant(
  raw: unknown,
  path: Path
): ValidationResult<AssignmentRoomParticipant, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const keys = exactKeys(raw, PARTICIPANT_KEYS, path);
  if (!keys.ok) return keys;
  const participantId = id(raw.id, [...path, "id"]);
  if (!participantId.ok) return participantId;
  const ordinal = int(raw.ordinal, [...path, "ordinal"]);
  if (!ordinal.ok) return ordinal;
  const displayName = str(raw.displayName, [...path, "displayName"]);
  if (!displayName.ok) return displayName;
  const avatarUrl = nullableStr(raw.avatarUrl, [...path, "avatarUrl"]);
  if (!avatarUrl.ok) return avatarUrl;
  const isGuest = bool(raw.isGuest, [...path, "isGuest"]);
  if (!isGuest.ok) return isGuest;
  const removed = bool(raw.removed, [...path, "removed"]);
  if (!removed.ok) return removed;
  return ok({
    id: participantId.value,
    ordinal: ordinal.value,
    displayName: displayName.value,
    avatarUrl: avatarUrl.value,
    isGuest: isGuest.value,
    removed: removed.value,
  });
}

function decodeRoomClaim(
  raw: unknown,
  path: Path
): ValidationResult<AssignmentRoomClaim, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const keys = exactKeys(raw, CLAIM_KEYS, path);
  if (!keys.ok) return keys;
  const itemId = id(raw.itemId, [...path, "itemId"]);
  if (!itemId.ok) return itemId;
  const participantId = id(raw.participantId, [...path, "participantId"]);
  if (!participantId.ok) return participantId;
  const ticks = int(raw.ticks, [...path, "ticks"]);
  if (!ticks.ok) return ticks;
  return ok({
    itemId: itemId.value,
    participantId: participantId.value,
    ticks: ticks.value,
  });
}

function decodeBillParticipant(raw: unknown, path: Path) {
  if (!isRecord(raw)) return fail<AssignmentBillBreakdown["participants"][number]>(path);
  const keys = exactKeys(raw, BILL_PARTICIPANT_KEYS, path);
  if (!keys.ok) return keys;
  const participantIndex = int(raw.participantIndex, [...path, "participantIndex"]);
  if (!participantIndex.ok) return participantIndex;
  const displayName = str(raw.displayName, [...path, "displayName"]);
  if (!displayName.ok) return displayName;
  const avatarUrl = nullableStr(raw.avatarUrl, [...path, "avatarUrl"]);
  if (!avatarUrl.ok) return avatarUrl;
  const isGuest = bool(raw.isGuest, [...path, "isGuest"]);
  if (!isGuest.ok) return isGuest;
  return ok({
    participantIndex: participantIndex.value,
    displayName: displayName.value,
    avatarUrl: avatarUrl.value,
    isGuest: isGuest.value,
  });
}

function decodeBill(
  raw: unknown,
  path: Path
): ValidationResult<AssignmentBillBreakdown, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const keys = exactKeys(raw, BILL_KEYS, path);
  if (!keys.ok) return keys;
  const status = oneOf(raw.status, ["active", "deleted"] as const, [...path, "status"]);
  if (!status.ok) return status;
  const versionNo = int(raw.versionNo, [...path, "versionNo"]);
  if (!versionNo.ok) return versionNo;
  const title = str(raw.title, [...path, "title"]);
  if (!title.ok) return title;
  const occurredOn = str(raw.occurredOn, [...path, "occurredOn"]);
  if (!occurredOn.ok) return occurredOn;
  const items = arrayOf(raw.items, [...path, "items"], decodeExpenseItemPayload);
  if (!items.ok) return items;
  const itemAssignments =
    raw.itemAssignments === null
      ? ok(null)
      : arrayOf(
          raw.itemAssignments,
          [...path, "itemAssignments"],
          decodeExpenseItemAssignmentPayload
        );
  if (!itemAssignments.ok) return itemAssignments;
  const participants = arrayOf(
    raw.participants,
    [...path, "participants"],
    decodeBillParticipant
  );
  if (!participants.ok) return participants;
  const shares = arrayOf(raw.shares, [...path, "shares"], int);
  if (!shares.ok) return shares;
  const payers = arrayOf(raw.payers, [...path, "payers"], decodeExpensePayerPayload);
  if (!payers.ok) return payers;
  const totalCents = int(raw.totalCents, [...path, "totalCents"]);
  if (!totalCents.ok) return totalCents;
  const serviceFeeBasisPoints = int(
    raw.serviceFeeBasisPoints,
    [...path, "serviceFeeBasisPoints"]
  );
  if (!serviceFeeBasisPoints.ok) return serviceFeeBasisPoints;
  const fixedFeeCents = int(raw.fixedFeeCents, [...path, "fixedFeeCents"]);
  if (!fixedFeeCents.ok) return fixedFeeCents;
  return ok({
    status: status.value,
    versionNo: versionNo.value,
    title: title.value,
    occurredOn: occurredOn.value,
    items: items.value,
    itemAssignments: itemAssignments.value,
    participants: participants.value,
    shares: shares.value,
    payers: payers.value,
    totalCents: totalCents.value,
    serviceFeeBasisPoints: serviceFeeBasisPoints.value,
    fixedFeeCents: fixedFeeCents.value,
  });
}

function decodeSnapshot(
  raw: unknown,
  path: Path
): ValidationResult<AssignmentRoomSnapshot, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const keys = exactKeys(raw, SNAPSHOT_KEYS, path);
  if (!keys.ok) return keys;
  const roomId = id(raw.id, [...path, "id"]);
  if (!roomId.ok) return roomId;
  const revision = int(raw.revision, [...path, "revision"]);
  if (!revision.ok) return revision;
  const status = oneOf(
    raw.status,
    ["open", "closed", "finalized", "cancelled"] as const,
    [...path, "status"]
  );
  if (!status.ok) return status;
  const title = str(raw.title, [...path, "title"]);
  if (!title.ok) return title;
  const occurredOn = str(raw.occurredOn, [...path, "occurredOn"]);
  if (!occurredOn.ok) return occurredOn;
  const serviceFeeBasisPoints = int(
    raw.serviceFeeBasisPoints,
    [...path, "serviceFeeBasisPoints"]
  );
  if (!serviceFeeBasisPoints.ok) return serviceFeeBasisPoints;
  const fixedFeeCents = int(raw.fixedFeeCents, [...path, "fixedFeeCents"]);
  if (!fixedFeeCents.ok) return fixedFeeCents;
  const totalCents = int(raw.totalCents, [...path, "totalCents"]);
  if (!totalCents.ok) return totalCents;
  const selfParticipantId = id(raw.selfParticipantId, [...path, "selfParticipantId"]);
  if (!selfParticipantId.ok) return selfParticipantId;
  const items = arrayOf(raw.items, [...path, "items"], decodeRoomItem);
  if (!items.ok) return items;
  const participants = arrayOf(
    raw.participants,
    [...path, "participants"],
    decodeRoomParticipant
  );
  if (!participants.ok) return participants;
  const claims = arrayOf(raw.claims, [...path, "claims"], decodeRoomClaim);
  if (!claims.ok) return claims;
  const topic = nullableStr(raw.topic, [...path, "topic"]);
  if (!topic.ok) return topic;
  const currentBill =
    raw.currentBill === null
      ? ok(null)
      : decodeBill(raw.currentBill, [...path, "currentBill"]);
  if (!currentBill.ok) return currentBill;
  return ok({
    id: roomId.value,
    revision: revision.value,
    status: status.value,
    title: title.value,
    occurredOn: occurredOn.value,
    serviceFeeBasisPoints: serviceFeeBasisPoints.value,
    fixedFeeCents: fixedFeeCents.value,
    totalCents: totalCents.value,
    selfParticipantId: selfParticipantId.value,
    items: items.value,
    participants: participants.value,
    claims: claims.value,
    topic: topic.value,
    currentBill: currentBill.value,
  });
}

function decodeGroupTarget(
  raw: unknown,
  path: Path
): ValidationResult<AssignmentGroupTarget, WireIssue> {
  if (!isRecord(raw) || typeof raw.kind !== "string") return fail(path);
  if (raw.kind === "existing") {
    const keys = exactKeys(raw, ["kind", "groupId"], path);
    if (!keys.ok) return keys;
    const groupId = id(raw.groupId, [...path, "groupId"]);
    return groupId.ok ? ok({ kind: "existing", groupId: groupId.value }) : groupId;
  }
  if (raw.kind === "new") {
    const keys = exactKeys(raw, ["kind", "name"], path);
    if (!keys.ok) return keys;
    const name = str(raw.name, [...path, "name"]);
    return name.ok ? ok({ kind: "new", name: name.value }) : name;
  }
  return fail([...path, "kind"]);
}

export function decodeAssignmentRoomView(
  raw: unknown,
  path: Path = []
): ValidationResult<AssignmentRoomView, WireIssue> {
  if (!isRecord(raw) || (raw.role !== "host" && raw.role !== "participant")) {
    return fail(path);
  }
  const expected =
    raw.role === "host"
      ? (["role", "room", "groupTarget", "participantRefs"] as const)
      : (["role", "room"] as const);
  const keys = exactKeys(raw, expected, path);
  if (!keys.ok) return keys;
  const room = decodeSnapshot(raw.room, [...path, "room"]);
  if (!room.ok) return room;
  if (raw.role === "participant") return ok({ role: "participant", room: room.value });
  const groupTarget = decodeGroupTarget(raw.groupTarget, [...path, "groupTarget"]);
  if (!groupTarget.ok) return groupTarget;
  const participantRefs = arrayOf<{ participantId: string; ref: ParticipantRef }>(
    raw.participantRefs,
    [...path, "participantRefs"],
    (entry, entryPath) => {
      if (!isRecord(entry)) return fail(entryPath);
      const entryKeys = exactKeys(entry, ["participantId", "ref"], entryPath);
      if (!entryKeys.ok) return entryKeys;
      const participantId = id(entry.participantId, [...entryPath, "participantId"]);
      if (!participantId.ok) return participantId;
      const ref = decodeParticipantRef(entry.ref, [...entryPath, "ref"]);
      return ref.ok ? ok({ participantId: participantId.value, ref: ref.value }) : ref;
    }
  );
  if (!participantRefs.ok) return participantRefs;
  return ok({
    role: "host",
    room: room.value,
    groupTarget: groupTarget.value,
    participantRefs: participantRefs.value,
  });
}

export function decodeFinalizeAssignmentRoomResult(
  raw: unknown,
  path: Path = []
): ValidationResult<FinalizeAssignmentRoomResult, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const keys = exactKeys(raw, ["room", "ack"], path);
  if (!keys.ok) return keys;
  const room = decodeAssignmentRoomView(raw.room, [...path, "room"]);
  if (!room.ok) return room;
  const ack = decodeMutationAck(raw.ack, [...path, "ack"]);
  return ack.ok ? ok({ room: room.value, ack: ack.value }) : ack;
}

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
    ROOM_METADATA_KEYS,
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
