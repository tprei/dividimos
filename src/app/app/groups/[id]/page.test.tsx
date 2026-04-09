import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Build a chainable Supabase mock
function chainable(resolveValue: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ["from", "select", "eq", "neq", "in", "is", "order", "limit", "single", "maybeSingle", "insert", "delete", "rpc"];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  // Terminal: return promise
  chain.then = (resolve: (v: unknown) => void) => resolve(resolveValue);
  return chain;
}

// Supabase mock that returns different data per table
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
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
    removeChannel: vi.fn(),
  };
}

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => createMockSupabase(),
}));

// Mock auth hook
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

// Mock settlement-actions for per-member balance display
vi.mock("@/lib/supabase/settlement-actions", () => ({
  queryGroupBalancesForUser: vi.fn().mockResolvedValue(new Map([
    ["user-2", 1500],
  ])),
}));

// Mock GroupSettlementView since it has its own complex dependencies
vi.mock("@/components/group/group-settlement-view", () => ({
  GroupSettlementView: ({ groupId }: { groupId: string }) => (
    <div data-testid="settlement-view">Settlement for {groupId}</div>
  ),
}));

// Mock react-hot-toast
vi.mock("react-hot-toast", () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Import the page component - it uses React.use() for params
// We need to wrap it to provide the params promise
import GroupDetailPage from "./page";

async function renderPage(groupId = "group-1") {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <Suspense fallback={<div>Loading...</div>}>
        <GroupDetailPage params={Promise.resolve({ id: groupId })} />
      </Suspense>,
    );
  });
  return result!;
}

