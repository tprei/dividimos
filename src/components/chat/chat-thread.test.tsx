import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatThread } from "./chat-thread";
import type { ChatMessageWithSender, Expense, Settlement, UserProfile } from "@/types";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => <img {...props} />,
}));

const alice: UserProfile = {
  id: "user-1",
  handle: "alice",
  name: "Alice Silva",
  avatarUrl: undefined,
};

const bob: UserProfile = {
  id: "user-2",
  handle: "bob",
  name: "Bob Santos",
  avatarUrl: undefined,
};

function makeTextMessage(
  overrides: Partial<ChatMessageWithSender> = {},
): ChatMessageWithSender {
  return {
    id: "msg-1",
    groupId: "group-1",
    senderId: "user-2",
    messageType: "text",
    content: "Olá!",
    createdAt: "2026-04-12T14:30:00Z",
    sender: bob,
    ...overrides,
  };
}

function makeExpenseMessage(
  expense: Expense,
  sender: UserProfile,
): ChatMessageWithSender {
  return {
    id: "msg-exp-1",
    groupId: "group-1",
    senderId: sender.id,
    messageType: "system_expense",
    content: "",
    expenseId: expense.id,
    createdAt: "2026-04-12T15:00:00Z",
    sender,
  };
}

function makeSettlementMessage(
  settlement: Settlement,
  sender: UserProfile,
): ChatMessageWithSender {
  return {
    id: "msg-set-1",
    groupId: "group-1",
    senderId: sender.id,
    messageType: "system_settlement",
    content: "",
    settlementId: settlement.id,
    createdAt: "2026-04-12T16:00:00Z",
    sender,
  };
}

const testExpense: Expense = {
  id: "exp-1",
  groupId: "group-1",
  creatorId: "user-1",
  title: "Almoço no restaurante",
  expenseType: "single_amount",
  totalAmount: 5000,
  serviceFeePercent: 0,
  fixedFees: 0,
  status: "active",
  createdAt: "2026-04-12T15:00:00Z",
  updatedAt: "2026-04-12T15:00:00Z",
};

const testSettlement: Settlement = {
  id: "set-1",
  groupId: "group-1",
  fromUserId: "user-2",
  toUserId: "user-1",
  amountCents: 2500,
  status: "pending",
  createdAt: "2026-04-12T16:00:00Z",
};

describe("ChatThread", () => {
  it("renders empty state when no messages", () => {
    render(
      <ChatThread
        messages={[]}
        expenses={new Map()}
        settlements={new Map()}
        profiles={new Map()}
        currentUserId="user-1"
      />,
    );

    expect(screen.getByText("Nenhuma mensagem")).toBeInTheDocument();
  });

  it("renders text messages", () => {
    const profiles = new Map([
      [alice.id, alice],
      [bob.id, bob],
    ]);

    render(
      <ChatThread
        messages={[makeTextMessage()]}
        expenses={new Map()}
        settlements={new Map()}
        profiles={profiles}
        currentUserId="user-1"
      />,
    );

    expect(screen.getByText("Olá!")).toBeInTheDocument();
  });

  it("renders system expense card for expense messages", () => {
    const profiles = new Map([
      [alice.id, alice],
      [bob.id, bob],
    ]);
    const expenses = new Map([[testExpense.id, testExpense]]);

    render(
      <ChatThread
        messages={[makeExpenseMessage(testExpense, alice)]}
        expenses={expenses}
        settlements={new Map()}
        profiles={profiles}
        currentUserId="user-2"
      />,
    );

    expect(screen.getByText("Almoço no restaurante")).toBeInTheDocument();
    expect(screen.getByText("Alice adicionou uma conta")).toBeInTheDocument();
  });

  it("renders system settlement card for settlement messages", () => {
    const profiles = new Map([
      [alice.id, alice],
      [bob.id, bob],
    ]);
    const settlements = new Map([[testSettlement.id, testSettlement]]);

    render(
      <ChatThread
        messages={[makeSettlementMessage(testSettlement, bob)]}
        expenses={new Map()}
        settlements={settlements}
        profiles={profiles}
        currentUserId="user-1"
      />,
    );

    expect(screen.getByText("Pagamento registrado")).toBeInTheDocument();
    expect(screen.getByText("R$ 25,00")).toBeInTheDocument();
  });

  it("groups messages by date with date separator", () => {
    const profiles = new Map([[bob.id, bob]]);

    const msg1 = makeTextMessage({
      id: "msg-1",
      content: "Mensagem dia 1",
      createdAt: "2026-04-10T10:00:00Z",
    });
    const msg2 = makeTextMessage({
      id: "msg-2",
      content: "Mensagem dia 2",
      createdAt: "2026-04-12T10:00:00Z",
    });

    render(
      <ChatThread
        messages={[msg1, msg2]}
        expenses={new Map()}
        settlements={new Map()}
        profiles={profiles}
        currentUserId="user-1"
      />,
    );

    expect(screen.getByText("Mensagem dia 1")).toBeInTheDocument();
    expect(screen.getByText("Mensagem dia 2")).toBeInTheDocument();
    // Date separators should be present (exact text depends on locale)
    const dateSeparators = screen.getAllByText(/abril/i);
    expect(dateSeparators.length).toBeGreaterThanOrEqual(1);
  });

  it("shows loading spinner when loading", () => {
    const { container } = render(
      <ChatThread
        messages={[makeTextMessage()]}
        expenses={new Map()}
        settlements={new Map()}
        profiles={new Map([[bob.id, bob]])}
        currentUserId="user-1"
        loading={true}
      />,
    );

    const spinner = container.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });
});
