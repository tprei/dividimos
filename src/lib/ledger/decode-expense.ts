import type { ValidationResult } from "@/lib/expense-money";
import type {
  ChangeSummary,
  ExpenseDetail,
  ExpenseGroupSummary,
  ExpenseItemAssignmentPayload,
  ExpenseItemPayload,
  ExpensePayerPayload,
  ExpensePayload,
  ExpenseSplitMethod,
  ExpenseRecord,
  ExpenseStatus,
  ExpenseSummary,
  ExpenseType,
  ExpenseVersion,
  GroupKind,
  GuestParticipant,
  Participant,
  ParticipantKind,
  ParticipantRef,
  UserProfile,
  WireIssue,
} from "@/types/ledger";

export type Path = readonly (string | number)[];

export function ok<T>(value: T): ValidationResult<T, WireIssue> {
  return { ok: true, value };
}

export function fail<T>(path: Path): ValidationResult<T, WireIssue> {
  return { ok: false, issue: { code: "invalid_wire", path } };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function exactKeys(
  raw: Record<string, unknown>,
  expected: readonly string[],
  path: Path,
  /**
   * Keys that may appear but are not required. Rows written before a field
   * existed do not carry it, and refusing them would make old expenses
   * unreadable.
   */
  optional: readonly string[] = [],
): ValidationResult<true, WireIssue> {
  for (let i = 0; i < expected.length; i++) {
    if (!(expected[i] in raw)) return fail([...path, expected[i]]);
  }
  const keys = Object.keys(raw);
  for (let i = 0; i < keys.length; i++) {
    if (!expected.includes(keys[i]) && !optional.includes(keys[i])) {
      return fail([...path, keys[i]]);
    }
  }
  return ok(true);
}

export function str(val: unknown, path: Path): ValidationResult<string, WireIssue> {
  return typeof val === "string" ? ok(val) : fail(path);
}

export function id(val: unknown, path: Path): ValidationResult<string, WireIssue> {
  return typeof val === "string" && val.length > 0 ? ok(val) : fail(path);
}

export function nullableStr(
  val: unknown,
  path: Path,
): ValidationResult<string | null, WireIssue> {
  return val === null ? ok(null) : typeof val === "string" ? ok(val) : fail(path);
}

export function nullableId(
  val: unknown,
  path: Path,
): ValidationResult<string | null, WireIssue> {
  return val === null ? ok(null) : typeof val === "string" && val.length > 0 ? ok(val) : fail(path);
}

export function int(val: unknown, path: Path): ValidationResult<number, WireIssue> {
  return typeof val === "number" && Number.isFinite(val) && Number.isInteger(val)
    ? ok(val)
    : fail(path);
}

export function nullableInt(
  val: unknown,
  path: Path,
): ValidationResult<number | null, WireIssue> {
  return val === null
    ? ok(null)
    : typeof val === "number" && Number.isFinite(val) && Number.isInteger(val)
      ? ok(val)
      : fail(path);
}

export function bool(val: unknown, path: Path): ValidationResult<boolean, WireIssue> {
  return typeof val === "boolean" ? ok(val) : fail(path);
}

export function oneOf<T extends string>(
  val: unknown,
  allowed: readonly T[],
  path: Path,
): ValidationResult<T, WireIssue> {
  return typeof val === "string" && (allowed as readonly string[]).includes(val)
    ? ok(val as T)
    : fail(path);
}

export function arrayOf<T>(
  raw: unknown,
  path: Path,
  decoder: (item: unknown, itemPath: Path) => ValidationResult<T, WireIssue>,
): ValidationResult<T[], WireIssue> {
  if (!Array.isArray(raw)) return fail(path);
  const result: T[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = decoder(raw[i], [...path, i]);
    if (!item.ok) return item;
    result.push(item.value);
  }
  return ok(result);
}

const USER_PROFILE_KEYS = ["id", "handle", "name", "avatarUrl"] as const;

export function decodeUserProfile(
  raw: unknown,
  path: Path = [],
): ValidationResult<UserProfile, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, USER_PROFILE_KEYS, path);
  if (!k.ok) return k;
  const i = id(raw.id, [...path, "id"]);
  if (!i.ok) return i;
  const h = str(raw.handle, [...path, "handle"]);
  if (!h.ok) return h;
  const n = str(raw.name, [...path, "name"]);
  if (!n.ok) return n;
  const a = nullableStr(raw.avatarUrl, [...path, "avatarUrl"]);
  if (!a.ok) return a;
  return ok({ id: i.value, handle: h.value, name: n.value, avatarUrl: a.value });
}

