import type { PixKeyType, NotificationCategory, NotificationPreferences } from "@/types";

export type { PixKeyType, NotificationCategory, NotificationPreferences };

export type GroupKind = "group" | "dm";
export type MemberStatus = "invited" | "accepted";
export type ExpenseType = "itemized" | "single_amount";
export type ExpenseStatus = "active" | "deleted";
export type SettlementStatus = "confirmed" | "voided";
export type ParticipantKind = "user" | "guest";
export type EventKind =
  | "expense_created"
  | "expense_edited"
  | "expense_deleted"
  | "expense_restored"
  | "settlement_recorded"
  | "settlement_voided"
  | "member_invited"
  | "member_joined"
  | "member_left"
  | "member_removed"
  | "guest_claimed"
  | "nudge";

export type VendorChargeStatus = "pending" | "received";
export type GuestClaimStatus = "ready" | "already_claimed" | "not_found";

export interface UserProfile {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
}

export interface Me extends UserProfile {
  email: string;
  pixKeyType: PixKeyType | null;
  pixKeyHint: string | null;
  onboarded: boolean;
  notificationPreferences: NotificationPreferences;
}

export interface Group {
  id: string;
  kind: GroupKind;
  name: string;
  creatorId: string;
  dmUserA: string | null;
  dmUserB: string | null;
  ledgerVersion: number;
  createdAt: string;
}

export interface GroupMember {
  groupId: string;
  userId: string;
  status: MemberStatus;
  invitedBy: string | null;
  acceptedAt: string | null;
  user: UserProfile;
}

export interface BalanceRow {
  kind: ParticipantKind;
  participantId: string;
  netCents: number;
}

export interface Transfer {
  fromKind: ParticipantKind;
  fromId: string;
  toId: string;
  amountCents: number;
}

export type ExpenseItemPayload = {
  description: string;
  quantityMilliunits: number;
  unitPriceCents: number;
  totalPriceCents: number;
};

export type ParticipantRef =
  | { kind: "user"; userId: string }
  | { kind: "guest"; guestId: string | null; displayName: string };

export type ExpensePayerPayload = {
  participantIndex: number;
  amountCents: number;
};

export type ExpenseItemAssignmentPayload = {
  itemIndex: number;
  participantIndex: number;
  amountCents: number;
};

export type ExpensePayload = {
  items: ExpenseItemPayload[];
  participants: ParticipantRef[];
  shares: number[];
  payers: ExpensePayerPayload[];
  itemAssignments: ExpenseItemAssignmentPayload[] | null;
};

export interface ExpenseHeader {
  occurredOn: string;
  title: string;
  merchantName: string | null;
  expenseType: ExpenseType;
  totalCents: number;
  serviceFeeBasisPoints: number;
  fixedFeeCents: number;
}

export interface ChangeSummary {
  title: [string, string] | null;
  totalCents: [number, number] | null;
  participantsAdded: string[];
  participantsRemoved: string[];
  payersChanged: boolean;
}

export interface ExpenseVersion extends ExpenseHeader {
  expenseId: string;
  versionNo: number;
  authorId: string;
  createdAt: string;
  payload: ExpensePayload;
  changeSummary: ChangeSummary | null;
}

export interface ExpenseSummary {
  id: string;
  groupId: string;
  creatorId: string;
  status: ExpenseStatus;
  occurredOn: string;
  createdAt: string;
  versionNo: number;
  title: string;
  merchantName: string | null;
  expenseType: ExpenseType;
  totalCents: number;
  myShareCents: number;
  myPaidCents: number;
  participantCount: number;
}

export interface GuestParticipant {
  id: string;
  displayName: string;
  claimedBy: string | null;
}

export interface Participant {
  participantIndex: number;
  kind: ParticipantKind;
  shareCents: number;
  paidCents: number;
  user: UserProfile | null;
  guest: GuestParticipant | null;
}

export interface ExpenseRecord {
  id: string;
  groupId: string;
  creatorId: string;
  status: ExpenseStatus;
  currentVersionNo: number;
  occurredOn: string;
  createdAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
}

export interface ExpenseGroupSummary {
  id: string;
  name: string;
  kind: GroupKind;
}

export interface ExpenseDetail {
  expense: ExpenseRecord;
  current: ExpenseVersion;
  versions: ExpenseVersion[];
  participants: Participant[];
  group: ExpenseGroupSummary;
}

export interface Settlement {
  id: string;
  operationId: string;
  groupId: string;
  fromUserId: string;
  toUserId: string;
  amountCents: number;
  status: SettlementStatus;
  createdBy: string;
  createdAt: string;
  confirmedAt: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
}

export interface GroupEvent {
  id: number;
  groupId: string;
  actorId: string | null;
  kind: EventKind;
  expenseId: string | null;
  settlementId: string | null;
  subjectUserId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  actor: UserProfile | null;
  expenseTitle: string | null;
}

export interface ChatMessage {
  id: string;
  clientId: string;
  groupId: string;
  senderId: string;
  content: string;
  createdAt: string;
  sender: UserProfile;
}

export interface ChatLastMessage {
  content: string;
  senderId: string;
  createdAt: string;
}

export interface GroupGuest {
  id: string;
  displayName: string;
  expenseId: string;
}

export interface GroupSnapshot {
  group: Group;
  members: GroupMember[];
  balances: BalanceRow[];
  guests: GroupGuest[];
  settlements: Settlement[];
  recentExpenses: ExpenseSummary[];
  lastEventId: number;
  unreadCount: number;
  lastMessage: ChatLastMessage | null;
  lastActivityAt: string;
  expenseCount: number;
  pairwiseEdges: Transfer[];
}

export interface Bootstrap {
  me: Me;
  groups: GroupSnapshot[];
  serverTime: string;
}

export type MutationAck = {
  groupId: string;
  ledgerVersion: number;
  eventId: number | null;
  expenseId?: string;
  versionNo?: number;
  settlementId?: string;
  created?: boolean;
};

export interface VendorCharge {
  id: string;
  userId: string;
  amountCents: number;
  description: string | null;
  status: VendorChargeStatus;
  createdAt: string;
  confirmedAt: string | null;
}

export interface InviteLink {
  groupId: string;
  token: string;
  expiresAt: string | null;
  maxUses: number | null;
}

export interface InvitePreview {
  groupName: string | null;
  memberCount: number | null;
  creatorName: string | null;
  valid: boolean;
}

export interface GuestClaimResolution {
  guestId: string | null;
  displayName: string | null;
  expenseTitle: string | null;
  groupName: string | null;
  shareCents: number | null;
  status: GuestClaimStatus;
}

export interface Conversation {
  messages: ChatMessage[];
  events: GroupEvent[];
}

export interface WireIssue {
  code: "invalid_wire";
  path: readonly (string | number)[];
}
