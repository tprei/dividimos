import type { ValidationResult } from "@/lib/expense-money";
import type {
  BalanceRow,
  Bootstrap,
  ChatMessage,
  ChatLastMessage,
  Conversation,
  EventKind,
  Group,
  GroupGuest,
  GroupEvent,
  GroupKind,
  GroupMember,
  GroupSnapshot,
  GuestClaimResolution,
  GuestClaimStatus,
  InviteLink,
  InvitePreview,
  Me,
  MemberStatus,
  MutationAck,
  NotificationCategory,
  ParticipantKind,
  PixKeyType,
  Settlement,
  SettlementStatus,
  VendorCharge,
  VendorChargeStatus,
  WireIssue,
} from "@/types/ledger";
import {
  arrayOf,
  bool,
  decodeExpenseSummary,
  decodeUserProfile,
  exactKeys,
  fail,
  id,
  int,
  isRecord,
  nullableId,
  nullableInt,
  nullableStr,
  ok,
  oneOf,
  str,
} from "./decode-expense";
import type { Path } from "./decode-expense";

export type { Path };
export type { WireIssue };

export {
  decodeChangeSummary,
  decodeExpenseDetail,
  decodeExpenseGroupSummary,
  decodeExpenseItemAssignmentPayload,
  decodeExpenseItemPayload,
  decodeExpensePayerPayload,
  decodeExpensePayload,
  decodeExpenseRecord,
  decodeExpenseSummaries,
  decodeExpenseSummary,
  decodeExpenseVersion,
  decodeGuestParticipant,
  decodeParticipant,
  decodeParticipantRef,
  decodeUserProfile,
  decodeUserProfileOrNull,
} from "./decode-expense";

const PIX_KEY_TYPES: readonly PixKeyType[] = ["cpf", "email", "phone", "random"];
const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  "expenses",
  "settlements",
  "nudges",
];
const GROUP_KINDS: readonly GroupKind[] = ["group", "dm"];
const MEMBER_STATUSES: readonly MemberStatus[] = ["invited", "accepted"];
const PARTICIPANT_KINDS: readonly ParticipantKind[] = ["user", "guest"];
const SETTLEMENT_STATUSES: readonly SettlementStatus[] = [
  "pending",
  "confirmed",
  "voided",
];
const EVENT_KINDS: readonly EventKind[] = [
  "expense_created",
  "expense_edited",
  "expense_deleted",
  "expense_restored",
  "settlement_recorded",
  "settlement_confirmed",
  "settlement_voided",
  "member_invited",
  "member_joined",
  "member_left",
  "member_removed",
  "guest_claimed",
  "nudge",
];
const GUEST_CLAIM_STATUSES: readonly GuestClaimStatus[] = [
  "ready",
  "already_claimed",
  "not_found",
];
const VENDOR_CHARGE_STATUSES: readonly VendorChargeStatus[] = [
  "pending",
  "received",
];

const ME_KEYS = [
  "id",
  "handle",
  "name",
  "avatarUrl",
  "email",
  "pixKeyType",
  "pixKeyHint",
  "onboarded",
  "notificationPreferences",
] as const;

export function decodeMe(
  raw: unknown,
  path: Path = [],
): ValidationResult<Me, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, ME_KEYS, path);
  if (!k.ok) return k;

  const uid = id(raw.id, [...path, "id"]);
  if (!uid.ok) return uid;
  const h = str(raw.handle, [...path, "handle"]);
  if (!h.ok) return h;
  const n = str(raw.name, [...path, "name"]);
  if (!n.ok) return n;
  const a = nullableStr(raw.avatarUrl, [...path, "avatarUrl"]);
  if (!a.ok) return a;
  const em = str(raw.email, [...path, "email"]);
  if (!em.ok) return em;

  let pixKeyType: PixKeyType | null = null;
  if (raw.pixKeyType !== null) {
    const pkt = oneOf(raw.pixKeyType, PIX_KEY_TYPES, [...path, "pixKeyType"]);
    if (!pkt.ok) return pkt;
    pixKeyType = pkt.value;
  }

  const pkh = nullableStr(raw.pixKeyHint, [...path, "pixKeyHint"]);
  if (!pkh.ok) return pkh;
  const onb = bool(raw.onboarded, [...path, "onboarded"]);
  if (!onb.ok) return onb;

  if (!isRecord(raw.notificationPreferences)) {
    return fail([...path, "notificationPreferences"]);
  }
  const prefObj = raw.notificationPreferences;
  const prefKeys = Object.keys(prefObj);
  for (let i = 0; i < prefKeys.length; i++) {
    const pk = prefKeys[i];
    if (!NOTIFICATION_CATEGORIES.includes(pk as NotificationCategory)) {
      return fail([...path, "notificationPreferences", pk]);
    }
    if (typeof prefObj[pk] !== "boolean") {
      return fail([...path, "notificationPreferences", pk]);
    }
  }

  return ok({
    id: uid.value,
    handle: h.value,
    name: n.value,
    avatarUrl: a.value,
    email: em.value,
    pixKeyType,
    pixKeyHint: pkh.value,
    onboarded: onb.value,
    notificationPreferences: prefObj as Me["notificationPreferences"],
  });
}