export function decodeUserProfileOrNull(
  raw: unknown,
  path: Path = [],
): ValidationResult<UserProfile | null, WireIssue> {
  if (raw === null) return ok(null);
  return decodeUserProfile(raw, path);
}

const EXPENSE_TYPES: readonly ExpenseType[] = ["itemized", "single_amount"];
const EXPENSE_STATUSES: readonly ExpenseStatus[] = ["active", "deleted"];
const GROUP_KINDS: readonly GroupKind[] = ["group", "dm"];
const PARTICIPANT_KINDS: readonly ParticipantKind[] = ["user", "guest"];

const EXPENSE_ITEM_KEYS = [
  "description",
  "quantityMilliunits",
  "unitPriceCents",
  "totalPriceCents",
] as const;

export function decodeExpenseItemPayload(
  raw: unknown,
  path: Path = [],
): ValidationResult<ExpenseItemPayload, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, EXPENSE_ITEM_KEYS, path);
  if (!k.ok) return k;
  const desc = str(raw.description, [...path, "description"]);
  if (!desc.ok) return desc;
  const qty = int(raw.quantityMilliunits, [...path, "quantityMilliunits"]);
  if (!qty.ok) return qty;
  const unit = int(raw.unitPriceCents, [...path, "unitPriceCents"]);
  if (!unit.ok) return unit;
  const total = int(raw.totalPriceCents, [...path, "totalPriceCents"]);
  if (!total.ok) return total;
  return ok({
    description: desc.value,
    quantityMilliunits: qty.value,
    unitPriceCents: unit.value,
    totalPriceCents: total.value,
  });
}

const USER_REF_KEYS = ["kind", "userId"] as const;
const GUEST_REF_KEYS = ["kind", "guestId", "displayName"] as const;

export function decodeParticipantRef(
  raw: unknown,
  path: Path = [],
): ValidationResult<ParticipantRef, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  if (raw.kind === "user") {
    const k = exactKeys(raw, USER_REF_KEYS, path);
    if (!k.ok) return k;
    const u = id(raw.userId, [...path, "userId"]);
    if (!u.ok) return u;
    return ok({ kind: "user", userId: u.value });
  }
  if (raw.kind === "guest") {
    const k = exactKeys(raw, GUEST_REF_KEYS, path);
    if (!k.ok) return k;
    const g = nullableId(raw.guestId, [...path, "guestId"]);
    if (!g.ok) return g;
    const d = str(raw.displayName, [...path, "displayName"]);
    if (!d.ok) return d;
    return ok({ kind: "guest", guestId: g.value, displayName: d.value });
  }
  return fail([...path, "kind"]);
}

const PAYER_KEYS = ["participantIndex", "amountCents"] as const;

export function decodeExpensePayerPayload(
  raw: unknown,
  path: Path = [],
): ValidationResult<ExpensePayerPayload, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, PAYER_KEYS, path);
  if (!k.ok) return k;
  const idx = int(raw.participantIndex, [...path, "participantIndex"]);
  if (!idx.ok) return idx;
  const amt = int(raw.amountCents, [...path, "amountCents"]);
  if (!amt.ok) return amt;
  return ok({ participantIndex: idx.value, amountCents: amt.value });
}

const ITEM_ASSIGNMENT_KEYS = ["itemIndex", "participantIndex", "amountCents"] as const;

export function decodeExpenseItemAssignmentPayload(
  raw: unknown,
  path: Path = [],
): ValidationResult<ExpenseItemAssignmentPayload, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, ITEM_ASSIGNMENT_KEYS, path);
  if (!k.ok) return k;
  const itemIdx = int(raw.itemIndex, [...path, "itemIndex"]);
  if (!itemIdx.ok) return itemIdx;
  const partIdx = int(raw.participantIndex, [...path, "participantIndex"]);
  if (!partIdx.ok) return partIdx;
  const amt = int(raw.amountCents, [...path, "amountCents"]);
  if (!amt.ok) return amt;
  return ok({
    itemIndex: itemIdx.value,
    participantIndex: partIdx.value,
    amountCents: amt.value,
  });
}

