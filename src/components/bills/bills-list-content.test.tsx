import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BillsListContent } from "./bills-list-content";
import type { ExpenseStatus } from "@/types";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Mock useUser hook
vi.mock("@/hooks/use-auth", () => ({
  useUser: () => ({ id: "user-1", name: "Test User" }),
}));

// Mock deleteExpense
vi.mock("@/lib/supabase/expense-actions", () => ({
  deleteExpense: vi.fn().mockResolvedValue({}),
}));

function makeBill(overrides: Partial<{
  id: string;
  title: string;
  date: string;
  total: number;
  participants: number;
  status: ExpenseStatus;
  creatorId: string;
}> = {}) {
  return {
    id: overrides.id ?? "bill-1",
    title: overrides.title ?? "Jantar",
    date: overrides.date ?? "15 mar",
    total: overrides.total ?? 10000,
    participants: overrides.participants ?? 3,
    status: overrides.status ?? "active",
    creatorId: overrides.creatorId ?? "user-1",
  };
}

describe("BillsListContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all bills", () => {
    const bills = [
      makeBill({ id: "1", title: "Jantar" }),
      makeBill({ id: "2", title: "Almoço" }),
    ];
    render(<BillsListContent initialBills={bills} />);

    expect(screen.getByText("Jantar")).toBeInTheDocument();
    expect(screen.getByText("Almoço")).toBeInTheDocument();
    expect(screen.getByText("2 contas no total")).toBeInTheDocument();
  });

  it("shows singular count for one bill", () => {
    render(<BillsListContent initialBills={[makeBill()]} />);
    expect(screen.getByText("1 conta no total")).toBeInTheDocument();
  });

  it("renders status badges without partially_settled", () => {
    const bills = [
      makeBill({ id: "1", status: "draft", title: "Rascunho bill" }),
      makeBill({ id: "2", status: "active", title: "Active bill" }),
      makeBill({ id: "3", status: "settled", title: "Settled bill" }),
    ];
    render(<BillsListContent initialBills={bills} />);

    expect(screen.getByText("Rascunho")).toBeInTheDocument();
    expect(screen.getByText("Pendente")).toBeInTheDocument();
    expect(screen.getByText("Quitada")).toBeInTheDocument();
  });

  it("filters by status", async () => {
    const user = userEvent.setup();
    const bills = [
      makeBill({ id: "1", status: "active", title: "Active bill" }),
      makeBill({ id: "2", status: "settled", title: "Settled bill" }),
    ];
    render(<BillsListContent initialBills={bills} />);

    // Filter to settled only
    await user.click(screen.getByRole("button", { name: "Quitadas" }));

    expect(screen.queryByText("Active bill")).not.toBeInTheDocument();
    expect(screen.getByText("Settled bill")).toBeInTheDocument();
  });

  it("does not have partially_settled filter", () => {
    render(<BillsListContent initialBills={[]} />);

    // Should have: Todas, Pendentes, Liquidadas
    expect(screen.getByRole("button", { name: "Todas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pendentes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitadas" })).toBeInTheDocument();

    // Should NOT have Parciais
    expect(screen.queryByRole("button", { name: "Parciais" })).not.toBeInTheDocument();
  });

  it("filters by search text", async () => {
    const user = userEvent.setup();
    const bills = [
      makeBill({ id: "1", title: "Jantar no bar" }),
      makeBill({ id: "2", title: "Almoço" }),
    ];
    render(<BillsListContent initialBills={bills} />);

    await user.type(screen.getByPlaceholderText("Buscar..."), "bar");

    expect(screen.getByText("Jantar no bar")).toBeInTheDocument();
    expect(screen.queryByText("Almoço")).not.toBeInTheDocument();
  });

  it("shows empty state when no bills match", async () => {
    const user = userEvent.setup();
    render(<BillsListContent initialBills={[makeBill({ title: "Jantar" })]} />);

    await user.type(screen.getByPlaceholderText("Buscar..."), "xyz");

    expect(screen.getByText("Nenhuma conta por aqui")).toBeInTheDocument();
  });
});
