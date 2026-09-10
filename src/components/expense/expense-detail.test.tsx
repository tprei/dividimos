import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExpenseDetail } from "./expense-detail";
import { LedgerError } from "@/lib/sync/errors";
import { deleteExpense } from "@/lib/sync/mutations";
import { refreshExpense } from "@/lib/sync/refresh";
import { useAppStore } from "@/stores/app-store";
import type { ExpenseDetail as ExpenseDetailType, GroupSnapshot, Me } from "@/types/ledger";

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  prefetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/sync/refresh", () => ({
  refreshExpense: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/sync/mutations", () => ({
  deleteExpense: vi.fn().mockResolvedValue({
    groupId: "g1",
    ledgerVersion: 2,
    eventId: 1,
  }),
  restoreExpense: vi.fn().mockResolvedValue({
    groupId: "g1",
    ledgerVersion: 2,
    eventId: 1,
  }),
}));

vi.mock("@/lib/sync/mutations-group", () => ({
  issueGuestClaimToken: vi.fn().mockResolvedValue("guest_token_123"),
}));

const me: Me = {
  id: "user-1",
  handle: "alice",
  name: "Alice",
  avatarUrl: null,
  email: "alice@example.com",
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: true,
  notificationPreferences: {},
};

function snapshot(): GroupSnapshot {
  return {
    group: {
      id: "g1",
      kind: "group",
      name: "Viagem",
      creatorId: "user-1",
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
    },
    members: [
      {
        groupId: "g1",
        userId: "user-1",
        status: "accepted",
        invitedBy: null,
        acceptedAt: null,
        user: { id: "user-1", handle: "alice", name: "Alice", avatarUrl: null },
      },
      {
        groupId: "g1",
        userId: "user-2",
        status: "accepted",
        invitedBy: null,
        acceptedAt: null,
        user: { id: "user-2", handle: "carol", name: "Carol Souza", avatarUrl: null },
      },
    ],
    balances: [],
    guests: [],
    settlements: [],
    recentExpenses: [],
    expenseCount: 0,
    lastEventId: 1,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-02T00:00:00Z",
    pairwiseEdges: [],
  };
}