const EXPENSE_PAYLOAD_KEYS = [
  "items",
  "participants",
  "shares",
  "payers",
  "itemAssignments",
] as const;

// Recorded since the authored split method landed; older versions predate it.
const EXPENSE_PAYLOAD_OPTIONAL_KEYS = ["splitMethod"] as const;

const SPLIT_METHODS: readonly ExpenseSplitMethod[] = ["equal", "percentage", "fixed"];

export function decodeExpensePayload(
  raw: unknown,
  path: Path = [],
): ValidationResult<ExpensePayload, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, EXPENSE_PAYLOAD_KEYS, path, EXPENSE_PAYLOAD_OPTIONAL_KEYS);
  if (!k.ok) return k;

  const items = arrayOf(raw.items, [...path, "items"], decodeExpenseItemPayload);
  if (!items.ok) return items;
  const participants = arrayOf(
    raw.participants,
    [...path, "participants"],
    decodeParticipantRef,
  );
  if (!participants.ok) return participants;
  const shares = arrayOf(raw.shares, [...path, "shares"], int);
  if (!shares.ok) return shares;
  const payers = arrayOf(raw.payers, [...path, "payers"], decodeExpensePayerPayload);
  if (!payers.ok) return payers;

  let itemAssignments: ExpenseItemAssignmentPayload[] | null = null;
  if (raw.itemAssignments !== null) {
    const assignmentsRes = arrayOf(
      raw.itemAssignments,
      [...path, "itemAssignments"],
      decodeExpenseItemAssignmentPayload,
    );
    if (!assignmentsRes.ok) return assignmentsRes;
    itemAssignments = assignmentsRes.value;
  }

  // Versions written before the method was recorded have no key at all, and
  // the server sends null when it does not apply, so both mean "not stated".
  let splitMethod: ExpenseSplitMethod | null = null;
  if (raw.splitMethod !== undefined && raw.splitMethod !== null) {
    if (
      typeof raw.splitMethod !== "string" ||
      !SPLIT_METHODS.includes(raw.splitMethod as ExpenseSplitMethod)
    ) {
      return fail([...path, "splitMethod"]);
    }
    splitMethod = raw.splitMethod as ExpenseSplitMethod;
  }

  return ok({
    items: items.value,
    participants: participants.value,
    shares: shares.value,
    payers: payers.value,
    itemAssignments,
    splitMethod,
  });
}

const CHANGE_SUMMARY_KEYS = [
  "title",
  "totalCents",
  "participantsAdded",
  "participantsRemoved",
  "payersChanged",
] as const;

export function decodeChangeSummary(
  raw: unknown,
  path: Path = [],
): ValidationResult<ChangeSummary, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, CHANGE_SUMMARY_KEYS, path);
  if (!k.ok) return k;

  let title: [string, string] | null = null;
  if (raw.title !== null) {
    if (!Array.isArray(raw.title) || raw.title.length !== 2) {
      return fail([...path, "title"]);
    }
    const t0 = str(raw.title[0], [...path, "title", 0]);
    if (!t0.ok) return t0;
    const t1 = str(raw.title[1], [...path, "title", 1]);
    if (!t1.ok) return t1;
    title = [t0.value, t1.value];
  }

  let totalCents: [number, number] | null = null;
  if (raw.totalCents !== null) {
    if (!Array.isArray(raw.totalCents) || raw.totalCents.length !== 2) {
      return fail([...path, "totalCents"]);
    }
    const c0 = int(raw.totalCents[0], [...path, "totalCents", 0]);
    if (!c0.ok) return c0;
    const c1 = int(raw.totalCents[1], [...path, "totalCents", 1]);
    if (!c1.ok) return c1;
    totalCents = [c0.value, c1.value];
  }

  const added = arrayOf(raw.participantsAdded, [...path, "participantsAdded"], str);
  if (!added.ok) return added;
  const removed = arrayOf(
    raw.participantsRemoved,
    [...path, "participantsRemoved"],
    str,
  );
  if (!removed.ok) return removed;
  const payersChanged = bool(raw.payersChanged, [...path, "payersChanged"]);
  if (!payersChanged.ok) return payersChanged;

  return ok({
    title,
    totalCents,
    participantsAdded: added.value,
    participantsRemoved: removed.value,
    payersChanged: payersChanged.value,
  });
}