const GROUP_KEYS = [
  "id",
  "kind",
  "name",
  "creatorId",
  "dmUserA",
  "dmUserB",
  "ledgerVersion",
  "createdAt",
] as const;

export function decodeGroup(
  raw: unknown,
  path: Path = [],
): ValidationResult<Group, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, GROUP_KEYS, path);
  if (!k.ok) return k;

  const gid = id(raw.id, [...path, "id"]);
  if (!gid.ok) return gid;
  const kind = oneOf(raw.kind, GROUP_KINDS, [...path, "kind"]);
  if (!kind.ok) return kind;
  const name = str(raw.name, [...path, "name"]);
  if (!name.ok) return name;
  const cid = id(raw.creatorId, [...path, "creatorId"]);
  if (!cid.ok) return cid;
  const dmA = nullableId(raw.dmUserA, [...path, "dmUserA"]);
  if (!dmA.ok) return dmA;
  const dmB = nullableId(raw.dmUserB, [...path, "dmUserB"]);
  if (!dmB.ok) return dmB;
  const lv = int(raw.ledgerVersion, [...path, "ledgerVersion"]);
  if (!lv.ok) return lv;
  const ca = str(raw.createdAt, [...path, "createdAt"]);
  if (!ca.ok) return ca;

  return ok({
    id: gid.value,
    kind: kind.value,
    name: name.value,
    creatorId: cid.value,
    dmUserA: dmA.value,
    dmUserB: dmB.value,
    ledgerVersion: lv.value,
    createdAt: ca.value,
  });
}

const GROUP_MEMBER_KEYS = [
  "groupId",
  "userId",
  "status",
  "invitedBy",
  "acceptedAt",
  "user",
] as const;


export function decodeGroupMember(
  raw: unknown,
  path: Path = [],
): ValidationResult<GroupMember, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, GROUP_MEMBER_KEYS, path);
  if (!k.ok) return k;

  const gid = id(raw.groupId, [...path, "groupId"]);
  if (!gid.ok) return gid;
  const uid = id(raw.userId, [...path, "userId"]);
  if (!uid.ok) return uid;
  const status = oneOf(raw.status, MEMBER_STATUSES, [...path, "status"]);
  if (!status.ok) return status;
  const ib = nullableId(raw.invitedBy, [...path, "invitedBy"]);
  if (!ib.ok) return ib;
  const aa = nullableStr(raw.acceptedAt, [...path, "acceptedAt"]);
  if (!aa.ok) return aa;
  const user = decodeUserProfile(raw.user, [...path, "user"]);
  if (!user.ok) return user;

  return ok({
    groupId: gid.value,
    userId: uid.value,
    status: status.value,
    invitedBy: ib.value,
    acceptedAt: aa.value,
    user: user.value,
  });
}

const BALANCE_ROW_KEYS = ["kind", "participantId", "netCents"] as const;

export function decodeBalanceRow(
  raw: unknown,
  path: Path = [],
): ValidationResult<BalanceRow, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, BALANCE_ROW_KEYS, path);
  if (!k.ok) return k;

  const kind = oneOf(raw.kind, PARTICIPANT_KINDS, [...path, "kind"]);
  if (!kind.ok) return kind;
  const pid = id(raw.participantId, [...path, "participantId"]);
  if (!pid.ok) return pid;
  const net = int(raw.netCents, [...path, "netCents"]);
  if (!net.ok) return net;

  return ok({ kind: kind.value, participantId: pid.value, netCents: net.value });
}

const SETTLEMENT_KEYS = [
  "id",
  "operationId",
  "groupId",
  "fromUserId",
  "toUserId",
  "amountCents",
  "status",
  "createdBy",
  "createdAt",
  "confirmedAt",
  "voidedAt",
  "voidedBy",
] as const;

