import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

function chainable(resolveValue: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ["from", "select", "eq", "neq", "in", "is", "or", "order", "limit", "single", "maybeSingle", "insert", "delete", "update", "rpc"];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(resolveValue);
  return chain;
}

const mockSupabaseData: Record<string, unknown> = {};
let mockRpcResult: { data: unknown; error: unknown } = { data: null, error: null };
const mockRpcFn = vi.fn(() => chainable(mockRpcResult));

function createMockSupabase() {
  const fromMock = vi.fn((table: string) => {
    const data = mockSupabaseData[table] ?? [];
    return chainable({ data, error: null });
  });

  return {
    from: fromMock,
    rpc: mockRpcFn,
  };
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => createMockSupabase(),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      name: "Alice Test",
      email: "alice@test.com",
      handle: "alice",
    },
  }),
}));

vi.mock("@/components/group/group-settlement-view", () => ({
  GroupSettlementView: ({ groupId }: { groupId: string }) => (
    <div data-testid="settlement-view">Settlement for {groupId}</div>
  ),
}));

vi.mock("react-hot-toast", () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { GroupDetailContent, type GroupDetailData } from "./group-detail-content";

function buildDefaultData(overrides: Partial<GroupDetailData> = {}): GroupDetailData {
  return {
    groupId: "group-1",
    groupName: "Test Group",
    creatorId: "user-1",
    members: [
      {
        userId: "user-1",
        status: "accepted",
        profile: { id: "user-1", handle: "alice", name: "Alice Test", avatarUrl: undefined },
        invitedBy: "user-1",
      },
      {
        userId: "user-2",
        status: "accepted",
        profile: { id: "user-2", handle: "bob", name: "Bob Test", avatarUrl: undefined },
        invitedBy: "user-1",
      },
    ],
    expenses: [
      {
        id: "exp-1",
        title: "Almoço",
        totalAmount: 5000,
        status: "active",
        createdAt: "2026-03-28T12:00:00Z",
      },
    ],
    settlements: [
      {
        id: "stl-1",
        groupId: "group-1",
        fromUserId: "user-2",
        toUserId: "user-1",
        amountCents: 2500,
        status: "confirmed",
        createdAt: "2026-03-28T13:00:00Z",
        confirmedAt: "2026-03-28T14:00:00Z",
      },
    ],
    unclaimedGuests: [],
    inviteLinkToken: "invite-token-123",
    memberBalances: { "user-2": 1500 },
    ...overrides,
  };
}

describe("GroupDetailContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpcResult = { data: null, error: null };
    mockSupabaseData.groups = { name: "Test Group", creator_id: "user-1" };
    mockSupabaseData.group_members = [
      { user_id: "user-1", status: "accepted", invited_by: "user-1" },
      { user_id: "user-2", status: "accepted", invited_by: "user-1" },
    ];
    mockSupabaseData.user_profiles = [
      { id: "user-1", handle: "alice", name: "Alice Test", avatar_url: null },
      { id: "user-2", handle: "bob", name: "Bob Test", avatar_url: null },
    ];
    mockSupabaseData.expenses = [];
    mockSupabaseData.expense_guests = [];
    mockSupabaseData.group_invite_links = [];
    mockSupabaseData.settlements = [];
    mockSupabaseData.balances = [];
  });

  it("renders group name immediately (no loading state)", () => {
    render(<GroupDetailContent initialData={buildDefaultData()} />);
    expect(screen.getByText("Test Group")).toBeTruthy();
  });

  it("shows members tab by default with member list", () => {
    render(<GroupDetailContent initialData={buildDefaultData()} />);
    expect(screen.getByText("Alice Test")).toBeTruthy();
    expect(screen.getByText("Bob Test")).toBeTruthy();
  });

  it("switches to contas tab and shows expenses", async () => {
    const user = userEvent.setup();
    render(<GroupDetailContent initialData={buildDefaultData()} />);

    await user.click(screen.getByText("Contas"));

    expect(screen.getByText("Almoço")).toBeTruthy();
    expect(screen.getByText("Pendente")).toBeTruthy();
  });

  it("switches to pagamentos tab and shows settlement history", async () => {
    const user = userEvent.setup();
    render(<GroupDetailContent initialData={buildDefaultData()} />);

    await user.click(screen.getByText("Pagamentos"));

    expect(screen.getByText("Confirmado")).toBeTruthy();
  });

  it("switches to acerto tab and shows settlement view", async () => {
    const user = userEvent.setup();
    render(<GroupDetailContent initialData={buildDefaultData()} />);

    await user.click(screen.getByText("Acerto"));

    expect(screen.getByTestId("settlement-view")).toBeTruthy();
  });

  it("shows invite button for group creator", () => {
    render(<GroupDetailContent initialData={buildDefaultData()} />);
    expect(screen.getByText("Convidar")).toBeTruthy();
  });

  it("shows invite link button for group creator", () => {
    render(<GroupDetailContent initialData={buildDefaultData()} />);
    expect(screen.getByLabelText("Compartilhar convite")).toBeTruthy();
  });

  it("shows empty state with CTA when no expenses", async () => {
    const user = userEvent.setup();
    render(<GroupDetailContent initialData={buildDefaultData({ expenses: [] })} />);

    await user.click(screen.getByText("Contas"));

    expect(screen.getByText("Nenhuma conta ainda")).toBeTruthy();
    expect(
      screen.getByText(
        "Adiciona uma conta pra dividir com o grupo. Pode ser um jantar, mercado, ou qualquer gasto compartilhado.",
      ),
    ).toBeTruthy();
  });

  it("shows empty state when no settlements", async () => {
    const user = userEvent.setup();
    render(<GroupDetailContent initialData={buildDefaultData({ settlements: [] })} />);

    await user.click(screen.getByText("Pagamentos"));

    expect(screen.getByText("Nenhum pagamento ainda")).toBeTruthy();
    expect(
      screen.getByText(
        "Quando alguém pagar uma dívida do grupo, o registro aparece aqui.",
      ),
    ).toBeTruthy();
  });

  it("shows new expense button in contas tab", async () => {
    const user = userEvent.setup();
    render(<GroupDetailContent initialData={buildDefaultData()} />);

    await user.click(screen.getByText("Contas"));

    expect(screen.getByText("Nova conta")).toBeTruthy();
  });

  it("shows confirmation dialog when clicking remove member", async () => {
    const user = userEvent.setup();
    render(<GroupDetailContent initialData={buildDefaultData()} />);

    const removeButtons = screen.getAllByRole("button").filter(
      (btn) => btn.querySelector("svg.lucide-trash-2") !== null,
    );
    expect(removeButtons.length).toBeGreaterThan(0);

    await user.click(removeButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Remover membro")).toBeTruthy();
    });
    expect(screen.getByText("Cancelar")).toBeTruthy();
    expect(screen.getByText("Remover")).toBeTruthy();
    expect(mockRpcFn).not.toHaveBeenCalled();
  });

  it("calls remove_group_member RPC after confirming removal", async () => {
    const user = userEvent.setup();
    render(<GroupDetailContent initialData={buildDefaultData()} />);

    const removeButtons = screen.getAllByRole("button").filter(
      (btn) => btn.querySelector("svg.lucide-trash-2") !== null,
    );
    await user.click(removeButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Remover membro")).toBeTruthy();
    });

    await user.click(screen.getByText("Remover"));

    await waitFor(() => {
      expect(mockRpcFn).toHaveBeenCalledWith("remove_group_member", {
        p_group_id: "group-1",
        p_user_id: "user-2",
      });
    });
  });

  it("does not call RPC when cancelling removal", async () => {
    const user = userEvent.setup();
    render(<GroupDetailContent initialData={buildDefaultData()} />);

    const removeButtons = screen.getAllByRole("button").filter(
      (btn) => btn.querySelector("svg.lucide-trash-2") !== null,
    );
    await user.click(removeButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Remover membro")).toBeTruthy();
    });

    await user.click(screen.getByText("Cancelar"));

    expect(mockRpcFn).not.toHaveBeenCalled();
  });

  it("shows per-member balance in members tab", () => {
    render(<GroupDetailContent initialData={buildDefaultData()} />);

    expect(screen.getByText("te deve")).toBeTruthy();
    expect(screen.getByText(/15,00/)).toBeTruthy();
  });

  it("shows toast error when removing member with outstanding balance", async () => {
    const toast = await import("react-hot-toast");
    mockRpcResult = {
      data: null,
      error: { message: "has_outstanding_balance: member has unsettled debts" },
    };

    const user = userEvent.setup();
    render(<GroupDetailContent initialData={buildDefaultData()} />);

    const removeButtons = screen.getAllByRole("button").filter(
      (btn) => btn.querySelector("svg.lucide-trash-2") !== null,
    );

    await user.click(removeButtons[0]);
    await waitFor(() => {
      expect(screen.getByText("Remover membro")).toBeTruthy();
    });
    await user.click(screen.getByText("Remover"));

    await waitFor(() => {
      expect(toast.default.error).toHaveBeenCalledWith(
        "Não é possível remover: este membro possui débitos pendentes no grupo.",
      );
    });
  });

  it("renders without invite buttons when user is not creator or accepted member", () => {
    const data = buildDefaultData({
      creatorId: "someone-else",
      members: [
        {
          userId: "someone-else",
          status: "accepted",
          profile: { id: "someone-else", handle: "creator", name: "Creator", avatarUrl: undefined },
          invitedBy: "someone-else",
        },
        {
          userId: "user-1",
          status: "invited",
          profile: { id: "user-1", handle: "alice", name: "Alice Test", avatarUrl: undefined },
          invitedBy: "someone-else",
        },
      ],
    });
    render(<GroupDetailContent initialData={data} />);

    expect(screen.queryByText("Convidar")).toBeNull();
  });
});
