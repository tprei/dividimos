import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BillSummary } from "./bill-summary";
import type { Bill, BillItem, BillSplit, ItemSplit, User } from "@/types";

function makeUser(id: string, name: string): User {
  return {
    id,
    name,
    email: `${id}@test.com`,
    handle: id,
    pixKeyType: "random",
    pixKeyHint: "***",
    onboarded: true,
    createdAt: new Date().toISOString(),
  };
}

const alice = makeUser("alice", "Alice Souza");
const bob = makeUser("bob", "Bob Lima");

function makeBill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: "bill-1",
    creatorId: "alice",
    billType: "single_amount",
    title: "Jantar",
    status: "active",
    serviceFeePercent: 0,
    fixedFees: 0,
    totalAmount: 10000,
    totalAmountInput: 10000,
    payers: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("BillSummary", () => {
  it("renders summary heading and total", () => {
    const bill = makeBill({ totalAmountInput: 10000 });
    const billSplits: BillSplit[] = [
      { userId: "alice", splitType: "equal", value: 1, computedAmountCents: 5000 },
      { userId: "bob", splitType: "equal", value: 1, computedAmountCents: 5000 },
    ];

    render(
      <BillSummary
        bill={bill}
        items={[]}
        splits={[]}
        billSplits={billSplits}
        participants={[alice, bob]}
      />,
    );

    expect(screen.getByText("Resumo")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    // The total amount R$ 100,00 is rendered somewhere
    expect(screen.getByText((_, el) =>
      el?.textContent === "R$\u00a0100,00" && el.tagName === "SPAN",
    )).toBeInTheDocument();
  });

  it("renders per-person breakdown for single amount", () => {
    const bill = makeBill({ totalAmountInput: 10000 });
    const billSplits: BillSplit[] = [
      { userId: "alice", splitType: "equal", value: 1, computedAmountCents: 5000 },
      { userId: "bob", splitType: "equal", value: 1, computedAmountCents: 5000 },
    ];

    render(
      <BillSummary
        bill={bill}
        items={[]}
        splits={[]}
        billSplits={billSplits}
        participants={[alice, bob]}
      />,
    );

    expect(screen.getByText("Por pessoa")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("renders itemized bill with service fee and fixed fees", () => {
    const bill = makeBill({
      billType: "itemized",
      serviceFeePercent: 10,
      fixedFees: 500,
    });
    const items: BillItem[] = [
      {
        id: "i1",
        billId: "bill-1",
        description: "Pizza",
        quantity: 1,
        unitPriceCents: 5000,
        totalPriceCents: 5000,
        createdAt: new Date().toISOString(),
      },
    ];
    const splits: ItemSplit[] = [
      { id: "s1", itemId: "i1", userId: "alice", splitType: "equal", value: 1, computedAmountCents: 2500 },
      { id: "s2", itemId: "i1", userId: "bob", splitType: "equal", value: 1, computedAmountCents: 2500 },
    ];

    render(
      <BillSummary
        bill={bill}
        items={items}
        splits={splits}
        participants={[alice, bob]}
      />,
    );

    expect(screen.getByText("Subtotal dos itens")).toBeInTheDocument();
    // "Servico" appears multiple times (summary + per-person breakdown)
    expect(screen.getAllByText(/Servico/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Couvert/).length).toBeGreaterThanOrEqual(1);
  });

  it("shows unassigned amount warning", () => {
    const bill = makeBill({
      billType: "itemized",
      serviceFeePercent: 0,
      fixedFees: 0,
    });
    const items: BillItem[] = [
      {
        id: "i1",
        billId: "bill-1",
        description: "Pizza",
        quantity: 1,
        unitPriceCents: 5000,
        totalPriceCents: 5000,
        createdAt: new Date().toISOString(),
      },
    ];

    render(
      <BillSummary
        bill={bill}
        items={items}
        splits={[]}
        participants={[alice, bob]}
      />,
    );

    expect(screen.getByText("Valor nao atribuido")).toBeInTheDocument();
  });

  it("shows split label for percentage splits", () => {
    const bill = makeBill({ totalAmountInput: 10000 });
    const billSplits: BillSplit[] = [
      { userId: "alice", splitType: "percentage", value: 60, computedAmountCents: 6000 },
      { userId: "bob", splitType: "percentage", value: 40, computedAmountCents: 4000 },
    ];

    render(
      <BillSummary
        bill={bill}
        items={[]}
        splits={[]}
        billSplits={billSplits}
        participants={[alice, bob]}
      />,
    );

    expect(screen.getByText("(60.0%)")).toBeInTheDocument();
    expect(screen.getByText("(40.0%)")).toBeInTheDocument();
  });
});