export function decodeSettlement(
  raw: unknown,
  path: Path = [],
): ValidationResult<Settlement, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, SETTLEMENT_KEYS, path);
  if (!k.ok) return k;

  const sid = id(raw.id, [...path, "id"]);
  if (!sid.ok) return sid;
  const opId = id(raw.operationId, [...path, "operationId"]);
  if (!opId.ok) return opId;
  const gid = id(raw.groupId, [...path, "groupId"]);
  if (!gid.ok) return gid;
  const from = id(raw.fromUserId, [...path, "fromUserId"]);
  if (!from.ok) return from;
  const to = id(raw.toUserId, [...path, "toUserId"]);
  if (!to.ok) return to;
  const amt = int(raw.amountCents, [...path, "amountCents"]);
  if (!amt.ok) return amt;
  const status = oneOf(raw.status, SETTLEMENT_STATUSES, [...path, "status"]);
  if (!status.ok) return status;
  const cb = id(raw.createdBy, [...path, "createdBy"]);
  if (!cb.ok) return cb;
  const ca = str(raw.createdAt, [...path, "createdAt"]);
  if (!ca.ok) return ca;
  const cfa = nullableStr(raw.confirmedAt, [...path, "confirmedAt"]);
  if (!cfa.ok) return cfa;
  const va = nullableStr(raw.voidedAt, [...path, "voidedAt"]);
  if (!va.ok) return va;
  const vb = nullableId(raw.voidedBy, [...path, "voidedBy"]);
  if (!vb.ok) return vb;

  return ok({
    id: sid.value,
    operationId: opId.value,
    groupId: gid.value,
    fromUserId: from.value,
    toUserId: to.value,
    amountCents: amt.value,
    status: status.value,
    createdBy: cb.value,
    createdAt: ca.value,
    confirmedAt: cfa.value,
    voidedAt: va.value,
    voidedBy: vb.value,
  });
}

const GROUP_EVENT_KEYS = [
  "id",
  "groupId",
  "actorId",
  "kind",
  "expenseId",
  "settlementId",
  "subjectUserId",
  "payload",
  "createdAt",
  "actor",
  "expenseTitle",
] as const;

export function decodeGroupEvent(
  raw: unknown,
  path: Path = [],
): ValidationResult<GroupEvent, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, GROUP_EVENT_KEYS, path);
  if (!k.ok) return k;

  const eid = int(raw.id, [...path, "id"]);
  if (!eid.ok) return eid;
  const gid = id(raw.groupId, [...path, "groupId"]);
  if (!gid.ok) return gid;
  const aid = nullableId(raw.actorId, [...path, "actorId"]);
  if (!aid.ok) return aid;
  const kind = oneOf(raw.kind, EVENT_KINDS, [...path, "kind"]);
  if (!kind.ok) return kind;
  const expId = nullableId(raw.expenseId, [...path, "expenseId"]);
  if (!expId.ok) return expId;
  const setId = nullableId(raw.settlementId, [...path, "settlementId"]);
  if (!setId.ok) return setId;
  const subId = nullableId(raw.subjectUserId, [...path, "subjectUserId"]);
  if (!subId.ok) return subId;

  if (!isRecord(raw.payload)) return fail([...path, "payload"]);
  const payload = raw.payload;

  const ca = str(raw.createdAt, [...path, "createdAt"]);
  if (!ca.ok) return ca;

  let actor: GroupEvent["actor"] = null;
  if (raw.actor !== null) {
    const actorRes = decodeUserProfile(raw.actor, [...path, "actor"]);
    if (!actorRes.ok) return actorRes;
    actor = actorRes.value;
  }

  const expTitle = nullableStr(raw.expenseTitle, [...path, "expenseTitle"]);
  if (!expTitle.ok) return expTitle;

  return ok({
    id: eid.value,
    groupId: gid.value,
    actorId: aid.value,
    kind: kind.value,
    expenseId: expId.value,
    settlementId: setId.value,
    subjectUserId: subId.value,
    payload,
    createdAt: ca.value,
    actor,
    expenseTitle: expTitle.value,
  });
}

export function decodeGroupEvents(
  raw: unknown,
  path: Path = [],
): ValidationResult<GroupEvent[], WireIssue> {
  return arrayOf(raw, path, decodeGroupEvent);
}

const CHAT_MESSAGE_KEYS = [
  "id",
  "clientId",
  "groupId",
  "senderId",
  "content",
  "createdAt",
  "sender",
] as const;