const EXPENSE_VERSION_KEYS = [
  "expenseId",
  "versionNo",
  "authorId",
  "createdAt",
  "occurredOn",
  "title",
  "merchantName",
  "expenseType",
  "totalCents",
  "serviceFeeBasisPoints",
  "fixedFeeCents",
  "payload",
  "changeSummary",
] as const;

export function decodeExpenseVersion(
  raw: unknown,
  path: Path = [],
): ValidationResult<ExpenseVersion, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, EXPENSE_VERSION_KEYS, path);
  if (!k.ok) return k;

  const expenseId = id(raw.expenseId, [...path, "expenseId"]);
  if (!expenseId.ok) return expenseId;
  const versionNo = int(raw.versionNo, [...path, "versionNo"]);
  if (!versionNo.ok) return versionNo;
  const authorId = id(raw.authorId, [...path, "authorId"]);
  if (!authorId.ok) return authorId;
  const createdAt = str(raw.createdAt, [...path, "createdAt"]);
  if (!createdAt.ok) return createdAt;
  const occurredOn = str(raw.occurredOn, [...path, "occurredOn"]);
  if (!occurredOn.ok) return occurredOn;
  const title = str(raw.title, [...path, "title"]);
  if (!title.ok) return title;
  const merchantName = nullableStr(raw.merchantName, [...path, "merchantName"]);
  if (!merchantName.ok) return merchantName;
  const expenseType = oneOf(raw.expenseType, EXPENSE_TYPES, [...path, "expenseType"]);
  if (!expenseType.ok) return expenseType;
  const totalCents = int(raw.totalCents, [...path, "totalCents"]);
  if (!totalCents.ok) return totalCents;
  const bps = int(raw.serviceFeeBasisPoints, [...path, "serviceFeeBasisPoints"]);
  if (!bps.ok) return bps;
  const fixed = int(raw.fixedFeeCents, [...path, "fixedFeeCents"]);
  if (!fixed.ok) return fixed;
  const payload = decodeExpensePayload(raw.payload, [...path, "payload"]);
  if (!payload.ok) return payload;

  let changeSummary: ChangeSummary | null = null;
  if (raw.changeSummary !== null) {
    const cs = decodeChangeSummary(raw.changeSummary, [...path, "changeSummary"]);
    if (!cs.ok) return cs;
    changeSummary = cs.value;
  }

  return ok({
    expenseId: expenseId.value,
    versionNo: versionNo.value,
    authorId: authorId.value,
    createdAt: createdAt.value,
    occurredOn: occurredOn.value,
    title: title.value,
    merchantName: merchantName.value,
    expenseType: expenseType.value,
    totalCents: totalCents.value,
    serviceFeeBasisPoints: bps.value,
    fixedFeeCents: fixed.value,
    payload: payload.value,
    changeSummary,
  });
}

const EXPENSE_SUMMARY_KEYS = [
  "id",
  "groupId",
  "creatorId",
  "status",
  "occurredOn",
  "createdAt",
  "versionNo",
  "title",
  "merchantName",
  "expenseType",
  "totalCents",
  "myShareCents",
  "myPaidCents",
  "participantCount",
] as const;

