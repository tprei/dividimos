import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExpenseSharesSummary } from "./expense-shares-summary";
import type { ExpenseWithDetails, UserProfile } from "@/types";

vi.mock("@/components/bill/payer-summary-card", () => ({
  PayerSummaryCard: () => <div data-testid="payer-summary-card" />,
}));

const alice: UserProfile = { id: "u1", handle: "alice", name: "Alice Silva" };
const bob: UserProfile = { id: "u2", handle: "bob", name: "Bob Santos" };

const makeExpense = (overrides?: Partial<ExpenseWithDetails>): ExpenseWithDetails => ({
  id: "exp-1",
  groupId: "g1",
  creatorId: "u1",
  title: "Dinner",
  merchantName: null,
  expenseType: "itemized",
  totalAmount: 10000,
  serviceFeePercent: 0,
  fixedFees: 0,
  status: "active",
  createdAt: "",
  updatedAt: "",
  items: [],
  shares: [
    { userId: "u1", shareAmountCents: 6000, user: alice },
    { userId: "u2", shareAmountCents: 4000, user: bob },
  ],
  payers: [
    { userId: "u1", amountCents: 10000, user: alice },
  ],
  guests: [],
  ...overrides,
});

describe("ExpenseSharesSummary", () => {
  it("renders per-person shares with names", () => {
    render(
      <ExpenseSharesSummary
        expense={makeExpense()}
        allParticipants={[alice, bob]}
      />,
    );

    expect(screen.getByText("Por pessoa")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("shows payer information", () => {
    render(
      <ExpenseSharesSummary
        expense={makeExpense()}
        allParticipants={[alice, bob]}
      />,
    );

    expect(screen.getByTestId("payer-summary-card")).toBeInTheDocument();
  });

  it("does not show payer card when no payers", () => {
    render(
      <ExpenseSharesSummary
        expense={makeExpense({ payers: [] })}
        allParticipants={[alice, bob]}
      />,
    );

    expect(screen.queryByTestId("payer-summary-card")).not.toBeInTheDocument();
  });

  it("shows net balance for participants who paid", () => {
    render(
      <ExpenseSharesSummary
        expense={makeExpense()}
        allParticipants={[alice, bob]}
      />,
    );

    expect(screen.getByText(/a receber/)).toBeInTheDocument();
  });
});