export function decodeChatMessage(
  raw: unknown,
  path: Path = [],
): ValidationResult<ChatMessage, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, CHAT_MESSAGE_KEYS, path);
  if (!k.ok) return k;

  const mid = id(raw.id, [...path, "id"]);
  if (!mid.ok) return mid;
  const cid = id(raw.clientId, [...path, "clientId"]);
  if (!cid.ok) return cid;
  const gid = id(raw.groupId, [...path, "groupId"]);
  if (!gid.ok) return gid;
  const sid = id(raw.senderId, [...path, "senderId"]);
  if (!sid.ok) return sid;
  const content = str(raw.content, [...path, "content"]);
  if (!content.ok) return content;
  const ca = str(raw.createdAt, [...path, "createdAt"]);
  if (!ca.ok) return ca;
  const sender = decodeUserProfile(raw.sender, [...path, "sender"]);
  if (!sender.ok) return sender;

  return ok({
    id: mid.value,
    clientId: cid.value,
    groupId: gid.value,
    senderId: sid.value,
    content: content.value,
    createdAt: ca.value,
    sender: sender.value,
  });
}

const CHAT_LAST_MESSAGE_KEYS = ["content", "senderId", "createdAt"] as const;

export function decodeChatLastMessage(
  raw: unknown,
  path: Path = [],
): ValidationResult<ChatLastMessage, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, CHAT_LAST_MESSAGE_KEYS, path);
  if (!k.ok) return k;
  const content = str(raw.content, [...path, "content"]);
  if (!content.ok) return content;
  const sid = id(raw.senderId, [...path, "senderId"]);
  if (!sid.ok) return sid;
  const ca = str(raw.createdAt, [...path, "createdAt"]);
  if (!ca.ok) return ca;
  return ok({ content: content.value, senderId: sid.value, createdAt: ca.value });
}

const GROUP_GUEST_KEYS = ["id", "displayName", "expenseId"] as const;

export function decodeGroupGuest(
  raw: unknown,
  path: Path = [],
): ValidationResult<GroupGuest, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, GROUP_GUEST_KEYS, path);
  if (!k.ok) return k;
  const id = str(raw.id, [...path, "id"]);
  if (!id.ok) return id;
  const displayName = str(raw.displayName, [...path, "displayName"]);
  if (!displayName.ok) return displayName;
  const expenseId = str(raw.expenseId, [...path, "expenseId"]);
  if (!expenseId.ok) return expenseId;
  return ok({ id: id.value, displayName: displayName.value, expenseId: expenseId.value });
}

const GROUP_SNAPSHOT_KEYS = [
  "group",
  "members",
  "balances",
  "guests",
  "pendingSettlements",
  "recentExpenses",
  "lastEventId",
  "unreadCount",
  "lastMessage",
  "lastActivityAt",
] as const;


export function decodeGroupSnapshot(
  raw: unknown,
  path: Path = [],
): ValidationResult<GroupSnapshot, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, GROUP_SNAPSHOT_KEYS, path);
  if (!k.ok) return k;

  const group = decodeGroup(raw.group, [...path, "group"]);
  if (!group.ok) return group;
  const members = arrayOf(raw.members, [...path, "members"], decodeGroupMember);
  if (!members.ok) return members;
  const balances = arrayOf(raw.balances, [...path, "balances"], decodeBalanceRow);
  if (!balances.ok) return balances;
  const guests = arrayOf(raw.guests, [...path, "guests"], decodeGroupGuest);
  if (!guests.ok) return guests;
  const pendingSettlements = arrayOf(
    raw.pendingSettlements,
    [...path, "pendingSettlements"],
    decodeSettlement,
  );
  if (!pendingSettlements.ok) return pendingSettlements;
  const recentExpenses = arrayOf(
    raw.recentExpenses,
    [...path, "recentExpenses"],
    decodeExpenseSummary,
  );
  if (!recentExpenses.ok) return recentExpenses;
  const lastEventId = int(raw.lastEventId, [...path, "lastEventId"]);
  if (!lastEventId.ok) return lastEventId;
  const unreadCount = int(raw.unreadCount, [...path, "unreadCount"]);
  if (!unreadCount.ok) return unreadCount;

  let lastMessage: ChatLastMessage | null = null;
  if (raw.lastMessage !== null) {
    const lmRes = decodeChatLastMessage(raw.lastMessage, [...path, "lastMessage"]);
    if (!lmRes.ok) return lmRes;
    lastMessage = lmRes.value;
  }

  const lastActivityAt = str(raw.lastActivityAt, [...path, "lastActivityAt"]);
  if (!lastActivityAt.ok) return lastActivityAt;

  return ok({
    group: group.value,
    members: members.value,
    balances: balances.value,
    guests: guests.value,
    pendingSettlements: pendingSettlements.value,
    recentExpenses: recentExpenses.value,
    lastEventId: lastEventId.value,
    unreadCount: unreadCount.value,
    lastMessage,
    lastActivityAt: lastActivityAt.value,
  });
}

