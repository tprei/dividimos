import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardContent } from "./dashboard-content";
import type { ExpenseStatus } from "@/types";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Mock useUser hook
vi.mock("@/hooks/use-auth", () => ({
  useUser: () => ({ id: "user-1", name: "Test User", avatarUrl: null }),
}));

// Mock useBillInvites
vi.mock("@/hooks/use-bill-invites", () => ({
  useBillInvites: () => ({ invites: [], loading: false }),
}));

// Mock supabase client
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        order: () => ({ limit: () => Promise.resolve({ data: [] }) }),
        eq: () => ({ neq: () => Promise.resolve({ data: [] }) }),
        or: () => Promise.resolve({ data: [] }),
        in: () => Promise.resolve({ data: [] }),
      }),
    }),
  }),
}));

// Mock deleteExpense
vi.mock("@/lib/supabase/expense-actions", () => ({
  deleteExpense: vi.fn().mockResolvedValue({}),
}));

function makeRecentBill(overrides: Partial<{
  id: string;
  title: string;
  date: string;
  total: number;
  participants: number;
  status: ExpenseStatus;
  myBalance: number;
  creatorId: string;
}> = {}) {
  return {
    id: overrides.id ?? "bill-1",
    title: overrides.title ?? "Jantar",
    date: overrides.date ?? "15 mar",
    total: overrides.total ?? 10000,
    participants: overrides.participants ?? 3,
    status: overrides.status ?? "active",
    myBalance: overrides.myBalance ?? 0,
    creatorId: overrides.creatorId ?? "user-1",
  };
}

describe("DashboardContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders greeting and user name", () => {
    render(<DashboardContent initialBills={[]} initialNetBalance={0} />);
    expect(screen.getByText("Test")).toBeInTheDocument();
  });

  it("renders recent bills with expense statuses", () => {
    const bills = [
      makeRecentBill({ id: "1", status: "active", title: "Ativa" }),
      makeRecentBill({ id: "2", status: "settled", title: "Liquidada" }),
    ];
    render(<DashboardContent initialBills={bills} initialNetBalance={0} />);

    expect(screen.getByText("Ativa")).toBeInTheDocument();
    expect(screen.getByText("Liquidada")).toBeInTheDocument();
    expect(screen.getByText("Pendente")).toBeInTheDocument();
    expect(screen.getByText("Liquidado")).toBeInTheDocument();
  });

  it("shows positive net balance as A receber", () => {
    render(<DashboardContent initialBills={[]} initialNetBalance={5000} />);
    expect(screen.getByText("A receber")).toBeInTheDocument();
    expect(screen.getByText("R$ 50,00")).toBeInTheDocument();
  });

  it("shows negative net balance as A pagar", () => {
    render(<DashboardContent initialBills={[]} initialNetBalance={-3000} />);
    expect(screen.getByText("A pagar")).toBeInTheDocument();
    expect(screen.getByText("R$ 30,00")).toBeInTheDocument();
  });

  it("counts pending bills correctly", () => {
    const bills = [
      makeRecentBill({ id: "1", status: "active" }),
      makeRecentBill({ id: "2", status: "active" }),
      makeRecentBill({ id: "3", status: "settled" }),
    ];
    render(<DashboardContent initialBills={bills} initialNetBalance={0} />);
    expect(screen.getByText("2 contas pendentes")).toBeInTheDocument();
  });

  it("shows empty state when no bills", () => {
    render(<DashboardContent initialBills={[]} initialNetBalance={0} />);
    expect(screen.getByText("Nenhuma conta ainda")).toBeInTheDocument();
  });
});
