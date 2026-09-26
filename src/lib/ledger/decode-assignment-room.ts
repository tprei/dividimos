import type { ValidationResult } from "@/lib/expense-money";
import type {
  AssignmentBillBreakdown,
  AssignmentGroupTarget,
  AssignmentRoomClaim,
  AssignmentRoomCompletion,
  AssignmentRoomCompletionAction,
  AssignmentRoomItem,
  AssignmentRoomParticipant,
  AssignmentRoomSnapshot,
  AssignmentRoomSummary,
  AssignmentRoomClaimer,
  AssignmentRoomView,
  OpenAssignmentRoom,
} from "@/types/assignment-room";
import type {
  MutationAck,
  ExpenseDetail,
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
  decodeUserProfile,
  decodeExpenseDetail,
  exactKeys,
  fail,
  id,
  int,
  isRecord,
  nullableId,
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
const ROOM_SUMMARY_KEYS = [
  "id",
  "groupId",
  "status",
  "revision",
  "title",
  "occurredOn",
  "totalCents",
  "host",
  "createdAt",
  "itemCount",
  "ownedItemCount",
  "claimers",
  "expenseId",
] as const;
const OPEN_ROOM_KEYS = [...ROOM_SUMMARY_KEYS, "joined"] as const;
const CLAIMER_KEYS = ["participantId", "userId", "name", "avatarUrl"] as const;
const ROOM_STATUSES = ["open", "closed", "finalized", "cancelled"] as const;

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

function decodeAssignmentRoomCompletionAction(
  raw: unknown,
  path: Path,
): ValidationResult<AssignmentRoomCompletionAction, WireIssue> {
  if (!isRecord(raw) || typeof raw.kind !== "string") return fail(path);
  if (raw.kind === "view_expense" || raw.kind === "accept_invitation") {
    const keys = exactKeys(raw, ["kind", "expenseId", "groupId"], path);
    if (!keys.ok) return keys;
    const expenseId = id(raw.expenseId, [...path, "expenseId"]);
    if (!expenseId.ok) return expenseId;
    const groupId = id(raw.groupId, [...path, "groupId"]);
    if (!groupId.ok) return groupId;
    return raw.kind === "view_expense"
      ? ok({ kind: "view_expense", expenseId: expenseId.value, groupId: groupId.value })
      : ok({ kind: "accept_invitation", expenseId: expenseId.value, groupId: groupId.value });
  }
  if (
    raw.kind === "claim_guest" ||
    raw.kind === "sign_in" ||
    raw.kind === "unavailable"
  ) {
    const keys = exactKeys(raw, ["kind"], path);
    if (!keys.ok) return keys;
    return ok({ kind: raw.kind });
  }
  return fail([...path, "kind"]);
}

export function decodeAssignmentRoomCompletion(
  raw: unknown,
  path: Path = [],
): ValidationResult<AssignmentRoomCompletion, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const keys = exactKeys(raw, ["roomId", "bill", "selfParticipantIndex", "action"], path);
  if (!keys.ok) return keys;
  const roomId = id(raw.roomId, [...path, "roomId"]);
  if (!roomId.ok) return roomId;
  const bill = decodeBill(raw.bill, [...path, "bill"]);
  if (!bill.ok) return bill;
  const selfParticipantIndex =
    raw.selfParticipantIndex === null
      ? ok(null)
      : int(raw.selfParticipantIndex, [...path, "selfParticipantIndex"]);
  if (!selfParticipantIndex.ok) return selfParticipantIndex;
  const action = decodeAssignmentRoomCompletionAction(raw.action, [...path, "action"]);
  if (!action.ok) return action;
  return ok({
    roomId: roomId.value,
    bill: bill.value,
    selfParticipantIndex: selfParticipantIndex.value,
    action: action.value,
  });
}

