import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SystemMessageCard, type SystemMessageData } from "./system-message-card";
import type { Expense, Settlement, UserProfile } from "@/types";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => <img {...props} />,
}));

const user1: UserProfile = { id: "u1", handle: "alice", name: "Alice", avatarUrl: undefined };
const user2: UserProfile = { id: "u2", handle: "bob", name: "Bob", avatarUrl: undefined };

const expense: Expense = {
  id: "exp-1",
  groupId: "g1",
  creatorId: "u1",
  title: "Almoço",
  expenseType: "single_amount",
  totalAmount: 8000,
  serviceFeePercent: 0,
  fixedFees: 0,
  status: "active",
  createdAt: "2026-04-10T12:00:00Z",
  updatedAt: "2026-04-10T12:00:00Z",
};

const settlement: Settlement = {
  id: "s1",
  groupId: "g1",
  fromUserId: "u2",
  toUserId: "u1",
  amountCents: 4000,
  status: "confirmed",
  createdAt: "2026-04-10T14:00:00Z",
  confirmedAt: "2026-04-10T15:00:00Z",
};

describe("SystemMessageCard", () => {
  it("renders expense card for system_expense type", () => {
    const data: SystemMessageData = {
      type: "system_expense",
      expense: { expense, creator: user1 },
    };

    render(<SystemMessageCard messageType="system_expense" data={data} />);

    expect(screen.getByText("Almoço")).toBeInTheDocument();
    expect(screen.getByText("R$ 80,00")).toBeInTheDocument();
  });

  it("renders settlement card for system_settlement type", () => {
    const data: SystemMessageData = {
      type: "system_settlement",
      settlement: { settlement, fromUser: user2, toUser: user1 },
    };

    render(<SystemMessageCard messageType="system_settlement" data={data} />);

    expect(screen.getByText((_, el) =>
      el?.tagName === "P" && !!el.textContent?.includes("Bob") && !!el.textContent?.includes("Alice"),
    )).toBeInTheDocument();
    expect(screen.getByText("R$ 40,00")).toBeInTheDocument();
  });
});
