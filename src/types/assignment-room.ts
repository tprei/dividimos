import type {
  ExpenseItemAssignmentPayload,
  ExpenseItemPayload,
  ExpensePayerPayload,
  ExpenseStatus,
  ParticipantRef,
  UserProfile,
} from "@/types/ledger";

/**
 * Live receipt-room contracts for exact item assignment.
 *
 * A receipt room is a pre-expense surface: the host pins a receipt, verified
 * users and anonymous guests join, and everyone claims fractions of each line.
 * Claim arithmetic lives in `@/lib/assignment-room-money`; this module owns the
 * shared shapes only.
 *
 * Privacy invariants: participant views never carry internal user IDs, guest
 * redemption tokens, group IDs, or the receipt access key. Verified account
 * identity travels only in the host view's `participantRefs`; a plain
 * participant view is the snapshot alone. `currentBill` stays null until the
 * room finalizes.
 */

export type AssignmentRoomStatus = "open" | "closed" | "finalized" | "cancelled";

export type AssignmentRoomActivity =
  { revision: number; observedAt: number } &
  (
    | { kind: "joined"; participantIds: string[]; burstStartedAt: number }
    | {
        kind: "claims";
        changes: Array<{
          itemId: string;
          participantId: string;
          beforeTicks: number;
          afterTicks: number;
        }>;
      }
    | { kind: "removed"; participantIds: string[] }
    | { kind: "status"; status: AssignmentRoomStatus }
    | { kind: "updated" }
  );

export type AssignmentGroupTarget =
  | { kind: "existing"; groupId: string }
  | { kind: "new"; name: string };

/** One receipt line. Room-only fields extend the persisted payload shape. */
export interface AssignmentRoomItem extends ExpenseItemPayload {
  id: string;
  /** Immutable ordering key; canonical payloads sort on it. */
  ordinal: number;
  /** Bumped on every claim-driven change for optimistic concurrency. */
  revision: number;
}

export interface AssignmentRoomParticipant {
  id: string;
  /** Immutable ordering key; canonical participant indexes follow it. */
  ordinal: number;
  displayName: string;
  avatarUrl: string | null;
  isGuest: boolean;
  removed: boolean;
}

/** One participant's consumption of one item, in raw room ticks. */
export interface AssignmentRoomClaim {
  itemId: string;
  participantId: string;
  ticks: number;
}

/**
 * The finalized bill projection. `shares` and `participants` are parallel
 * arrays over canonical participant indexes; `totalCents` is the exact grand
 * total (items plus service and fixed fees).
 */
export interface AssignmentBillBreakdown {
  status: ExpenseStatus;
  versionNo: number;
  title: string;
  occurredOn: string;
  items: ExpenseItemPayload[];
  itemAssignments: ExpenseItemAssignmentPayload[] | null;
  participants: Array<{
    participantIndex: number;
    displayName: string;
    avatarUrl: string | null;
    isGuest: boolean;
  }>;
  shares: number[];
  payers: ExpensePayerPayload[];
  totalCents: number;
  serviceFeeBasisPoints: number;
  fixedFeeCents: number;
}

export type AssignmentRoomCompletionAction =
  | { kind: "view_expense"; expenseId: string; groupId: string }
  | { kind: "accept_invitation"; expenseId: string; groupId: string }
  | { kind: "claim_guest" }
  | { kind: "sign_in" }
  | { kind: "unavailable" };

export interface AssignmentRoomCompletion {
  roomId: string;
  bill: AssignmentBillBreakdown;
  selfParticipantIndex: number | null;
  action: AssignmentRoomCompletionAction;
}

/**
 * Full room state as seen by any member. The header fields mirror the existing
 * expense header fixed to the itemized type. Internal identifiers stay out:
 * participants expose display data only.
 */
export interface AssignmentRoomSnapshot {
  id: string;
  revision: number;
  status: AssignmentRoomStatus;
  title: string;
  occurredOn: string;
  serviceFeeBasisPoints: number;
  fixedFeeCents: number;
  totalCents: number;
  selfParticipantId: string;
  items: AssignmentRoomItem[];
  participants: AssignmentRoomParticipant[];
  claims: AssignmentRoomClaim[];
  topic: string | null;
  currentBill: AssignmentBillBreakdown | null;
}

/**
 * Role-scoped room view. Only the host sees the group target and the mapping
 * from room participants to ledger participant refs; those carry the verified
 * account identity that participant views must never expose.
 */
export type AssignmentRoomView =
  | { role: "participant"; room: AssignmentRoomSnapshot }
  | {
      role: "host";
      room: AssignmentRoomSnapshot;
      groupTarget: AssignmentGroupTarget;
      participantRefs: Array<{ participantId: string; ref: ParticipantRef }>;
    };

/** Optimistic claim write; `expectedItemRevision` rejects stale writers. */
export interface SetAssignmentClaimInput {
  roomId: string;
  itemId: string;
  participantId: string;
  expectedItemRevision: number;
  ticks: number;
}

export interface AssignmentRoomClaimer {
  participantId: string;
  userId: string | null;
  name: string;
  avatarUrl: string | null;
}

export interface AssignmentRoomSummary {
  id: string;
  groupId: string;
  status: AssignmentRoomStatus;
  revision: number;
  title: string;
  occurredOn: string;
  totalCents: number;
  host: UserProfile;
  createdAt: string;
  itemCount: number;
  ownedItemCount: number;
  claimers: AssignmentRoomClaimer[];
  expenseId: string | null;
}

export interface OpenAssignmentRoom extends AssignmentRoomSummary {
  joined: boolean;
}