export function decodeAssignmentRoomGuestClaimResult(
  raw: unknown,
  path: Path = [],
): ValidationResult<MutationAck, WireIssue> {
  return decodeMutationAck(raw, path);
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

function nonnegativeCount(
  raw: unknown,
  path: Path
): ValidationResult<number, WireIssue> {
  const value = int(raw, path);
  if (!value.ok) return value;
  return value.value >= 0 && Number.isSafeInteger(value.value) ? value : fail(path);
}

function decodeClaimer(
  raw: unknown,
  path: Path
): ValidationResult<AssignmentRoomClaimer, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const keys = exactKeys(raw, CLAIMER_KEYS, path);
  if (!keys.ok) return keys;
  const participantId = id(raw.participantId, [...path, "participantId"]);
  if (!participantId.ok) return participantId;
  const userId = nullableId(raw.userId, [...path, "userId"]);
  if (!userId.ok) return userId;
  const name = str(raw.name, [...path, "name"]);
  if (!name.ok) return name;
  const avatarUrl = nullableStr(raw.avatarUrl, [...path, "avatarUrl"]);
  if (!avatarUrl.ok) return avatarUrl;
  return ok({
    participantId: participantId.value,
    userId: userId.value,
    name: name.value,
    avatarUrl: avatarUrl.value,
  });
}

function decodeSummaryFields(
  raw: Record<string, unknown>,
  path: Path
): ValidationResult<AssignmentRoomSummary, WireIssue> {
  const roomId = id(raw.id, [...path, "id"]);
  if (!roomId.ok) return roomId;
  const groupId = id(raw.groupId, [...path, "groupId"]);
  if (!groupId.ok) return groupId;
  const status = oneOf(raw.status, ROOM_STATUSES, [...path, "status"]);
  if (!status.ok) return status;
  const revision = nonnegativeCount(raw.revision, [...path, "revision"]);
  if (!revision.ok) return revision;
  const title = str(raw.title, [...path, "title"]);
  if (!title.ok) return title;
  const occurredOn = str(raw.occurredOn, [...path, "occurredOn"]);
  if (!occurredOn.ok) return occurredOn;
  const totalCents = nonnegativeCount(raw.totalCents, [...path, "totalCents"]);
  if (!totalCents.ok) return totalCents;
  const host = decodeUserProfile(raw.host, [...path, "host"]);
  if (!host.ok) return host;
  const createdAt = str(raw.createdAt, [...path, "createdAt"]);
  if (!createdAt.ok) return createdAt;
  const itemCount = nonnegativeCount(raw.itemCount, [...path, "itemCount"]);
  if (!itemCount.ok) return itemCount;
  const ownedItemCount = nonnegativeCount(raw.ownedItemCount, [...path, "ownedItemCount"]);
  if (!ownedItemCount.ok) return ownedItemCount;
  const claimers = arrayOf(raw.claimers, [...path, "claimers"], decodeClaimer);
  if (!claimers.ok) return claimers;
  const expenseId = nullableId(raw.expenseId, [...path, "expenseId"]);
  if (!expenseId.ok) return expenseId;
  return ok({
    id: roomId.value,
    groupId: groupId.value,
    status: status.value,
    revision: revision.value,
    title: title.value,
    occurredOn: occurredOn.value,
    totalCents: totalCents.value,
    host: host.value,
    createdAt: createdAt.value,
    itemCount: itemCount.value,
    ownedItemCount: ownedItemCount.value,
    claimers: claimers.value,
    expenseId: expenseId.value,
  });
}

export function decodeAssignmentRoomSummary(
  raw: unknown,
  path: Path = []
): ValidationResult<AssignmentRoomSummary, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const keys = exactKeys(raw, ROOM_SUMMARY_KEYS, path);
  if (!keys.ok) return keys;
  return decodeSummaryFields(raw, path);
}

function decodeOpenAssignmentRoom(
  raw: unknown,
  path: Path
): ValidationResult<OpenAssignmentRoom, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const keys = exactKeys(raw, OPEN_ROOM_KEYS, path);
  if (!keys.ok) return keys;
  const summary = decodeSummaryFields(raw, path);
  if (!summary.ok) return summary;
  const joined = bool(raw.joined, [...path, "joined"]);
  if (!joined.ok) return joined;
  return ok({ ...summary.value, joined: joined.value });
}

export function decodeOpenAssignmentRooms(
  raw: unknown,
  path: Path = []
): ValidationResult<OpenAssignmentRoom[], WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const keys = exactKeys(raw, ["rooms"], path);
  if (!keys.ok) return keys;
  return arrayOf(raw.rooms, [...path, "rooms"], decodeOpenAssignmentRoom);
}
