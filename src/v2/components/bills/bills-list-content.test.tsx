import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ExpenseSummary, GroupSnapshot, Me } from "@/types/ledger";
import { useAppStore } from "@/stores/app-store";
import { LedgerError } from "@/lib/sync/errors";
import { BillsListContent } from "./bills-list-content";

const mutations = vi.hoisted(() => ({
  deleteExpense: vi.fn(),
}));
vi.mock("@/lib/sync/mutations", () => mutations);

const toastError = vi.fn();
vi.mock("react-hot-toast", () => ({
  default: {
    error: (message: string) => toastError(message),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const me: Me = {
  id: "user-1",
  handle: "alice",
  name: "Alice Souza",
  avatarUrl: null,
  email: "alice@example.com",
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: true,
  notificationPreferences: {},
};

const carol = { id: "user-2", handle: "carol", name: "Carol Souza", avatarUrl: null };

function snapshot(overrides: Partial<GroupSnapshot> = {}): GroupSnapshot {
  const base: GroupSnapshot = {
    group: {
      id: "g1",
      kind: "group",
      name: "Viagem",
      creatorId: me.id,
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
    },
    members: [
      { groupId: "g1", userId: me.id, status: "accepted", invitedBy: null, acceptedAt: null, user: me },
      { groupId: "g1", userId: carol.id, status: "accepted", invitedBy: null, acceptedAt: null, user: carol },
    ],
    balances: [],
    guests: [],
    pendingSettlements: [],
    recentExpenses: [],
    lastEventId: 0,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-02T00:00:00Z",
  };
  return { ...base, ...overrides, group: { ...base.group, ...overrides.group } };
}

function expense(overrides: Partial<ExpenseSummary> = {}): ExpenseSummary {
  return {
    id: "e1",
    groupId: "g1",
    creatorId: me.id,
    status: "active",
    occurredOn: "2026-08-20",
    createdAt: "2026-08-20T12:00:00Z",
    versionNo: 1,
    title: "Conta",
    merchantName: null,
    expenseType: "single_amount",
    totalCents: 9000,
    myShareCents: 4500,
    myPaidCents: 0,
    participantCount: 2,
    ...overrides,
  };
}

const groupSnapshot = snapshot();
const dmSnapshot = snapshot({
  group: {
    id: "dm1",
    kind: "dm",
    name: "",
    creatorId: me.id,
    dmUserA: me.id,
    dmUserB: carol.id,
    ledgerVersion: 1,
    createdAt: "2026-01-01T00:00:00Z",
  },
});

function seedStore(expenses: Record<string, ExpenseSummary>) {
  useAppStore.setState({
    hydrated: true,
    me,
    groups: { [groupSnapshot.group.id]: groupSnapshot, [dmSnapshot.group.id]: dmSnapshot },
    groupOrder: [groupSnapshot.group.id, dmSnapshot.group.id],
    expenses,
  });
}

const tripExpenseOld = expense({
  id: "e-old",
  groupId: "g1",
  title: "Aluguel",
  occurredOn: "2026-08-20",
  createdAt: "2026-08-20T12:00:00Z",
});

const tripExpenseNewer = expense({
  id: "e-newer",
  groupId: "g1",
  title: "Mercado",
  merchantName: "Assaí",
  occurredOn: "2026-08-20",
  createdAt: "2026-08-21T12:00:00Z",
});

const dmExpense = expense({
  id: "e-dm",
  groupId: "dm1",
  title: "Cinema",
  occurredOn: "2026-09-01",
  createdAt: "2026-09-01T20:00:00Z",
});

const seededExpenses = {
  [tripExpenseOld.id]: tripExpenseOld,
  [tripExpenseNewer.id]: tripExpenseNewer,
  [dmExpense.id]: dmExpense,
};

function rowLinks(container: HTMLElement): Array<string | null> {
  return Array.from(container.querySelectorAll("a[href^='/app/bill/']")).map((a) =>
    a.getAttribute("href"),
  );
}

describe("BillsListContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.getState().reset();
  });

  it("renders the skeleton before hydration", () => {
    useAppStore.setState({ hydrated: false, me: null });
    const { container } = render(<BillsListContent />);

    expect(screen.queryByText("Suas contas")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(container.querySelector("a")).toBeNull();
  });

  it("orders rows by occurredOn desc then createdAt desc", () => {
    seedStore(seededExpenses);
    const { container } = render(<BillsListContent />);

    expect(rowLinks(container)).toEqual([
      "/app/bill/e-dm",
      "/app/bill/e-newer",
      "/app/bill/e-old",
    ]);
  });

  it("shows the counterparty name for DM rows and the group name for groups", () => {
    seedStore(seededExpenses);
    render(<BillsListContent />);

    const dmRow = screen.getByText("Cinema").closest("a");
    expect(dmRow).not.toBeNull();
    expect(within(dmRow as HTMLElement).getByText("Carol Souza")).toBeInTheDocument();

    const groupRow = screen.getByText("Aluguel").closest("a");
    expect(groupRow).not.toBeNull();
    expect(within(groupRow as HTMLElement).getByText("Viagem")).toBeInTheDocument();
  });

  it("filters by title and merchant name", () => {
    seedStore(seededExpenses);
    render(<BillsListContent />);
    const query = (val: string) =>
      fireEvent.change(screen.getByPlaceholderText(/buscar/i), { target: { value: val } });

    query("mercado");
    expect(screen.getByText("Mercado")).toBeInTheDocument();
    expect(screen.queryByText("Aluguel")).not.toBeInTheDocument();
    expect(screen.queryByText("Cinema")).not.toBeInTheDocument();

    query("assa");
    expect(screen.getByText("Mercado")).toBeInTheDocument();
    expect(screen.queryByText("Aluguel")).not.toBeInTheDocument();
    expect(screen.queryByText("Cinema")).not.toBeInTheDocument();

    query("nao_existe");
    expect(screen.getByText("Nenhuma conta por aqui")).toBeInTheDocument();
    expect(screen.getByText('Sem resultados para "nao_existe".')).toBeInTheDocument();
  });

  it("shows a deleted chip instead of swipe actions on deleted rows", () => {
    seedStore({
      ...seededExpenses,
      [dmExpense.id]: { ...dmExpense, status: "deleted" },
    });
    render(<BillsListContent />);

    expect(screen.getByText("Excluída")).toBeInTheDocument();
  });

  it("deletes the row expense after swipe delete and confirmation", async () => {
    mutations.deleteExpense.mockResolvedValueOnce({});
    seedStore(seededExpenses);
    const user = userEvent.setup();
    render(<BillsListContent />);

    await user.click(screen.getAllByRole("button", { name: "Excluir conta" })[0]);
    expect(screen.getByText("Excluir conta?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Excluir" }));
    expect(mutations.deleteExpense).toHaveBeenCalledWith("e-dm");

    await waitFor(() => {
      expect(screen.queryByText("Excluir conta?")).not.toBeInTheDocument();
    });
  });

  it("toasts and keeps the dialog open when delete fails", async () => {
    mutations.deleteExpense.mockRejectedValueOnce(new LedgerError("network"));
    seedStore(seededExpenses);
    const user = userEvent.setup();
    render(<BillsListContent />);

    await user.click(screen.getAllByRole("button", { name: "Excluir conta" })[0]);
    await user.click(screen.getByRole("button", { name: "Excluir" }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("Sem conexão. Tente de novo quando a internet voltar.");
    });
    expect(screen.getByText("Excluir conta?")).toBeInTheDocument();
  });
});