describe("GroupDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpcResult = { data: null, error: null };
    // Default data: group with 2 members, 1 expense, 1 settlement
    mockSupabaseData.groups = { name: "Test Group", creator_id: "user-1" };
    mockSupabaseData.group_members = [
      { user_id: "user-1", status: "accepted", invited_by: "user-1" },
      { user_id: "user-2", status: "accepted", invited_by: "user-1" },
    ];
    mockSupabaseData.user_profiles = [
      { id: "user-1", handle: "alice", name: "Alice Test", avatar_url: null },
      { id: "user-2", handle: "bob", name: "Bob Test", avatar_url: null },
    ];
    mockSupabaseData.expenses = [
      {
        id: "exp-1",
        title: "Almoço",
        total_amount: 5000,
        status: "active",
        created_at: "2026-03-28T12:00:00Z",
      },
    ];
    mockSupabaseData.expense_guests = [];
    mockSupabaseData.group_invite_links = [
      { token: "invite-token-123" },
    ];
    mockSupabaseData.settlements = [
      {
        id: "stl-1",
        group_id: "group-1",
        from_user_id: "user-2",
        to_user_id: "user-1",
        amount_cents: 2500,
        status: "confirmed",
        created_at: "2026-03-28T13:00:00Z",
        confirmed_at: "2026-03-28T14:00:00Z",
      },
    ];
  });

  it("renders loading skeleton initially", async () => {
    await renderPage();
    expect(document.querySelectorAll("[class*='animate-pulse'], [class*='skeleton']").length).toBeGreaterThanOrEqual(0);
  });

  it("renders group name after loading", async () => {
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText("Test Group")).toBeTruthy();
    });
  });

  it("shows members tab by default with member list", async () => {
    await renderPage();
    await waitFor(() => {
      expect(screen.getByText("Alice Test")).toBeTruthy();
    });
  });

  it("switches to contas tab and shows expenses", async () => {
    const user = userEvent.setup();
    await renderPage();

    await waitFor(() => {
      expect(screen.getByText("Test Group")).toBeTruthy();
    });

    await user.click(screen.getByText("Contas"));

    await waitFor(() => {
      expect(screen.getByText("Almoço")).toBeTruthy();
      expect(screen.getByText("Pendente")).toBeTruthy();
    });
  });

  it("switches to pagamentos tab and shows settlement history", async () => {
    const user = userEvent.setup();
    await renderPage();

    await waitFor(() => {
      expect(screen.getByText("Test Group")).toBeTruthy();
    });

    await user.click(screen.getByText("Pagamentos"));

    await waitFor(() => {
      expect(screen.getByText("Confirmado")).toBeTruthy();
    });
  });

  it("switches to acerto tab and shows settlement view", async () => {
    const user = userEvent.setup();
    await renderPage();

    await waitFor(() => {
      expect(screen.getByText("Test Group")).toBeTruthy();
    });

    await user.click(screen.getByText("Acerto"));

    await waitFor(() => {
      expect(screen.getByTestId("settlement-view")).toBeTruthy();
    });
  });

  it("shows invite button for group creator", async () => {
    await renderPage();

    await waitFor(() => {
      expect(screen.getByText("Convidar")).toBeTruthy();
    });
  });

  it("shows invite link button for group creator", async () => {
    await renderPage();

    await waitFor(() => {
      expect(screen.getByLabelText("Compartilhar convite")).toBeTruthy();
    });
  });

  it("shows empty state with CTA when no expenses", async () => {
    mockSupabaseData.expenses = [];
    const user = userEvent.setup();
    await renderPage();

    await waitFor(() => {
      expect(screen.getByText("Test Group")).toBeTruthy();
    });

    await user.click(screen.getByText("Contas"));

    await waitFor(() => {
      expect(screen.getByText("Nenhuma conta ainda")).toBeTruthy();
      expect(
        screen.getByText(
          "Adiciona uma conta pra dividir com o grupo. Pode ser um jantar, mercado, ou qualquer gasto compartilhado.",
        ),
      ).toBeTruthy();
    });
  });

  it("shows empty state when no settlements", async () => {
    mockSupabaseData.settlements = [];
    const user = userEvent.setup();
    await renderPage();

    await waitFor(() => {
      expect(screen.getByText("Test Group")).toBeTruthy();
    });

    await user.click(screen.getByText("Pagamentos"));

    await waitFor(() => {
      expect(screen.getByText("Nenhum pagamento ainda")).toBeTruthy();
      expect(
        screen.getByText(
          "Quando alguém pagar uma dívida do grupo, o registro aparece aqui.",
        ),
      ).toBeTruthy();
    });
  });

  it("shows new expense button in contas tab", async () => {
    const user = userEvent.setup();
    await renderPage();

    await waitFor(() => {
      expect(screen.getByText("Test Group")).toBeTruthy();
    });

    await user.click(screen.getByText("Contas"));

    await waitFor(() => {
      expect(screen.getByText("Nova conta")).toBeTruthy();
    });
  });

  it("shows confirmation dialog when clicking remove member", async () => {
    const user = userEvent.setup();
    await renderPage();

    await waitFor(() => {
      expect(screen.getByText("Bob Test")).toBeTruthy();
    });

    const removeButtons = screen.getAllByRole("button").filter(
      (btn) => btn.querySelector("svg.lucide-trash-2") !== null,
    );
    expect(removeButtons.length).toBeGreaterThan(0);

    await user.click(removeButtons[0]);

    // Confirmation dialog should appear
    await waitFor(() => {
      expect(screen.getByText("Remover membro")).toBeTruthy();
    });
    expect(screen.getByText("Cancelar")).toBeTruthy();
    expect(screen.getByText("Remover")).toBeTruthy();

    // RPC should NOT have been called yet
    expect(mockRpcFn).not.toHaveBeenCalled();
  });

  it("calls remove_group_member RPC after confirming removal", async () => {
    const user = userEvent.setup();
    await renderPage();

    await waitFor(() => {
      expect(screen.getByText("Bob Test")).toBeTruthy();
    });

    const removeButtons = screen.getAllByRole("button").filter(
      (btn) => btn.querySelector("svg.lucide-trash-2") !== null,
    );
    await user.click(removeButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Remover membro")).toBeTruthy();
    });

    // Click confirm
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
    await renderPage();

    await waitFor(() => {
      expect(screen.getByText("Bob Test")).toBeTruthy();
    });

    const removeButtons = screen.getAllByRole("button").filter(
      (btn) => btn.querySelector("svg.lucide-trash-2") !== null,
    );
    await user.click(removeButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Remover membro")).toBeTruthy();
    });

    // Click cancel
    await user.click(screen.getByText("Cancelar"));

    // RPC should NOT have been called
    expect(mockRpcFn).not.toHaveBeenCalled();
  });

  it("shows per-member balance in members tab", async () => {
    await renderPage();

    await waitFor(() => {
      expect(screen.getByText("Bob Test")).toBeTruthy();
    });

    // The mock returns user-2 (Bob) with +1500 balance (te deve)
    await waitFor(() => {
      expect(screen.getByText("te deve")).toBeTruthy();
      expect(screen.getByText(/15,00/)).toBeTruthy();
    });
  });

  it("shows toast error when removing member with outstanding balance", async () => {
    const toast = await import("react-hot-toast");
    mockRpcResult = {
      data: null,
      error: { message: "has_outstanding_balance: member has unsettled debts" },
    };

    const user = userEvent.setup();
    await renderPage();

    await waitFor(() => {
      expect(screen.getByText("Bob Test")).toBeTruthy();
    });

    const removeButtons = screen.getAllByRole("button").filter(
      (btn) => btn.querySelector("svg.lucide-trash-2") !== null,
    );

    // Click remove then confirm
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
});
