import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardContent } from "./dashboard-content";
import type { DebtSummary } from "@/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/hooks/use-auth", () => ({
  useUser: () => ({ id: "user-1", name: "Test User", avatarUrl: null }),
}));

vi.mock("@/lib/supabase/debt-actions", () => ({
  fetchUserDebts: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/supabase/settlement-actions", () => ({
  recordSettlement: vi.fn().mockResolvedValue({}),
}));

function makeDebt(
  overrides: Partial<DebtSummary> & { direction: "owes" | "owed" },
): DebtSummary {
  return {
    groupId: overrides.groupId ?? "group-1",
    groupName: overrides.groupName ?? "Jantar",
    counterpartyId: overrides.counterpartyId ?? "user-2",
    counterpartyName: overrides.counterpartyName ?? "Maria",
    counterpartyAvatarUrl: overrides.counterpartyAvatarUrl ?? null,
    amountCents: overrides.amountCents ?? 5000,
    direction: overrides.direction,
  };
}

describe("DashboardContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders greeting and user name", () => {
    render(<DashboardContent initialDebts={[]} initialNetBalance={0} />);
    expect(screen.getByText("Test")).toBeInTheDocument();
  });

  it("shows positive net balance as A receber", () => {
    render(<DashboardContent initialDebts={[]} initialNetBalance={5000} />);
    expect(screen.getByText("A receber")).toBeInTheDocument();
    expect(screen.getByText("R$ 50,00")).toBeInTheDocument();
  });

  it("shows negative net balance as A pagar", () => {
    render(<DashboardContent initialDebts={[]} initialNetBalance={-3000} />);
    expect(screen.getByText("A pagar")).toBeInTheDocument();
    expect(screen.getByText("R$ 30,00")).toBeInTheDocument();
  });

  it("shows debt count in balance card subtitle", () => {
    const debts = [
      makeDebt({ direction: "owes", amountCents: 3000 }),
      makeDebt({ direction: "owes", amountCents: 2000 }),
    ];
    render(<DashboardContent initialDebts={debts} initialNetBalance={0} />);
    expect(screen.getByText("2 dividas pendentes")).toBeInTheDocument();
  });

  it("shows empty state when no debts on active tab", () => {
    render(<DashboardContent initialDebts={[]} initialNetBalance={0} />);
    expect(screen.getByText("Tudo em dia!")).toBeInTheDocument();
  });

  it("renders debt cards for owes tab by default", () => {
    const debts = [
      makeDebt({ direction: "owes", counterpartyName: "Maria", amountCents: 5000 }),
      makeDebt({ direction: "owed", counterpartyName: "Joao", amountCents: 3000 }),
    ];
    render(<DashboardContent initialDebts={debts} initialNetBalance={0} />);
    expect(screen.getByText("Maria")).toBeInTheDocument();
    expect(screen.queryByText("Joao")).not.toBeInTheDocument();
  });

  it("renders segmented toggle with counts", () => {
    const debts = [
      makeDebt({ direction: "owes" }),
      makeDebt({ direction: "owes" }),
      makeDebt({ direction: "owed" }),
    ];
    render(<DashboardContent initialDebts={debts} initialNetBalance={0} />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
