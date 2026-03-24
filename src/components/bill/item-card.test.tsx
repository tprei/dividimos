import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ItemCard } from "./item-card";
import type { BillItem, ItemSplit, User } from "@/types";

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

const item: BillItem = {
  id: "item-1",
  billId: "bill-1",
  description: "Picanha 400g",
  quantity: 2,
  unitPriceCents: 4500,
  totalPriceCents: 9000,
  createdAt: new Date().toISOString(),
};

describe("ItemCard", () => {
  const defaultProps = {
    item,
    splits: [] as (ItemSplit & { user?: User })[],
    participants: [alice, bob],
    onAssign: vi.fn(),
    onUnassign: vi.fn(),
    onAssignAll: vi.fn(),
    onRemove: vi.fn(),
  };

  it("renders item description and price", () => {
    render(<ItemCard {...defaultProps} />);

    expect(screen.getByText("Picanha 400g")).toBeInTheDocument();
    // R$ 90,00
    expect(screen.getByText((_, el) =>
      el?.textContent === "R$\u00a090,00" && el.tagName === "SPAN",
    )).toBeInTheDocument();
  });

  it("renders quantity when > 1", () => {
    render(<ItemCard {...defaultProps} />);

    expect(screen.getByText("2x")).toBeInTheDocument();
  });

  it("renders participant buttons", () => {
    render(<ItemCard {...defaultProps} />);

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Todos")).toBeInTheDocument();
  });

  it("calls onAssign when unassigned user is clicked", async () => {
    const onAssign = vi.fn();
    const user = userEvent.setup();
    render(<ItemCard {...defaultProps} onAssign={onAssign} />);

    const aliceBtn = screen.getByText("Alice").closest("button")!;
    await user.click(aliceBtn);
    expect(onAssign).toHaveBeenCalledWith("item-1", "alice");
  });

  it("calls onUnassign when assigned user is clicked", async () => {
    const onUnassign = vi.fn();
    const user = userEvent.setup();
    const splits: (ItemSplit & { user?: User })[] = [
      {
        id: "s1",
        itemId: "item-1",
        userId: "alice",
        splitType: "equal",
        value: 1,
        computedAmountCents: 4500,
        user: alice,
      },
    ];
    render(<ItemCard {...defaultProps} splits={splits} onUnassign={onUnassign} />);

    // "Alice" appears in both the button and the split breakdown, use getAllByText
    const aliceElements = screen.getAllByText("Alice");
    const aliceBtn = aliceElements.map((el) => el.closest("button")).find(Boolean);
    expect(aliceBtn).not.toBeNull();
    await user.click(aliceBtn!);
    expect(onUnassign).toHaveBeenCalledWith("item-1", "alice");
  });

  it("calls onAssignAll when Todos button clicked", async () => {
    const onAssignAll = vi.fn();
    const user = userEvent.setup();
    render(<ItemCard {...defaultProps} onAssignAll={onAssignAll} />);

    const todosBtn = screen.getByText("Todos").closest("button")!;
    await user.click(todosBtn);
    expect(onAssignAll).toHaveBeenCalledWith("item-1");
  });

  it("calls onRemove when delete button clicked", async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(<ItemCard {...defaultProps} onRemove={onRemove} />);

    // The trash button has hover:text-destructive in its class
    const buttons = screen.getAllByRole("button");
    const deleteBtn = buttons.find(
      (b) => b.className.includes("destructive"),
    );
    expect(deleteBtn).toBeDefined();
    await user.click(deleteBtn!);

    expect(onRemove).toHaveBeenCalledWith("item-1");
  });

  it("shows split count when splits exist", () => {
    const splits: (ItemSplit & { user?: User })[] = [
      {
        id: "s1",
        itemId: "item-1",
        userId: "alice",
        splitType: "equal",
        value: 1,
        computedAmountCents: 4500,
        user: alice,
      },
      {
        id: "s2",
        itemId: "item-1",
        userId: "bob",
        splitType: "equal",
        value: 1,
        computedAmountCents: 4500,
        user: bob,
      },
    ];
    render(<ItemCard {...defaultProps} splits={splits} />);

    expect(screen.getByText(/2\/2/)).toBeInTheDocument();
  });

  it("shows unassigned amount when not fully split", () => {
    const splits: (ItemSplit & { user?: User })[] = [
      {
        id: "s1",
        itemId: "item-1",
        userId: "alice",
        splitType: "equal",
        value: 1,
        computedAmountCents: 4500,
        user: alice,
      },
    ];
    render(<ItemCard {...defaultProps} splits={splits} />);

    expect(screen.getByText("Nao atribuido")).toBeInTheDocument();
  });
});
