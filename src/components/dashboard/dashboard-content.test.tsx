import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardContent } from "./dashboard-content";
import type { DebtSummary, User } from "@/types";

const { submission, useAuthMock, OnboardingTourSpy } = vi.hoisted(() => ({
  submission: {
    error: null,
    finish: vi.fn(),
    phase: "idle",
    ready: true,
    reconcile: vi.fn(),
    request: null,
    reservedEdgeKeys: new Set<string>(),
    result: null,
    submit: vi.fn(),
  },
  useAuthMock: vi.fn(),
  OnboardingTourSpy: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/components/onboarding/onboarding-tour", () => ({
  OnboardingTour: (props: { userId: string | null; identityGeneration: number }) => {
    OnboardingTourSpy(props);
    return null;
  },
}));

vi.mock("@/lib/supabase/debt-actions", () => ({
  fetchUserDebts: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/contexts/settlement-submission-context", () => ({
  settlementEdgeKey: ({
    groupId,
    fromUserId,
    toUserId,
  }: {
    groupId: string;
    fromUserId: string;
    toUserId: string;
  }) => `${groupId}:${fromUserId}:${toUserId}`,
  useSettlementSubmission: () => submission,
}));

vi.mock("@/lib/supabase/dm-actions", () => ({
  getOrCreateDmGroup: vi.fn().mockResolvedValue({ groupId: "dm-group-1" }),
}));

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "test@test.com",
    handle: "testuser",
    name: "Test User",
    pixKeyType: "email",
    pixKeyHint: "t***@test.com",
    onboarded: true,
    createdAt: "2024-01-01",
    ...overrides,
  };
}

function makeDebt(
  overrides: Partial<DebtSummary> & { direction: "owes" | "owed" },
): DebtSummary {
  return {
    groupId: overrides.groupId ?? "group-1",
    groupName: overrides.groupName ?? "Jantar",
    isDm: overrides.isDm ?? false,
    counterpartyId: overrides.counterpartyId ?? "user-2",
    counterpartyName: overrides.counterpartyName ?? "Maria",
    counterpartyAvatarUrl: overrides.counterpartyAvatarUrl ?? null,
    amountCents: overrides.amountCents ?? 5000,
    direction: overrides.direction,
  };
}

function authed(user: User, generation: number) {
  return {
    status: "authenticated" as const,
    userId: user.id,
    generation,
    user,
  };
}

describe("DashboardContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue(authed(makeUser(), 0));
  });

  // ---- Existing presentation tests ----

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
    expect(screen.getByText("2 contas pendentes")).toBeInTheDocument();
  });

  it("shows empty state when no debts on owes tab", () => {
    render(<DashboardContent initialDebts={[]} initialNetBalance={0} />);
    expect(screen.getByText("Tudo certo por aqui!")).toBeInTheDocument();
    expect(screen.getByText(/Você não tem nenhuma conta pendente/)).toBeInTheDocument();
  });

  it("shows empty state CTA linking to new bill", () => {
    render(<DashboardContent initialDebts={[]} initialNetBalance={0} />);
    const emptyStateLink = screen.getAllByText("Nova conta")
      .map((el) => el.closest("a"))
      .find((a) => a?.getAttribute("href") === "/app/bill/new");
    expect(emptyStateLink).toBeTruthy();
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

  // ---- Identity-tagged tour handoff ----

  it("passes the authenticated userId and generation to the tour", () => {
    useAuthMock.mockReturnValue(authed(makeUser({ id: "A", name: "Alice" }), 7));
    render(<DashboardContent initialDebts={[]} initialNetBalance={0} />);
    expect(OnboardingTourSpy).toHaveBeenCalledWith({
      userId: "A",
      identityGeneration: 7,
    });
  });

  it("passes null userId with the current generation when loading", () => {
    useAuthMock.mockReturnValue({
      status: "loading",
      userId: null,
      generation: 7,
      user: null,
    });
    render(<DashboardContent initialDebts={[]} initialNetBalance={0} />);
    expect(OnboardingTourSpy).toHaveBeenCalledWith({
      userId: null,
      identityGeneration: 7,
    });
    expect(screen.queryByText("Test")).not.toBeInTheDocument();
  });

  it("passes null userId with the current generation when unauthenticated", () => {
    useAuthMock.mockReturnValue({
      status: "unauthenticated",
      userId: null,
      generation: 7,
      user: null,
    });
    render(<DashboardContent initialDebts={[]} initialNetBalance={0} />);
    expect(OnboardingTourSpy).toHaveBeenCalledWith({
      userId: null,
      identityGeneration: 7,
    });
    expect(screen.queryByText("Test")).not.toBeInTheDocument();
  });

  it("passes null userId with the current generation on error", () => {
    useAuthMock.mockReturnValue({
      status: "error",
      userId: "A",
      generation: 7,
      user: null,
    });
    render(<DashboardContent initialDebts={[]} initialNetBalance={0} />);
    expect(OnboardingTourSpy).toHaveBeenCalledWith({
      userId: null,
      identityGeneration: 7,
    });
    expect(screen.queryByText("Test")).not.toBeInTheDocument();
  });

  it("passes null when the user snapshot id does not match the verified userId", () => {
    useAuthMock.mockReturnValue({
      status: "authenticated",
      userId: "A",
      generation: 7,
      user: makeUser({ id: "different-id", name: "Mismatch" }),
    });
    render(<DashboardContent initialDebts={[]} initialNetBalance={0} />);
    expect(OnboardingTourSpy).toHaveBeenCalledWith({
      userId: null,
      identityGeneration: 7,
    });
  });

  it("passes the exact identity tuple across account switches", () => {
    useAuthMock.mockReturnValue(authed(makeUser({ id: "A", name: "Alice" }), 7));
    const { rerender } = render(
      <DashboardContent initialDebts={[]} initialNetBalance={0} />,
    );
    expect(OnboardingTourSpy).toHaveBeenLastCalledWith({
      userId: "A",
      identityGeneration: 7,
    });

    useAuthMock.mockReturnValue(authed(makeUser({ id: "B", name: "Bob" }), 8));
    rerender(<DashboardContent initialDebts={[]} initialNetBalance={0} />);
    expect(OnboardingTourSpy).toHaveBeenLastCalledWith({
      userId: "B",
      identityGeneration: 8,
    });
  });
});
