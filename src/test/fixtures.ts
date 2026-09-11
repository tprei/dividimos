import type { Expense, ExpenseItem, User } from "@/types";
import type {
  ExpenseDetail,
  ExpenseRecord,
  ExpenseVersion,
  GroupMember,
  Participant,
} from "@/types/ledger";

export const userAlice: User = {
  id: "user-alice",
  email: "alice@example.com",
  handle: "alice",
  name: "Alice Silva",
  pixKeyType: "email",
  pixKeyHint: "a***e@example.com",
  onboarded: true,
  createdAt: "2024-01-01T00:00:00Z",
};

export const userBob: User = {
  id: "user-bob",
  email: "bob@example.com",
  handle: "bob",
  name: "Bob Santos",
  pixKeyType: "email",
  pixKeyHint: "b***b@example.com",
  onboarded: true,
  createdAt: "2024-01-01T00:00:00Z",
};

export const userCarlos: User = {
  id: "user-carlos",
  email: "carlos@example.com",
  handle: "carlos",
  name: "Carlos Souza",
  pixKeyType: "cpf",
  pixKeyHint: "***.***.*89*-01",
  onboarded: true,
  createdAt: "2024-01-01T00:00:00Z",
};

export function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "expense-1",
    groupId: "group-1",
    creatorId: "user-alice",
    expenseType: "itemized",
    title: "Jantar",
    totalAmount: 0,
    serviceFeePercent: 10,
    serviceFeeBasisPoints: 1000,
    fixedFees: 0,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

export function makeSingleAmountExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "expense-1",
    groupId: "group-1",
    creatorId: "user-alice",
    expenseType: "single_amount",
    title: "Aluguel",
    totalAmount: 0,
    serviceFeePercent: 0,
    serviceFeeBasisPoints: 0,
    fixedFees: 0,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

export function makeExpenseItem(overrides: Partial<ExpenseItem> = {}): ExpenseItem {
  return {
    id: "item-1",
    expenseId: "expense-1",
    description: "Pizza",
    quantity: 1000,
    unitPriceCents: 5000,
    totalPriceCents: 5000,
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

export function makeExpenseVersion(overrides: Partial<ExpenseVersion> = {}): ExpenseVersion {
  return {
    expenseId: "exp-detail-1",
    versionNo: 1,
    authorId: "user-alice",
    createdAt: "2026-09-01T12:00:00Z",
    occurredOn: "2026-08-30",
    title: "Jantar",
    merchantName: null,
    expenseType: "itemized",
    totalCents: 11000,
    serviceFeeBasisPoints: 1000,
    fixedFeeCents: 0,
    payload: {
      items: [],
      participants: [],
      shares: [],
      payers: [],
      itemAssignments: null,
    },
    changeSummary: null,
    ...overrides,
  };
}

export function makeUserParticipant(
  index: number,
  shareCents: number,
  paidCents = 0,
  user = { id: "user-alice", handle: "alice", name: "Alice Silva", avatarUrl: null },
): Participant {
  return { participantIndex: index, kind: "user", shareCents, paidCents, user, guest: null };
}

export function makeGuestParticipant(
  index: number,
  shareCents: number,
  guest = { id: "guest-uuid-1", displayName: "Maria", claimedBy: null, claimLinkGeneration: 0 },
): Participant {
  return { participantIndex: index, kind: "guest", shareCents, paidCents: 0, user: null, guest };
}

export function makeGroupMember(userId: string, name: string): GroupMember {
  return {
    groupId: "group-1",
    userId,
    status: "accepted",
    invitedBy: null,
    acceptedAt: "2026-08-01T00:00:00Z",
    user: { id: userId, handle: name.toLowerCase().split(" ")[0], name, avatarUrl: null },
  };
}

export function makeExpenseDetail(
  input: {
    expense?: Partial<ExpenseRecord>;
    current?: Partial<ExpenseVersion>;
    participants?: Participant[];
  } = {},
): ExpenseDetail {
  const current = makeExpenseVersion({
    expenseId: input.expense?.id ?? "exp-detail-1",
    ...input.current,
  });
  return {
    expense: {
      id: "exp-detail-1",
      groupId: "group-1",
      creatorId: "user-alice",
      status: "active",
      currentVersionNo: 1,
      occurredOn: "2026-08-30",
      createdAt: "2026-08-30T10:00:00Z",
      deletedAt: null,
      deletedBy: null,
      ...input.expense,
    },
    current,
    versions: [current],
    participants: input.participants ?? [makeUserParticipant(0, 11000, 11000)],
    group: { id: "group-1", name: "Amigos", kind: "group" },
  };
}

