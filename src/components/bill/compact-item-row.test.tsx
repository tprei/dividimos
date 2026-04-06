import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CompactItemRow } from "./compact-item-row";
import type { UserProfile } from "@/types";

function makeUser(id: string, name: string): UserProfile {
  return { id, name, handle: id };
}

const alice = makeUser("alice", "Alice Souza");
const bob = makeUser("bob", "Bob Lima");

const item = {
  id: "item-1",
  description: "Picanha 400g",
  quantity: 2,
  unitPriceCents: 4500,
  totalPriceCents: 9000,
};

describe("CompactItemRow", () => {
  const defaultProps = {
    item,
    splits: [] as { id: string; userId: string; computedAmountCents: number; user?: UserProfile }[],
    participants: [alice, bob],
    onAssign: vi.fn(),
    onUnassign: vi.fn(),
  };

  it("renders item description and price", () => {
    render(<CompactItemRow {...defaultProps} />);

    expect(screen.getByText("Picanha 400g")).toBeInTheDocument();
    expect(
      screen.getByText((_, el) => el?.textContent === "R$\u00a090,00" && el.tagName === "SPAN"),
    ).toBeInTheDocument();
  });

  it("renders quantity when > 1", () => {
    render(<CompactItemRow {...defaultProps} />);

    expect(screen.getByText("2x")).toBeInTheDocument();
  });

  it("hides quantity when === 1", () => {
    const singleItem = { ...item, quantity: 1 };
    render(<CompactItemRow {...defaultProps} item={singleItem} />);

    expect(screen.queryByText("1x")).not.toBeInTheDocument();
  });

  it("renders avatar buttons for each participant", () => {
    render(<CompactItemRow {...defaultProps} />);

    expect(screen.getByLabelText("Atribuir Alice")).toBeInTheDocument();
    expect(screen.getByLabelText("Atribuir Bob")).toBeInTheDocument();
  });

  it("calls onAssign when unassigned user avatar is clicked", async () => {
    const onAssign = vi.fn();
    const user = userEvent.setup();
    render(<CompactItemRow {...defaultProps} onAssign={onAssign} />);

    await user.click(screen.getByLabelText("Atribuir Alice"));
    expect(onAssign).toHaveBeenCalledWith("item-1", "alice");
  });

  it("calls onUnassign when assigned user avatar is clicked", async () => {
    const onUnassign = vi.fn();
    const user = userEvent.setup();
    const splits = [
      { id: "s1", userId: "alice", computedAmountCents: 4500, user: alice },
    ];
    render(<CompactItemRow {...defaultProps} splits={splits} onUnassign={onUnassign} />);

    await user.click(screen.getByLabelText("Remover Alice"));
    expect(onUnassign).toHaveBeenCalledWith("item-1", "alice");
  });

  it("shows split count when splits exist", () => {
    const splits = [
      { id: "s1", userId: "alice", computedAmountCents: 4500, user: alice },
      { id: "s2", userId: "bob", computedAmountCents: 4500, user: bob },
    ];
    render(<CompactItemRow {...defaultProps} splits={splits} />);

    expect(screen.getByText("2/2")).toBeInTheDocument();
  });

  it("does not show split count when no splits", () => {
    render(<CompactItemRow {...defaultProps} />);

    expect(screen.queryByText(/\/2/)).not.toBeInTheDocument();
  });

  it("applies drop target styling when isDropTarget is true", () => {
    const { container } = render(<CompactItemRow {...defaultProps} isDropTarget={true} />);

    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toContain("border-primary");
    expect(row.className).toContain("bg-primary/5");
  });

  it("applies default styling when isDropTarget is false", () => {
    const { container } = render(<CompactItemRow {...defaultProps} isDropTarget={false} />);

    const row = container.firstElementChild as HTMLElement;
    expect(row.className).toContain("bg-card");
  });

  it("attaches dropRef to the row element", () => {
    const dropRef = vi.fn();
    render(<CompactItemRow {...defaultProps} dropRef={dropRef} />);

    expect(dropRef).toHaveBeenCalledWith(expect.any(HTMLElement));
  });

  describe("with guests", () => {
    const guests = [
      { id: "guest_local_1", name: "Maria" },
      { id: "guest_local_2", name: "Joao" },
    ];

    it("renders guest avatar buttons", () => {
      render(<CompactItemRow {...defaultProps} guests={guests} />);

      expect(screen.getByLabelText("Atribuir Maria")).toBeInTheDocument();
      expect(screen.getByLabelText("Atribuir Joao")).toBeInTheDocument();
    });

    it("shows correct split count with guests", () => {
      const splits = [
        { id: "s1", userId: "alice", computedAmountCents: 3000, user: alice },
        {
          id: "s2",
          userId: "guest_local_1",
          computedAmountCents: 3000,
          user: { id: "guest_local_1", name: "Maria", handle: "" } as UserProfile,
        },
      ];
      render(<CompactItemRow {...defaultProps} guests={guests} splits={splits} />);

      expect(screen.getByText("2/4")).toBeInTheDocument();
    });

    it("calls onAssign when guest avatar is clicked", async () => {
      const onAssign = vi.fn();
      const user = userEvent.setup();
      render(<CompactItemRow {...defaultProps} guests={guests} onAssign={onAssign} />);

      await user.click(screen.getByLabelText("Atribuir Maria"));
      expect(onAssign).toHaveBeenCalledWith("item-1", "guest_local_1");
    });

    it("calls onUnassign when assigned guest avatar is clicked", async () => {
      const onUnassign = vi.fn();
      const user = userEvent.setup();
      const splits = [
        {
          id: "s1",
          userId: "guest_local_1",
          computedAmountCents: 9000,
          user: { id: "guest_local_1", name: "Maria", handle: "" } as UserProfile,
        },
      ];
      render(
        <CompactItemRow {...defaultProps} guests={guests} splits={splits} onUnassign={onUnassign} />,
      );

      await user.click(screen.getByLabelText("Remover Maria"));
      expect(onUnassign).toHaveBeenCalledWith("item-1", "guest_local_1");
    });
  });

  describe("assigned visual state", () => {
    it("shows assigned avatars with primary styling", () => {
      const splits = [
        { id: "s1", userId: "alice", computedAmountCents: 9000, user: alice },
      ];
      render(<CompactItemRow {...defaultProps} splits={splits} />);

      const aliceBtn = screen.getByLabelText("Remover Alice");
      expect(aliceBtn.className).toContain("bg-primary");
      expect(aliceBtn.className).toContain("text-primary-foreground");
    });

    it("shows unassigned avatars with muted styling", () => {
      render(<CompactItemRow {...defaultProps} />);

      const aliceBtn = screen.getByLabelText("Atribuir Alice");
      expect(aliceBtn.className).toContain("bg-muted");
      expect(aliceBtn.className).toContain("text-muted-foreground");
    });
  });
});