const BOOTSTRAP_KEYS = ["me", "groups", "serverTime"] as const;

export function decodeBootstrap(
  raw: unknown,
  path: Path = [],
): ValidationResult<Bootstrap, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, BOOTSTRAP_KEYS, path);
  if (!k.ok) return k;

  const me = decodeMe(raw.me, [...path, "me"]);
  if (!me.ok) return me;
  const groups = arrayOf(raw.groups, [...path, "groups"], decodeGroupSnapshot);
  if (!groups.ok) return groups;
  const serverTime = str(raw.serverTime, [...path, "serverTime"]);
  if (!serverTime.ok) return serverTime;

  return ok({
    me: me.value,
    groups: groups.value,
    serverTime: serverTime.value,
  });
}

const MUTATION_ACK_REQUIRED_KEYS = ["groupId", "ledgerVersion", "eventId"] as const;
const MUTATION_ACK_ALL_KEYS = [
  "groupId",
  "ledgerVersion",
  "eventId",
  "expenseId",
  "versionNo",
  "settlementId",
  "created",
] as const;

export function decodeMutationAck(
  raw: unknown,
  path: Path = [],
): ValidationResult<MutationAck, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  for (let i = 0; i < MUTATION_ACK_REQUIRED_KEYS.length; i++) {
    if (!(MUTATION_ACK_REQUIRED_KEYS[i] in raw)) {
      return fail([...path, MUTATION_ACK_REQUIRED_KEYS[i]]);
    }
  }
  const keys = Object.keys(raw);
  for (let i = 0; i < keys.length; i++) {
    if (!MUTATION_ACK_ALL_KEYS.includes(keys[i] as (typeof MUTATION_ACK_ALL_KEYS)[number])) {
      return fail([...path, keys[i]]);
    }
  }

  const gid = id(raw.groupId, [...path, "groupId"]);
  if (!gid.ok) return gid;
  const lv = int(raw.ledgerVersion, [...path, "ledgerVersion"]);
  if (!lv.ok) return lv;
  const eid = nullableInt(raw.eventId, [...path, "eventId"]);
  if (!eid.ok) return eid;

  const result: MutationAck = {
    groupId: gid.value,
    ledgerVersion: lv.value,
    eventId: eid.value,
  };

  if ("expenseId" in raw && raw.expenseId !== undefined) {
    const expId = id(raw.expenseId, [...path, "expenseId"]);
    if (!expId.ok) return expId;
    result.expenseId = expId.value;
  }
  if ("versionNo" in raw && raw.versionNo !== undefined) {
    const vn = int(raw.versionNo, [...path, "versionNo"]);
    if (!vn.ok) return vn;
    result.versionNo = vn.value;
  }
  if ("settlementId" in raw && raw.settlementId !== undefined) {
    const sid = id(raw.settlementId, [...path, "settlementId"]);
    if (!sid.ok) return sid;
    result.settlementId = sid.value;
  }
  if ("created" in raw && raw.created !== undefined) {
    const cr = bool(raw.created, [...path, "created"]);
    if (!cr.ok) return cr;
    result.created = cr.value;
  }

  return ok(result);
}

const INVITE_LINK_KEYS = ["groupId", "token", "expiresAt", "maxUses"] as const;

export function decodeInviteLink(
  raw: unknown,
  path: Path = [],
): ValidationResult<InviteLink, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, INVITE_LINK_KEYS, path);
  if (!k.ok) return k;

  const gid = id(raw.groupId, [...path, "groupId"]);
  if (!gid.ok) return gid;
  const token = id(raw.token, [...path, "token"]);
  if (!token.ok) return token;
  const exp = nullableStr(raw.expiresAt, [...path, "expiresAt"]);
  if (!exp.ok) return exp;
  const mu = nullableInt(raw.maxUses, [...path, "maxUses"]);
  if (!mu.ok) return mu;

  return ok({
    groupId: gid.value,
    token: token.value,
    expiresAt: exp.value,
    maxUses: mu.value,
  });
}

