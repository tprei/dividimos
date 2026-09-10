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
      [groupId]: { ids: expenses.map((e) => e.id), cursor: null, complete, total: null },
    },
    expenses: Object.fromEntries(expenses.map((e) => [e.id, e])),
  });
}

beforeEach(() => {
  useAppStore.getState().reset();
  vi.clearAllMocks();
});

describe("GroupExpensesSection", () => {
  it("renders bills with amount, date and a link to the detail", () => {
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

  it("hides deleted bills", () => {
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

  it("hides Load more when the list is complete", () => {
    seed([expense("e1", "Jantar")], true);

    render(<GroupExpensesSection groupId={groupId} members={[]} />);

    expect(
      screen.queryByRole("button", { name: /Carregar mais/ }),
    ).not.toBeInTheDocument();
  });

  it("loads more expenses when the button is clicked", async () => {
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

  it("shows an error when loading more fails", async () => {
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

  it("shows the empty state and a new bill button", async () => {
    seed([], true);
    render(<GroupExpensesSection groupId={groupId} members={[]} />);

    expect(screen.getByText("Nenhuma conta ainda")).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole("button", { name: /Nova conta/ })[0]);
    expect(routerMock.push).toHaveBeenCalledWith(`/app/bill/new?groupId=${groupId}`);
  });
});
