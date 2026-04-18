import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SplitStep } from "./split-step";
import type { ExpenseItem, ItemSplit, User } from "@/types";

vi.mock("@/hooks/use-haptics", () => ({
  haptics: {
    tap: vi.fn(),
    impact: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    selectionChanged: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const mockItems: ExpenseItem[] = [
  { id: "item-1", expenseId: "exp-1", description: "Pizza", quantity: 1, unitPriceCents: 5000, totalPriceCents: 5000 },
  { id: "item-2", expenseId: "exp-1", description: "Cerveja", quantity: 2, unitPriceCents: 1500, totalPriceCents: 3000 },
];

const mockParticipants: User[] = [
  { id: "user-1", email: "", handle: "alice", name: "Alice", pixKeyType: "email", pixKeyHint: "", onboarded: true, createdAt: "" },
  { id: "user-2", email: "", handle: "bob", name: "Bob", pixKeyType: "email", pixKeyHint: "", onboarded: true, createdAt: "" },
];

describe("SplitStep", () => {
  it("renders items with descriptions", () => {
    render(
      <SplitStep
        items={mockItems}
        splits={[]}
        participants={mockParticipants}
        guests={[]}
        onAssign={vi.fn()}
        onUnassign={vi.fn()}
        onAssignAll={vi.fn()}
        onRemoveItem={vi.fn()}
        onSplitItemEqually={vi.fn()}
      />,
    );

    expect(screen.getByText("Pizza")).toBeInTheDocument();
    expect(screen.getByText("Cerveja")).toBeInTheDocument();
  });

  it("renders instruction text", () => {
    render(
      <SplitStep
        items={mockItems}
        splits={[]}
        participants={mockParticipants}
        guests={[]}
        onAssign={vi.fn()}
        onUnassign={vi.fn()}
        onAssignAll={vi.fn()}
        onRemoveItem={vi.fn()}
        onSplitItemEqually={vi.fn()}
      />,
    );

    expect(screen.getByText(/Toca nos nomes/)).toBeInTheDocument();
  });

  it("shows bulk-assign button for unassigned items", () => {
    render(
      <SplitStep
        items={mockItems}
        splits={[]}
        participants={mockParticipants}
        guests={[]}
        onAssign={vi.fn()}
        onUnassign={vi.fn()}
        onAssignAll={vi.fn()}
        onRemoveItem={vi.fn()}
        onSplitItemEqually={vi.fn()}
      />,
    );

    expect(screen.getByText(/Dividir 2 restantes igualmente/)).toBeInTheDocument();
  });

  it("calls onSplitItemEqually for all unassigned items when bulk-assign clicked", async () => {
    const onSplitItemEqually = vi.fn();
    const user = userEvent.setup();
    render(
      <SplitStep
        items={mockItems}
        splits={[]}
        participants={mockParticipants}
        guests={[]}
        onAssign={vi.fn()}
        onUnassign={vi.fn()}
        onAssignAll={vi.fn()}
        onRemoveItem={vi.fn()}
        onSplitItemEqually={onSplitItemEqually}
      />,
    );

    await user.click(screen.getByText(/Dividir 2 restantes igualmente/));
    expect(onSplitItemEqually).toHaveBeenCalledTimes(2);
  });

  it("does not show bulk-assign when all items are assigned", () => {
    const splits: ItemSplit[] = [
      { id: "s1", itemId: "item-1", userId: "user-1", splitType: "equal", value: 1, computedAmountCents: 5000 },
      { id: "s2", itemId: "item-2", userId: "user-2", splitType: "equal", value: 1, computedAmountCents: 3000 },
    ];
    render(
      <SplitStep
        items={mockItems}
        splits={splits}
        participants={mockParticipants}
        guests={[]}
        onAssign={vi.fn()}
        onUnassign={vi.fn()}
        onAssignAll={vi.fn()}
        onRemoveItem={vi.fn()}
        onSplitItemEqually={vi.fn()}
      />,
    );

    expect(screen.queryByText(/Dividir.*igualmente/)).not.toBeInTheDocument();
  });

  it("renders empty state when no items", () => {
    render(
      <SplitStep
        items={[]}
        splits={[]}
        participants={mockParticipants}
        guests={[]}
        onAssign={vi.fn()}
        onUnassign={vi.fn()}
        onAssignAll={vi.fn()}
        onRemoveItem={vi.fn()}
        onSplitItemEqually={vi.fn()}
      />,
    );

    expect(screen.getByText("Adicione itens primeiro")).toBeInTheDocument();
  });
});