const INVITE_PREVIEW_KEYS = [
  "groupName",
  "memberCount",
  "creatorName",
  "valid",
] as const;

export function decodeInvitePreview(
  raw: unknown,
  path: Path = [],
): ValidationResult<InvitePreview, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, INVITE_PREVIEW_KEYS, path);
  if (!k.ok) return k;

  const gn = nullableStr(raw.groupName, [...path, "groupName"]);
  if (!gn.ok) return gn;
  const mc = nullableInt(raw.memberCount, [...path, "memberCount"]);
  if (!mc.ok) return mc;
  const cn = nullableStr(raw.creatorName, [...path, "creatorName"]);
  if (!cn.ok) return cn;
  const v = bool(raw.valid, [...path, "valid"]);
  if (!v.ok) return v;

  return ok({
    groupName: gn.value,
    memberCount: mc.value,
    creatorName: cn.value,
    valid: v.value,
  });
}

const GUEST_CLAIM_RESOLUTION_KEYS = [
  "guestId",
  "displayName",
  "expenseTitle",
  "groupName",
  "shareCents",
  "status",
] as const;

export function decodeGuestClaimResolution(
  raw: unknown,
  path: Path = [],
): ValidationResult<GuestClaimResolution, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, GUEST_CLAIM_RESOLUTION_KEYS, path);
  if (!k.ok) return k;

  const gid = nullableId(raw.guestId, [...path, "guestId"]);
  if (!gid.ok) return gid;
  const dn = nullableStr(raw.displayName, [...path, "displayName"]);
  if (!dn.ok) return dn;
  const et = nullableStr(raw.expenseTitle, [...path, "expenseTitle"]);
  if (!et.ok) return et;
  const gn = nullableStr(raw.groupName, [...path, "groupName"]);
  if (!gn.ok) return gn;
  const sc = nullableInt(raw.shareCents, [...path, "shareCents"]);
  if (!sc.ok) return sc;
  const status = oneOf(raw.status, GUEST_CLAIM_STATUSES, [...path, "status"]);
  if (!status.ok) return status;

  return ok({
    guestId: gid.value,
    displayName: dn.value,
    expenseTitle: et.value,
    groupName: gn.value,
    shareCents: sc.value,
    status: status.value,
  });
}

const VENDOR_CHARGE_KEYS = [
  "id",
  "userId",
  "amountCents",
  "description",
  "status",
  "createdAt",
  "confirmedAt",
] as const;

export function decodeVendorCharge(
  raw: unknown,
  path: Path = [],
): ValidationResult<VendorCharge, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, VENDOR_CHARGE_KEYS, path);
  if (!k.ok) return k;

  const vid = id(raw.id, [...path, "id"]);
  if (!vid.ok) return vid;
  const uid = id(raw.userId, [...path, "userId"]);
  if (!uid.ok) return uid;
  const amt = int(raw.amountCents, [...path, "amountCents"]);
  if (!amt.ok) return amt;
  const desc = nullableStr(raw.description, [...path, "description"]);
  if (!desc.ok) return desc;
  const status = oneOf(raw.status, VENDOR_CHARGE_STATUSES, [...path, "status"]);
  if (!status.ok) return status;
  const ca = str(raw.createdAt, [...path, "createdAt"]);
  if (!ca.ok) return ca;
  const cfa = nullableStr(raw.confirmedAt, [...path, "confirmedAt"]);
  if (!cfa.ok) return cfa;

  return ok({
    id: vid.value,
    userId: uid.value,
    amountCents: amt.value,
    description: desc.value,
    status: status.value,
    createdAt: ca.value,
    confirmedAt: cfa.value,
  });
}

export function decodeVendorCharges(
  raw: unknown,
  path: Path = [],
): ValidationResult<VendorCharge[], WireIssue> {
  return arrayOf(raw, path, decodeVendorCharge);
}

const CONVERSATION_KEYS = ["messages", "events"] as const;

export function decodeConversation(
  raw: unknown,
  path: Path = [],
): ValidationResult<Conversation, WireIssue> {
  if (!isRecord(raw)) return fail(path);
  const k = exactKeys(raw, CONVERSATION_KEYS, path);
  if (!k.ok) return k;

  const messages = arrayOf(raw.messages, [...path, "messages"], decodeChatMessage);
  if (!messages.ok) return messages;
  const events = arrayOf(raw.events, [...path, "events"], decodeGroupEvent);
  if (!events.ok) return events;

  return ok({ messages: messages.value, events: events.value });
}
