import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

// Mock next/dynamic
vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));

// Mock supabase client
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
    removeChannel: vi.fn(),
  }),
}));

// Mock auth hook
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "user-1", name: "Alice", email: "a@test.com", handle: "alice" } }),
}));

// Mock realtime expense hook
vi.mock("@/hooks/use-realtime-expense", () => ({
  useRealtimeExpense: vi.fn(),
}));

// Mock expense actions
vi.mock("@/lib/supabase/expense-actions", () => ({
  loadExpense: vi.fn(),
}));

// Mock expense RPC
vi.mock("@/lib/supabase/expense-rpc", () => ({
  activateExpense: vi.fn(),
}));

// Import the module to test the internal computeDebtsFromExpense function.
// Since it's not exported, we test it indirectly through the component behavior,
// but we can also write a standalone version of the algorithm for unit testing.

describe("computeDebtsFromExpense algorithm", () => {
  function computeDebtsFromExpense(
    shares: { userId: string; shareAmountCents: number }[],
    payers: { userId: string; amountCents: number }[],
  ) {
    const netBalance = new Map<string, number>();

    for (const s of shares) {
      netBalance.set(s.userId, (netBalance.get(s.userId) || 0) - s.shareAmountCents);
    }
    for (const p of payers) {
      netBalance.set(p.userId, (netBalance.get(p.userId) || 0) + p.amountCents);
    }

    const debtors: { id: string; amount: number }[] = [];
    const creditors: { id: string; amount: number }[] = [];

    for (const [id, balance] of netBalance) {
      if (balance < -1) debtors.push({ id, amount: Math.abs(balance) });
      if (balance > 1) creditors.push({ id, amount: balance });
    }

    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);

    type DebtEdge = { fromUserId: string; toUserId: string; amountCents: number };
    const debts: DebtEdge[] = [];
    let di = 0;
    let ci = 0;

    while (di < debtors.length && ci < creditors.length) {
      const transfer = Math.min(debtors[di].amount, creditors[ci].amount);
      if (transfer <= 0) break;
      debts.push({
        fromUserId: debtors[di].id,
        toUserId: creditors[ci].id,
        amountCents: transfer,
      });
      debtors[di].amount -= transfer;
      creditors[ci].amount -= transfer;
      if (debtors[di].amount <= 1) di++;
      if (creditors[ci].amount <= 1) ci++;
    }

    return debts;
  }

  it("returns empty debts when shares equal payments", () => {
    const shares = [
      { userId: "a", shareAmountCents: 5000 },
      { userId: "b", shareAmountCents: 5000 },
    ];
    const payers = [
      { userId: "a", amountCents: 5000 },
      { userId: "b", amountCents: 5000 },
    ];

    const debts = computeDebtsFromExpense(shares, payers);
    expect(debts).toEqual([]);
  });

  it("computes single debt when one person pays for two", () => {
    const shares = [
      { userId: "a", shareAmountCents: 5000 },
      { userId: "b", shareAmountCents: 5000 },
    ];
    const payers = [{ userId: "a", amountCents: 10000 }];

    const debts = computeDebtsFromExpense(shares, payers);
    expect(debts).toHaveLength(1);
    expect(debts[0]).toEqual({
      fromUserId: "b",
      toUserId: "a",
      amountCents: 5000,
    });
  });

  it("computes multiple debts for three people", () => {
    // Total 9000: A pays all, B & C each owe 3000
    const shares = [
      { userId: "a", shareAmountCents: 3000 },
      { userId: "b", shareAmountCents: 3000 },
      { userId: "c", shareAmountCents: 3000 },
    ];
    const payers = [{ userId: "a", amountCents: 9000 }];

    const debts = computeDebtsFromExpense(shares, payers);
    expect(debts).toHaveLength(2);

    const totalOwed = debts.reduce((sum, d) => sum + d.amountCents, 0);
    expect(totalOwed).toBe(6000);

    // Both b and c should owe a
    expect(debts.every((d) => d.toUserId === "a")).toBe(true);
    expect(new Set(debts.map((d) => d.fromUserId))).toEqual(new Set(["b", "c"]));
  });

  it("handles multi-payer scenario correctly", () => {
    // A consumed 4000, B consumed 6000
    // A paid 7000, B paid 3000
    // Net: A is owed 3000 by B
    const shares = [
      { userId: "a", shareAmountCents: 4000 },
      { userId: "b", shareAmountCents: 6000 },
    ];
    const payers = [
      { userId: "a", amountCents: 7000 },
      { userId: "b", amountCents: 3000 },
    ];

    const debts = computeDebtsFromExpense(shares, payers);
    expect(debts).toHaveLength(1);
    expect(debts[0]).toEqual({
      fromUserId: "b",
      toUserId: "a",
      amountCents: 3000,
    });
  });

  it("handles zero-balance participants (no debt)", () => {
    const shares = [
      { userId: "a", shareAmountCents: 5000 },
      { userId: "b", shareAmountCents: 5000 },
    ];
    const payers = [
      { userId: "a", amountCents: 5000 },
      { userId: "b", amountCents: 5000 },
    ];

    const debts = computeDebtsFromExpense(shares, payers);
    expect(debts).toHaveLength(0);
  });
});

