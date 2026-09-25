import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { equalDivision, type ItemDivisionValue } from "@/lib/item-division";
import type { ExpenseSplit } from "@/stores/bill-store";
import type { ExpenseItem, User } from "@/types";
import { SplitSection } from "./split-section";

function user(id: string, name: string): User {
  return { id, email: `${id}@example.com`, handle: id, name, onboarded: true, createdAt: "2026-01-01" };
}

function item(id: string, description: string, totalPriceCents: number): ExpenseItem {
  return { id, expenseId: "e1", description, quantity: 1, unitPriceCents: totalPriceCents, totalPriceCents, createdAt: "2026-01-01" };
}

function splitsFor(division: ItemDivisionValue | null, itemId: string): ExpenseSplit[] {
  if (!division) throw new Error(`equalDivision returned null for ${itemId}`);
  return division.shares.map((share, index) => ({
    id: `${itemId}-${index}`,
    itemId,
    userId: share.participantId,
    splitType: "equal" as const,
    value: 100 / division.shares.length,
    computedAmountCents: share.cents,
  }));
}

function renderSplitSection(props: Partial<ComponentProps<typeof SplitSection>> = {}) {
  const onSaveDivision = vi.fn();
  const onUnassign = vi.fn();
  const view = render(
    <SplitSection
      viewerId="u1"
      items={[]}
      participants={[]}
      guests={[]}
      splits={[]}
      serviceFeeCents={0}
      fixedFees={0}
      grandTotal={0}
      expandedId={null}
      onToggleItem={vi.fn()}
      onSaveDivision={onSaveDivision}
      onUnassign={onUnassign}
      onCloseDivision={vi.fn()}
      onAssignSelected={vi.fn()}
      {...props}
    />,
  );
  return { onSaveDivision, onUnassign, ...view };
}