export function decodeExpenseSummary(
  raw: unknown,
  path: Path = [],
): ValidationResult<ExpenseSummary, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, EXPENSE_SUMMARY_KEYS, path);
  if (!k.ok) return k;

  const eid = id(raw.id, [...path, "id"]);
  if (!eid.ok) return eid;
  const gid = id(raw.groupId, [...path, "groupId"]);
  if (!gid.ok) return gid;
  const cid = id(raw.creatorId, [...path, "creatorId"]);
  if (!cid.ok) return cid;
  const status = oneOf(raw.status, EXPENSE_STATUSES, [...path, "status"]);
  if (!status.ok) return status;
  const occurredOn = str(raw.occurredOn, [...path, "occurredOn"]);
  if (!occurredOn.ok) return occurredOn;
  const createdAt = str(raw.createdAt, [...path, "createdAt"]);
  if (!createdAt.ok) return createdAt;
  const versionNo = int(raw.versionNo, [...path, "versionNo"]);
  if (!versionNo.ok) return versionNo;
  const title = str(raw.title, [...path, "title"]);
  if (!title.ok) return title;
  const merchantName = nullableStr(raw.merchantName, [...path, "merchantName"]);
  if (!merchantName.ok) return merchantName;
  const expenseType = oneOf(raw.expenseType, EXPENSE_TYPES, [...path, "expenseType"]);
  if (!expenseType.ok) return expenseType;
  const totalCents = int(raw.totalCents, [...path, "totalCents"]);
  if (!totalCents.ok) return totalCents;
  const myShareCents = int(raw.myShareCents, [...path, "myShareCents"]);
  if (!myShareCents.ok) return myShareCents;
  const myPaidCents = int(raw.myPaidCents, [...path, "myPaidCents"]);
  if (!myPaidCents.ok) return myPaidCents;
  const participantCount = int(raw.participantCount, [...path, "participantCount"]);
  if (!participantCount.ok) return participantCount;

  return ok({
    id: eid.value,
    groupId: gid.value,
    creatorId: cid.value,
    status: status.value,
    occurredOn: occurredOn.value,
    createdAt: createdAt.value,
    versionNo: versionNo.value,
    title: title.value,
    merchantName: merchantName.value,
    expenseType: expenseType.value,
    totalCents: totalCents.value,
    myShareCents: myShareCents.value,
    myPaidCents: myPaidCents.value,
    participantCount: participantCount.value,
  });
}

export function decodeExpenseSummaries(
  raw: unknown,
  path: Path = [],
): ValidationResult<ExpenseSummary[], WireIssue> {
  return arrayOf(raw, path, decodeExpenseSummary);
}

const GUEST_PARTICIPANT_KEYS = ["id", "displayName", "claimedBy", "claimLinkGeneration"] as const;

export function decodeGuestParticipant(
  raw: unknown,
  path: Path = [],
): ValidationResult<GuestParticipant, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, GUEST_PARTICIPANT_KEYS, path);
  if (!k.ok) return k;
  const gid = id(raw.id, [...path, "id"]);
  if (!gid.ok) return gid;
  const d = str(raw.displayName, [...path, "displayName"]);
  if (!d.ok) return d;
  const c = nullableId(raw.claimedBy, [...path, "claimedBy"]);
  if (!c.ok) return c;
  const gen = int(raw.claimLinkGeneration, [...path, "claimLinkGeneration"]);
  if (!gen.ok) return gen;
  return ok({ id: gid.value, displayName: d.value, claimedBy: c.value, claimLinkGeneration: gen.value });
}

const PARTICIPANT_KEYS = [
  "participantIndex",
  "kind",
  "shareCents",
  "paidCents",
  "user",
  "guest",
] as const;

export function decodeParticipant(
  raw: unknown,
  path: Path = [],
): ValidationResult<Participant, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, PARTICIPANT_KEYS, path);
  if (!k.ok) return k;

  const idx = int(raw.participantIndex, [...path, "participantIndex"]);
  if (!idx.ok) return idx;
  const kind = oneOf(raw.kind, PARTICIPANT_KINDS, [...path, "kind"]);
  if (!kind.ok) return kind;
  const shareCents = int(raw.shareCents, [...path, "shareCents"]);
  if (!shareCents.ok) return shareCents;
  const paidCents = int(raw.paidCents, [...path, "paidCents"]);
  if (!paidCents.ok) return paidCents;

  let user: UserProfile | null = null;
  if (raw.user !== null) {
    const userRes = decodeUserProfile(raw.user, [...path, "user"]);
    if (!userRes.ok) return userRes;
    user = userRes.value;
  }

  let guest: GuestParticipant | null = null;
  if (raw.guest !== null) {
    const guestRes = decodeGuestParticipant(raw.guest, [...path, "guest"]);
    if (!guestRes.ok) return guestRes;
    guest = guestRes.value;
  }

  return ok({
    participantIndex: idx.value,
    kind: kind.value,
    shareCents: shareCents.value,
    paidCents: paidCents.value,
    user,
    guest,
  });
}

