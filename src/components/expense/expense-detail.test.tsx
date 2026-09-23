import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExpenseDetail } from "./expense-detail";
import { LedgerError } from "@/lib/sync/errors";
import { deleteExpense } from "@/lib/sync/mutations";
import { createGuestClaimToken } from "@/lib/sync/mutations-group";
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
  createGuestClaimToken: vi.fn().mockResolvedValue("guest_token_123"),
}));

const me: Me = {
  id: "user-1",
  handle: "alice",
  name: "Alice",
  avatarUrl: null,
  isBot: false,
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
        user: { id: "user-1", handle: "alice", name: "Alice", avatarUrl: null, isBot: false },
      },
      {
        groupId: "g1",
        userId: "user-2",
        status: "accepted",
        invitedBy: null,
        acceptedAt: null,
        user: { id: "user-2", handle: "carol", name: "Carol Souza", avatarUrl: null, isBot: false },
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
        shares: [7000, 5000],
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
          shares: [7000, 5000],
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
          shares: [7000, 5000],
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
        shareCents: 7000,
        paidCents: 12000,
        user: { id: "user-1", handle: "alice", name: "Alice", avatarUrl: null, isBot: false },
        guest: null,
      },
      {
        participantIndex: 1,
        kind: "guest",
        shareCents: 5000,
        paidCents: 0,
        user: null,
        guest: {
          id: "guest-1",
          displayName: "Bruno",
          claimedBy: null,
          claimLinkGeneration: 0,
        },
      },
    ],
    group: {
      id: "g1",
      name: "Viagem",
      kind: "group",
    },
  };
}

function seedStore(
  status: "active" | "deleted" = "active",
  assignmentRoom?: { id: string; hostUserId: string },
) {
  const d = makeDetail(status);
  useAppStore.setState({
    hydrated: true,
    me,
    groups: { g1: snapshot() },
    groupOrder: ["g1"],
    expenseDetails: { e1: d },
    assignmentRoomsByExpenseId: assignmentRoom ? { e1: assignmentRoom } : {},
  });
}

beforeEach(() => {
  useAppStore.getState().reset();
  vi.clearAllMocks();
  vi.mocked(refreshExpense).mockResolvedValue(undefined);
  window.localStorage.clear();
});

describe("ExpenseDetail", () => {
  it("shows guest row with Convidado chip and renders history sentences", () => {
    seedStore("active");
    render(<ExpenseDetail expenseId="e1" />);

    expect(screen.getByText("Convidado")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByText("Alice criou a conta")).toBeInTheDocument();
    expect(
      screen.getByText("Carol Souza mudou o nome de “Almoço” para “Jantar”"),
    ).toBeInTheDocument();
  });
  it("shows the total, per-person consumed/paid/balance rows, and guest shares summing to the total", () => {
    seedStore("active");
    render(<ExpenseDetail expenseId="e1" />);

    const list = within(screen.getByRole("list", { name: "Participantes" }));
    const rows = list.getAllByRole("listitem");
    expect(within(rows[0]).getByText("Você")).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element?.textContent?.replace(/\s+/g, " ") ===
          "Consumiu R$ 70,00 · Pagou R$ 120,00",
      ),
    ).toBeInTheDocument();
    expect(
      within(rows[0]).getByLabelText("Saldo de Alice nessa conta").textContent,
    ).toBe("+R$\u00a050,00");
    expect(within(rows[1]).getByText("Convidado")).toBeInTheDocument();
    expect(within(rows[1]).getByText("R$ 50,00")).toBeInTheDocument();
    expect(
      within(rows[1]).getByLabelText("Saldo de Bruno nessa conta").textContent,
    ).toBe("\u2212R$\u00a050,00");
    expect(screen.getAllByText("R$ 120,00")).toHaveLength(3);
    expect(screen.queryByText(/depois de entrar/i)).not.toBeInTheDocument();
  });

  it("opens the invite surface from the guest row and issues a link only when asked", async () => {
    const user = userEvent.setup();
    seedStore("active");
    render(<ExpenseDetail expenseId="e1" />);

    await user.click(
      screen.getByRole("button", { name: "Convidar Bruno" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Convidar Bruno"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Parte de R$ 50,00 em Jantar"),
    ).toBeInTheDocument();
    // Opening a surface must not mint a credential.
    expect(createGuestClaimToken).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Gerar link" }));

    await waitFor(() => {
      expect(createGuestClaimToken).toHaveBeenCalledWith("guest-1");
    });
    await waitFor(() => {
      expect(refreshExpense).toHaveBeenCalledWith("e1");
    });
  });

  it("returns to /app from the Pronto footer", async () => {
    const user = userEvent.setup();
    seedStore("active");
    render(<ExpenseDetail expenseId="e1" />);

    await user.click(screen.getByRole("button", { name: "Pronto" }));

    expect(routerMock.push).toHaveBeenCalledWith("/app");
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

  it("hides linked mutation actions from a nonhost party", () => {
    seedStore("active", { id: "room-1", hostUserId: "user-2" });
    render(<ExpenseDetail expenseId="e1" />);

    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Excluir" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ver sala" })).not.toBeInTheDocument();
  });

  it("links a room host back to the read-only board", async () => {
    const user = userEvent.setup();
    seedStore("active", { id: "room-1", hostUserId: me.id });
    render(<ExpenseDetail expenseId="e1" />);

    await user.click(screen.getByRole("button", { name: "Ver sala" }));
    expect(routerMock.push).toHaveBeenCalledWith("/room/room-1");
    expect(screen.getByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Excluir" })).toBeInTheDocument();
  });

  it("audits room consumption and history in keyboard-accessible tabs without losing guest actions", async () => {
    const user = userEvent.setup();
    seedStore("active", { id: "room-1", hostUserId: me.id });
    const detail = makeDetail();
    detail.current.expenseType = "itemized";
    detail.current.payload.items = [{
      description: "Jantar completo",
      quantityMilliunits: 1000,
      unitPriceCents: 12000,
      totalPriceCents: 12000,
    }];
    detail.current.payload.itemAssignments = [
      { itemIndex: 0, participantIndex: 0, amountCents: 7000 },
      { itemIndex: 0, participantIndex: 1, amountCents: 5000 },
    ];
    useAppStore.setState({ expenseDetails: { e1: detail } });
    const { unmount } = render(<ExpenseDetail expenseId="e1" />);

    const people = screen.getByRole("tab", { name: "Por pessoa" });
    expect(people).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Saldo de Bruno nessa conta")).toHaveTextContent("−R$ 50,00");
    expect(screen.queryByText("Jantar completo")).not.toBeInTheDocument();
    expect(screen.queryByText("Alice criou a conta")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Resumo por pessoa" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Por item" }));
    expect(screen.getByRole("tabpanel", { name: "Por item" })).toHaveTextContent("Jantar completo");
    expect(screen.queryByRole("list", { name: "Participantes" })).not.toBeInTheDocument();

    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Histórico" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("tabpanel", { name: "Histórico" })).toHaveTextContent("Alice criou a conta");

    await user.click(people);
    await user.click(screen.getByRole("button", { name: "Convidar Bruno" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Parte de R$ 50,00 em Jantar");
    expect(createGuestClaimToken).not.toHaveBeenCalled();

    unmount();
    render(<ExpenseDetail expenseId="e1" />);
    expect(screen.getByRole("tab", { name: "Por pessoa" })).toHaveAttribute("aria-selected", "true");
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