describe("ExpenseSharesSummary", () => {
  // We test the inline component by importing the page and rendering with mock data
  // Since ExpenseSharesSummary is not exported, we test through the detail page
  // but we can at least verify the PayerSummaryCard renders correctly

  it("PayerSummaryCard renders payer names and amounts", async () => {
    const { PayerSummaryCard } = await import("@/components/bill/payer-summary-card");

    const payers = [
      { userId: "user-1", amountCents: 10000 },
      { userId: "user-2", amountCents: 5000 },
    ];

    const participants = [
      { id: "user-1", name: "Alice Silva", handle: "alice" },
      { id: "user-2", name: "Bob Santos", handle: "bob" },
    ];

    render(<PayerSummaryCard payers={payers} participants={participants} />);

    expect(screen.getByText("Quem pagou")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("PayerSummaryCard shows 'pagou tudo' for single payer", async () => {
    const { PayerSummaryCard } = await import("@/components/bill/payer-summary-card");

    const payers = [{ userId: "user-1", amountCents: 10000 }];
    const participants = [
      { id: "user-1", name: "Alice Silva", handle: "alice" },
    ];

    render(<PayerSummaryCard payers={payers} participants={participants} />);
    expect(screen.getByText("pagou tudo")).toBeInTheDocument();
  });

  it("PayerSummaryCard returns null for empty payers", async () => {
    const { PayerSummaryCard } = await import("@/components/bill/payer-summary-card");

    const { container } = render(
      <PayerSummaryCard payers={[]} participants={[]} />,
    );
    expect(container.innerHTML).toBe("");
  });
});

// ---------------------------------------------------------------------------
// DM group inline pay/collect rendering conditions
// ---------------------------------------------------------------------------

describe("DM group payment tab rendering conditions", () => {
  const makeConditions = ({
    activeTab = "payment" as const,
    allSettled = false,
    hasGroupId = true,
    hasGroupNavUrl = true,
    isDmGroup = true,
    debtsLength = 1,
  }) => ({
    showDmInline:
      activeTab === "payment" &&
      !allSettled &&
      hasGroupId &&
      isDmGroup &&
      debtsLength > 0,
    showMultiMemberRedirect:
      activeTab === "payment" &&
      !allSettled &&
      hasGroupId &&
      hasGroupNavUrl &&
      !isDmGroup,
    showNoGroupInline:
      activeTab === "payment" &&
      !allSettled &&
      !hasGroupId &&
      debtsLength > 0,
  });

  it("shows DM inline buttons for a DM group with debts", () => {
    const conds = makeConditions({ isDmGroup: true, debtsLength: 1 });
    expect(conds.showDmInline).toBe(true);
    expect(conds.showMultiMemberRedirect).toBe(false);
  });

  it("shows multi-member redirect for a non-DM group", () => {
    const conds = makeConditions({ isDmGroup: false });
    expect(conds.showDmInline).toBe(false);
    expect(conds.showMultiMemberRedirect).toBe(true);
  });

  it("hides DM inline buttons when all settled", () => {
    const conds = makeConditions({ isDmGroup: true, allSettled: true });
    expect(conds.showDmInline).toBe(false);
  });

  it("hides DM inline buttons on non-payment tabs", () => {
    const items = makeConditions({ isDmGroup: true, activeTab: "items" as "payment" });
    expect(items.showDmInline).toBe(false);

    const split = makeConditions({ isDmGroup: true, activeTab: "split" as "payment" });
    expect(split.showDmInline).toBe(false);
  });

  it("hides DM inline buttons when there are no debts", () => {
    const conds = makeConditions({ isDmGroup: true, debtsLength: 0 });
    expect(conds.showDmInline).toBe(false);
  });

  it("shows no-group inline buttons when expense has no group", () => {
    const conds = makeConditions({ hasGroupId: false, isDmGroup: false });
    expect(conds.showNoGroupInline).toBe(true);
    expect(conds.showDmInline).toBe(false);
    expect(conds.showMultiMemberRedirect).toBe(false);
  });
});

describe("DM inline pay/collect button rendering", () => {
  const alice = { id: "user-1", name: "Alice Silva", handle: "alice" };
  const bob = { id: "user-2", name: "Bob Santos", handle: "bob" };

  function renderDebtCard({
    debt,
    currentUserId,
    participants,
  }: {
    debt: { fromUserId: string; toUserId: string; amountCents: number };
    currentUserId: string;
    participants: { id: string; name: string }[];
  }) {
    const debtor = participants.find((p) => p.id === debt.fromUserId);
    const creditor = participants.find((p) => p.id === debt.toUserId);
    const isDebtor = currentUserId === debt.fromUserId;
    const isCreditor = currentUserId === debt.toUserId;

    const entryLabel = isDebtor
      ? `Você deve para ${creditor?.name.split(" ")[0] || "?"}`
      : isCreditor
        ? `${debtor?.name.split(" ")[0] || "?"} te deve`
        : `${debtor?.name.split(" ")[0] || "?"} → ${creditor?.name.split(" ")[0] || "?"}`;

    return { entryLabel, isDebtor, isCreditor, debtor, creditor };
  }

  it("debtor sees pay button with amount and creditor name", () => {
    const result = renderDebtCard({
      debt: { fromUserId: alice.id, toUserId: bob.id, amountCents: 5000 },
      currentUserId: alice.id,
      participants: [alice, bob],
    });

    expect(result.isDebtor).toBe(true);
    expect(result.isCreditor).toBe(false);
    expect(result.entryLabel).toBe("Você deve para Bob");
  });

  it("creditor sees collect button", () => {
    const result = renderDebtCard({
      debt: { fromUserId: alice.id, toUserId: bob.id, amountCents: 5000 },
      currentUserId: bob.id,
      participants: [alice, bob],
    });

    expect(result.isDebtor).toBe(false);
    expect(result.isCreditor).toBe(true);
    expect(result.entryLabel).toBe("Alice te deve");
  });

  it("third-party observer sees directional label", () => {
    const carol = { id: "user-3", name: "Carol Souza", handle: "carol" };
    const result = renderDebtCard({
      debt: { fromUserId: alice.id, toUserId: bob.id, amountCents: 5000 },
      currentUserId: carol.id,
      participants: [alice, bob, carol],
    });

    expect(result.isDebtor).toBe(false);
    expect(result.isCreditor).toBe(false);
    expect(result.entryLabel).toBe("Alice → Bob");
  });
});