const EXPENSE_RECORD_KEYS = [
  "id",
  "groupId",
  "creatorId",
  "status",
  "currentVersionNo",
  "occurredOn",
  "createdAt",
  "deletedAt",
  "deletedBy",
] as const;

export function decodeExpenseRecord(
  raw: unknown,
  path: Path = [],
): ValidationResult<ExpenseRecord, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, EXPENSE_RECORD_KEYS, path);
  if (!k.ok) return k;

  const eid = id(raw.id, [...path, "id"]);
  if (!eid.ok) return eid;
  const gid = id(raw.groupId, [...path, "groupId"]);
  if (!gid.ok) return gid;
  const cid = id(raw.creatorId, [...path, "creatorId"]);
  if (!cid.ok) return cid;
  const status = oneOf(raw.status, EXPENSE_STATUSES, [...path, "status"]);
  if (!status.ok) return status;
  const currentVersionNo = int(raw.currentVersionNo, [...path, "currentVersionNo"]);
  if (!currentVersionNo.ok) return currentVersionNo;
  const occurredOn = str(raw.occurredOn, [...path, "occurredOn"]);
  if (!occurredOn.ok) return occurredOn;
  const createdAt = str(raw.createdAt, [...path, "createdAt"]);
  if (!createdAt.ok) return createdAt;
  const deletedAt = nullableStr(raw.deletedAt, [...path, "deletedAt"]);
  if (!deletedAt.ok) return deletedAt;
  const deletedBy = nullableId(raw.deletedBy, [...path, "deletedBy"]);
  if (!deletedBy.ok) return deletedBy;

  return ok({
    id: eid.value,
    groupId: gid.value,
    creatorId: cid.value,
    status: status.value,
    currentVersionNo: currentVersionNo.value,
    occurredOn: occurredOn.value,
    createdAt: createdAt.value,
    deletedAt: deletedAt.value,
    deletedBy: deletedBy.value,
  });
}

const EXPENSE_GROUP_SUMMARY_KEYS = ["id", "name", "kind"] as const;

export function decodeExpenseGroupSummary(
  raw: unknown,
  path: Path = [],
): ValidationResult<ExpenseGroupSummary, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, EXPENSE_GROUP_SUMMARY_KEYS, path);
  if (!k.ok) return k;
  const gid = id(raw.id, [...path, "id"]);
  if (!gid.ok) return gid;
  const name = str(raw.name, [...path, "name"]);
  if (!name.ok) return name;
  const kind = oneOf(raw.kind, GROUP_KINDS, [...path, "kind"]);
  if (!kind.ok) return kind;
  return ok({ id: gid.value, name: name.value, kind: kind.value });
}

const EXPENSE_DETAIL_KEYS = [
  "expense",
  "current",
  "versions",
  "participants",
  "group",
] as const;

export function decodeExpenseDetail(
  raw: unknown,
  path: Path = [],
): ValidationResult<ExpenseDetail, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, EXPENSE_DETAIL_KEYS, path);
  if (!k.ok) return k;

  const expense = decodeExpenseRecord(raw.expense, [...path, "expense"]);
  if (!expense.ok) return expense;
  const current = decodeExpenseVersion(raw.current, [...path, "current"]);
  if (!current.ok) return current;
  const versions = arrayOf(raw.versions, [...path, "versions"], decodeExpenseVersion);
  if (!versions.ok) return versions;
  const participants = arrayOf(
    raw.participants,
    [...path, "participants"],
    decodeParticipant,
  );
  if (!participants.ok) return participants;
  const group = decodeExpenseGroupSummary(raw.group, [...path, "group"]);
  if (!group.ok) return group;

  return ok({
    expense: expense.value,
    current: current.value,
    versions: versions.value,
    participants: participants.value,
    group: group.value,
  });
}
