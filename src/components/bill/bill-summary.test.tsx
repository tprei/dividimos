import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BillSummary } from "./bill-summary";
import type { UserProfile } from "@/types";

function makeUser(id: string, name: string): UserProfile {
  return { id, name, handle: id };
}

const alice = makeUser("alice", "Alice Souza");
const bob = makeUser("bob", "Bob Lima");

describe("BillSummary", () => {
  it("renders summary heading and total", () => {
    render(
      <BillSummary
        expense={{ expenseType: "single_amount", totalAmount: 10000, serviceFeePercent: 0, fixedFees: 0 }}
        items={[]}
        shares={[
          { userId: "alice", shareAmountCents: 5000 },
          { userId: "bob", shareAmountCents: 5000 },
        ]}
        participants={[alice, bob]}
      />,
    );

    expect(screen.getByText("Resumo")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText((_, el) =>
      el?.textContent === "R$\u00a0100,00" && el.tagName === "SPAN",
    )).toBeInTheDocument();
  });

  it("renders per-person breakdown for single amount", () => {
    render(
      <BillSummary
        expense={{ expenseType: "single_amount", totalAmount: 10000, serviceFeePercent: 0, fixedFees: 0 }}
        items={[]}
        shares={[
          { userId: "alice", shareAmountCents: 5000, splitLabel: "igual" },
          { userId: "bob", shareAmountCents: 5000, splitLabel: "igual" },
        ]}
        participants={[alice, bob]}
      />,
    );

    expect(screen.getByText("Por pessoa")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("renders itemized bill with service fee and fixed fees", () => {
    const items = [{ totalPriceCents: 5000 }];
    const itemSplits = [
      { userId: "alice", computedAmountCents: 2500 },
      { userId: "bob", computedAmountCents: 2500 },
    ];

    render(
      <BillSummary
        expense={{ expenseType: "itemized", totalAmount: 5000, serviceFeePercent: 10, fixedFees: 500 }}
        items={items}
        itemSplits={itemSplits}
        participants={[alice, bob]}
      />,
    );

    expect(screen.getByText("Subtotal dos itens")).toBeInTheDocument();
    expect(screen.getAllByText(/Servico/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Couvert/).length).toBeGreaterThanOrEqual(1);
  });

  it("shows unassigned amount warning", () => {
    const items = [{ totalPriceCents: 5000 }];

    render(
      <BillSummary
        expense={{ expenseType: "itemized", totalAmount: 5000, serviceFeePercent: 0, fixedFees: 0 }}
        items={items}
        itemSplits={[]}
        participants={[alice, bob]}
      />,
    );

    expect(screen.getByText("Valor nao atribuido")).toBeInTheDocument();
  });

  it("shows split label for percentage splits", () => {
    render(
      <BillSummary
        expense={{ expenseType: "single_amount", totalAmount: 10000, serviceFeePercent: 0, fixedFees: 0 }}
        items={[]}
        shares={[
          { userId: "alice", shareAmountCents: 6000, splitLabel: "60.0%" },
          { userId: "bob", shareAmountCents: 4000, splitLabel: "40.0%" },
        ]}
        participants={[alice, bob]}
      />,
    );

    expect(screen.getByText("(60.0%)")).toBeInTheDocument();
    expect(screen.getByText("(40.0%)")).toBeInTheDocument();
  });

  describe("with guests", () => {
    const guests = [
      { id: "guest_local_1", name: "Maria" },
    ];

    it("renders guest in per-person breakdown for single amount", () => {
      render(
        <BillSummary
          expense={{ expenseType: "single_amount", totalAmount: 15000, serviceFeePercent: 0, fixedFees: 0 }}
          items={[]}
          shares={[
            { userId: "alice", shareAmountCents: 5000 },
            { userId: "bob", shareAmountCents: 5000 },
            { userId: "guest_local_1", shareAmountCents: 5000 },
          ]}
          participants={[alice, bob]}
          guests={guests}
        />,
      );

      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.getByText("Bob")).toBeInTheDocument();
      expect(screen.getByText("Maria")).toBeInTheDocument();
      expect(screen.getByText("Convidado")).toBeInTheDocument();
    });

    it("renders guest in itemized breakdown with fees", () => {
      const items = [{ totalPriceCents: 6000 }];
      const itemSplits = [
        { userId: "alice", computedAmountCents: 2000 },
        { userId: "bob", computedAmountCents: 2000 },
        { userId: "guest_local_1", computedAmountCents: 2000 },
      ];

      render(
        <BillSummary
          expense={{ expenseType: "itemized", totalAmount: 6000, serviceFeePercent: 10, fixedFees: 300 }}
          items={items}
          itemSplits={itemSplits}
          participants={[alice, bob]}
          guests={guests}
        />,
      );

      expect(screen.getByText("Maria")).toBeInTheDocument();
      expect(screen.getByText("Convidado")).toBeInTheDocument();
    });

    it("works with no guests (backward compatible)", () => {
      render(
        <BillSummary
          expense={{ expenseType: "single_amount", totalAmount: 10000, serviceFeePercent: 0, fixedFees: 0 }}
          items={[]}
          shares={[
            { userId: "alice", shareAmountCents: 5000 },
            { userId: "bob", shareAmountCents: 5000 },
          ]}
          participants={[alice, bob]}
        />,
      );

      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.getByText("Bob")).toBeInTheDocument();
      expect(screen.queryByText("Convidado")).not.toBeInTheDocument();
    });
  });
});