describe("SplitSection", () => {
  it("assigns an equal split across every participant to every item in one tap", () => {
    const items = [item("a", "Pizza", 1000), item("b", "Refrigerante", 501)];
    const participants = [user("u1", "Ana"), user("u2", "Bruno")];
    const { onSaveDivision } = renderSplitSection({ items, participants });

    fireEvent.click(screen.getByRole("button", { name: "Dividir tudo igualmente" }));

    expect(onSaveDivision).toHaveBeenCalledTimes(2);
    expect(onSaveDivision).toHaveBeenNthCalledWith(1, "a", equalDivision(["u1", "u2"], 1000));
    expect(onSaveDivision).toHaveBeenNthCalledWith(2, "b", equalDivision(["u1", "u2"], 501));
  });

  it("re-baselines every item to include a participant added after the first division", () => {
    const items = [item("a", "Pizza", 1000)];
    const initialSplits = splitsFor(equalDivision(["u1", "u2"], 1000), "a");
    const participants = [user("u1", "Ana"), user("u2", "Bruno"), user("u3", "Cris")];
    const { onSaveDivision } = renderSplitSection({ items, participants, splits: initialSplits });

    expect(screen.queryByText(/sem divisão/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dividir tudo igualmente" }));

    expect(onSaveDivision).toHaveBeenCalledTimes(1);
    expect(onSaveDivision).toHaveBeenCalledWith("a", equalDivision(["u1", "u2", "u3"], 1000));
  });

  it("counts stale divisions referencing people off the bill as unassigned", () => {
    const items = [item("a", "Pizza", 1000)];
    const staleSplits = splitsFor(equalDivision(["u1", "g1"], 1000), "a");
    const participants = [user("u1", "Ana"), user("u2", "Bruno")];
    const { onSaveDivision } = renderSplitSection({ items, participants, splits: staleSplits });

    expect(screen.getByText("1 item sem divisão")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dividir tudo igualmente" }));

    expect(onSaveDivision).toHaveBeenCalledWith("a", equalDivision(["u1", "u2"], 1000));
  });

  it("tracks the unassigned count down to zero and hides the text when every item is assigned", () => {
    const items = [item("a", "Pizza", 1000), item("b", "Refrigerante", 501)];
    const participants = [user("u1", "Ana"), user("u2", "Bruno")];
    const { rerender } = renderSplitSection({ items, participants });

    expect(screen.getByText("2 de 2 itens sem divisão")).toBeInTheDocument();

    rerender(
      <SplitSection
        viewerId="u1"
        items={items}
        participants={participants}
        guests={[]}
        splits={splitsFor(equalDivision(["u1", "u2"], 1000), "a")}
        serviceFeeCents={0}
        fixedFees={0}
        grandTotal={0}
        expandedId={null}
        onToggleItem={vi.fn()}
        onSaveDivision={vi.fn()}
        onUnassign={vi.fn()}
        onCloseDivision={vi.fn()}
        onAssignSelected={vi.fn()}
      />,
    );

    expect(screen.getByText("1 item sem divisão")).toBeInTheDocument();

    rerender(
      <SplitSection
        viewerId="u1"
        items={items}
        participants={participants}
        guests={[]}
        splits={[
          ...splitsFor(equalDivision(["u1", "u2"], 1000), "a"),
          ...splitsFor(equalDivision(["u1", "u2"], 501), "b"),
        ]}
        serviceFeeCents={0}
        fixedFees={0}
        grandTotal={0}
        expandedId={null}
        onToggleItem={vi.fn()}
        onSaveDivision={vi.fn()}
        onUnassign={vi.fn()}
        onCloseDivision={vi.fn()}
        onAssignSelected={vi.fn()}
      />,
    );

    expect(screen.queryByText(/sem divisão/)).not.toBeInTheDocument();
  });

  it("disables the bulk action with zero participants or zero items", () => {
    const items = [item("a", "Pizza", 1000)];
    const { rerender } = renderSplitSection({ items });

    expect(screen.getByRole("button", { name: "Dividir tudo igualmente" })).toBeDisabled();

    rerender(
      <SplitSection
        viewerId="u1"
        items={[]}
        participants={[user("u1", "Ana")]}
        guests={[]}
        splits={[]}
        serviceFeeCents={0}
        fixedFees={0}
        grandTotal={0}
        expandedId={null}
        onToggleItem={vi.fn()}
        onSaveDivision={vi.fn()}
        onUnassign={vi.fn()}
        onCloseDivision={vi.fn()}
        onAssignSelected={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Dividir tudo igualmente" })).toBeDisabled();
  });

  it("keeps an item split equally as people are toggled in and out", () => {
    const items = [item("a", "Pizza", 1000)];
    const participants = [user("u1", "Ana"), user("u2", "Bruno")];
    const { onSaveDivision } = renderSplitSection({
      items,
      participants,
      splits: splitsFor(equalDivision(["u1"], 1000), "a"),
    });

    const consumers = screen.getByRole("group", { name: "Quem consumiu Pizza" });
    expect(within(consumers).getByRole("button", { name: /^Você: 100% · R\$\s10,00$/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(consumers).getByRole("button", { name: "Bruno" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(within(consumers).getByRole("button", { name: "Bruno" }));

    expect(onSaveDivision).toHaveBeenCalledWith("a", equalDivision(["u1", "u2"], 1000));
  });

  it("leaves an item pending when its last person is taken off", () => {
    const items = [item("a", "Pizza", 1000)];
    const participants = [user("u1", "Ana"), user("u2", "Bruno")];
    const { onSaveDivision, onUnassign } = renderSplitSection({
      items,
      participants,
      splits: splitsFor(equalDivision(["u1"], 1000), "a"),
    });

    fireEvent.click(within(screen.getByRole("group", { name: "Quem consumiu Pizza" })).getByRole("button", { name: /^Você:/ }));

    expect(onUnassign).toHaveBeenCalledWith("a", "u1");
    expect(onSaveDivision).not.toHaveBeenCalled();
  });

  it("names each person's share of an equal split", () => {
    const items = [item("a", "Pizza", 1001)];
    const participants = [user("u1", "Ana"), user("u2", "Bruno"), user("u3", "Cris")];
    renderSplitSection({ items, participants, splits: splitsFor(equalDivision(["u1", "u3"], 1001), "a") });

    const consumers = screen.getByRole("group", { name: "Quem consumiu Pizza" });
    expect(within(consumers).getByRole("button", { name: /^Você: 50,05% · R\$\s5,01$/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(consumers).getByRole("button", { name: "Bruno" })).toHaveAttribute("aria-pressed", "false");
    expect(within(consumers).getByRole("button", { name: /^Cris: 49,95% · R\$\s5,00$/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a custom split as people with their shares and opens the editor when one is tapped", () => {
    const items = [item("a", "Pizza", 1000)];
    const participants = [user("u1", "Ana"), user("u2", "Bruno"), user("u3", "Cris")];
    const splits: ExpenseSplit[] = [
      { id: "s1", itemId: "a", userId: "u1", splitType: "percentage", value: 60, computedAmountCents: 600 },
      { id: "s2", itemId: "a", userId: "u2", splitType: "percentage", value: 40, computedAmountCents: 400 },
    ];
    const onToggleItem = vi.fn();
    const { onSaveDivision, onUnassign } = renderSplitSection({ items, participants, splits, onToggleItem });

    const consumers = screen.getByRole("group", { name: "Quem consumiu Pizza" });
    const viewer = within(consumers).getByRole("button", { name: /^Você: 60% · R\$\s6,00$/ });
    expect(within(consumers).getByRole("button", { name: /^Bruno: 40% · R\$\s4,00$/ })).toBeInTheDocument();
    expect(within(consumers).getByRole("button", { name: "Cris" })).toBeInTheDocument();
    expect(viewer).not.toHaveAttribute("aria-pressed");

    fireEvent.click(within(consumers).getByRole("button", { name: "Cris" }));

    expect(onToggleItem).toHaveBeenCalledWith("a");
    expect(onSaveDivision).not.toHaveBeenCalled();
    expect(onUnassign).not.toHaveBeenCalled();
  });
});