function makeDetail(
  status: "active" | "deleted" = "active",
): ExpenseDetailType {
  return {
    expense: {
      id: "e1",
      groupId: "g1",
      creatorId: "user-1",
      status,
      currentVersionNo: 2,
      occurredOn: "2026-09-01",
      createdAt: "2026-09-01T12:00:00Z",
      deletedAt: status === "deleted" ? "2026-09-02T12:00:00Z" : null,
      deletedBy: status === "deleted" ? "user-1" : null,
    },
    current: {
      expenseId: "e1",
      versionNo: 2,
      authorId: "user-2",
      createdAt: "2026-09-02T12:00:00Z",
      occurredOn: "2026-09-01",
      title: "Jantar",
      merchantName: "Restaurante Mar",
      expenseType: "single_amount",
      totalCents: 12000,
      serviceFeeBasisPoints: 0,
      fixedFeeCents: 0,
      payload: {
        items: [],
        participants: [
          { kind: "user", userId: "user-1" },
          { kind: "guest", guestId: "guest-1", displayName: "Bruno" },
        ],
        shares: [6000, 6000],
        payers: [{ participantIndex: 0, amountCents: 12000 }],
        itemAssignments: null,
      },
      changeSummary: {
        title: ["Almoço", "Jantar"],
        totalCents: null,
        participantsAdded: [],
        participantsRemoved: [],
        payersChanged: false,
      },
    },
    versions: [
      {
        expenseId: "e1",
        versionNo: 1,
        authorId: "user-1",
        createdAt: "2026-09-01T12:00:00Z",
        occurredOn: "2026-09-01",
        title: "Almoço",
        merchantName: "Restaurante Mar",
        expenseType: "single_amount",
        totalCents: 12000,
        serviceFeeBasisPoints: 0,
        fixedFeeCents: 0,
        payload: {
          items: [],
          participants: [
            { kind: "user", userId: "user-1" },
            { kind: "guest", guestId: "guest-1", displayName: "Bruno" },
          ],
          shares: [6000, 6000],
          payers: [{ participantIndex: 0, amountCents: 12000 }],
          itemAssignments: null,
        },
        changeSummary: null,
      },
      {
        expenseId: "e1",
        versionNo: 2,
        authorId: "user-2",
        createdAt: "2026-09-02T12:00:00Z",
        occurredOn: "2026-09-01",
        title: "Jantar",
        merchantName: "Restaurante Mar",
        expenseType: "single_amount",
        totalCents: 12000,
        serviceFeeBasisPoints: 0,
        fixedFeeCents: 0,
        payload: {
          items: [],
          participants: [
            { kind: "user", userId: "user-1" },
            { kind: "guest", guestId: "guest-1", displayName: "Bruno" },
          ],
          shares: [6000, 6000],
          payers: [{ participantIndex: 0, amountCents: 12000 }],
          itemAssignments: null,
        },
        changeSummary: {
          title: ["Almoço", "Jantar"],
          totalCents: null,
          participantsAdded: [],
          participantsRemoved: [],
          payersChanged: false,
        },
      },
    ],
    participants: [
      {
        participantIndex: 0,
        kind: "user",
        shareCents: 6000,
        paidCents: 12000,
        user: { id: "user-1", handle: "alice", name: "Alice", avatarUrl: null },
        guest: null,
      },
      {
        participantIndex: 1,
        kind: "guest",
        shareCents: 6000,
        paidCents: 0,
        user: null,
        guest: { id: "guest-1", displayName: "Bruno", claimedBy: null },
      },
    ],
    group: {
      id: "g1",
      name: "Viagem",
      kind: "group",
    },
  };
}

function seedStore(status: "active" | "deleted" = "active") {
  const d = makeDetail(status);
  useAppStore.setState({
    hydrated: true,
    me,
    groups: { g1: snapshot() },
    groupOrder: ["g1"],
    expenseDetails: { e1: d },
  });
}

beforeEach(() => {
  useAppStore.getState().reset();
  vi.clearAllMocks();
  vi.mocked(refreshExpense).mockResolvedValue(undefined);
});

describe("ExpenseDetail", () => {
  it("shows guest row with Convidado chip and renders history sentences", () => {
    seedStore("active");
    render(<ExpenseDetail expenseId="e1" />);

    expect(screen.getByText("Convidado")).toBeInTheDocument();
    expect(screen.getByText("Alice criou a conta")).toBeInTheDocument();
    expect(
      screen.getByText("Carol Souza mudou o nome de “Almoço” para “Jantar”"),
    ).toBeInTheDocument();
  });

  it("shows deleted banner and Restaurar button when status is deleted", () => {
    seedStore("deleted");
    render(<ExpenseDetail expenseId="e1" />);

    expect(screen.getByText("Conta excluída")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Restaurar" }),
    ).toBeInTheDocument();
  });

  it("calls deleteExpense when confirming exclusion in dialog", async () => {
    const user = userEvent.setup();
    seedStore("active");
    render(<ExpenseDetail expenseId="e1" />);

    const trigger = screen.getByRole("button", { name: "Excluir" });
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Excluir conta?")).toBeInTheDocument();

    const confirmButton = within(dialog).getByRole("button", {
      name: "Excluir",
    });
    await user.click(confirmButton);

    await waitFor(() => {
      expect(deleteExpense).toHaveBeenCalledWith("e1");
    });
  });

  it("renders EmptyState when expense is not found", async () => {
    vi.mocked(refreshExpense).mockRejectedValueOnce(
      new LedgerError("expense_not_found"),
    );

    render(<ExpenseDetail expenseId="e-missing" />);

    await waitFor(() => {
      expect(
        screen.getByText("Essa conta não está mais disponível"),
      ).toBeInTheDocument();
    });
  });
});
