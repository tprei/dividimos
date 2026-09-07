import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadMoreExpenses } from "@/lib/sync/refresh";
import { useAppStore } from "@/stores/app-store";
import toast from "react-hot-toast";
import { GroupExpensesSection } from "./group-expenses-section";
import type { ExpenseSummary } from "@/types/ledger";

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/lib/sync/refresh", () => ({
  loadMoreExpenses: vi.fn(),
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/bill/voice-expense-modal", () => ({
  VoiceExpenseModal: () => null,
}));

const groupId = "g1";

function expense(id: string, title: string, overrides: Partial<ExpenseSummary> = {}): ExpenseSummary {
  return {
    id,
    groupId,
    creatorId: "user-1",
    status: "active",
    occurredOn: "2026-09-01",
    createdAt: "2026-09-01T12:00:00Z",
    versionNo: 1,
    title,
    merchantName: null,
    expenseType: "single_amount",
    totalCents: 12000,
    myShareCents: 4000,
    myPaidCents: 0,
    participantCount: 3,
    ...overrides,
  };
}

function seed(
  expenses: ExpenseSummary[],
  complete: boolean,
) {
  useAppStore.setState({
    hydrated: true,
    me: null,
    groups: {},
    groupOrder: [],
    expenseLists: {
      [groupId]: { ids: expenses.map((e) => e.id), oldestCursor: null, complete },
    },
    expenses: Object.fromEntries(expenses.map((e) => [e.id, e])),
  });
}

beforeEach(() => {
  useAppStore.getState().reset();
  vi.clearAllMocks();
});

describe("GroupExpensesSection", () => {
  it("renderiza contas com valor, data e link para o detalhe", () => {
    seed([expense("e1", "Jantar"), expense("e2", "Mercado")], true);

    render(<GroupExpensesSection groupId={groupId} members={[]} />);

    expect(screen.getByText("Jantar")).toBeInTheDocument();
    expect(screen.getByText("Mercado")).toBeInTheDocument();
    expect(screen.getAllByText(/Sua parte/)[0]).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Jantar/ })[0]).toHaveAttribute(
      "href",
      `/app/bill/e1`,
    );
  });

  it("oculta contas excluídas", () => {
    seed(
      [
        expense("e1", "Jantar"),
        expense("e2", "Cancelada", { status: "deleted" }),
      ],
      true,
    );

    render(<GroupExpensesSection groupId={groupId} members={[]} />);

    expect(screen.getByText("Jantar")).toBeInTheDocument();
    expect(screen.queryByText("Cancelada")).not.toBeInTheDocument();
  });

  it("esconde Carregar mais quando a lista está completa", () => {
    seed([expense("e1", "Jantar")], true);

    render(<GroupExpensesSection groupId={groupId} members={[]} />);

    expect(
      screen.queryByRole("button", { name: /Carregar mais/ }),
    ).not.toBeInTheDocument();
  });

  it("carrega mais despesas ao clicar no botão", async () => {
    vi.mocked(loadMoreExpenses).mockResolvedValue(undefined);
    seed(
      [
        expense("e1", "Jantar"),
        expense("e2", "Mercado"),
        expense("e3", "Uber"),
      ],
      false,
    );

    render(<GroupExpensesSection groupId={groupId} members={[]} />);

    await userEvent.click(
      screen.getByRole("button", { name: /Carregar mais/ }),
    );

    await waitFor(() => {
      expect(loadMoreExpenses).toHaveBeenCalledWith(groupId);
    });
  });

  it("mostra erro quando carregar mais falha", async () => {
    vi.mocked(loadMoreExpenses).mockRejectedValueOnce(new Error("network"));
    seed([expense("e1", "Jantar"), expense("e2", "Mercado")], false);

    render(<GroupExpensesSection groupId={groupId} members={[]} />);

    await userEvent.click(
      screen.getByRole("button", { name: /Carregar mais/ }),
    );

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });

  it("mostra estado vazio e botão nova conta", async () => {
    seed([], true);
    render(<GroupExpensesSection groupId={groupId} members={[]} />);

    expect(screen.getByText("Nenhuma conta ainda")).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole("button", { name: /Nova conta/ })[0]);
    expect(routerMock.push).toHaveBeenCalledWith(`/app/bill/new?groupId=${groupId}`);
  });
});
