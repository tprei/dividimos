import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatMessageBubble } from "./chat-message-bubble";
import type { ChatMessageWithSender, Expense, Settlement, UserProfile } from "@/types";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => <img {...props} />,
}));

const sender: UserProfile = {
  id: "user-1",
  handle: "alice",
  name: "Alice Silva",
  avatarUrl: undefined,
};

const counterparty: UserProfile = {
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
    senderId: "user-1",
    messageType: "text",
    content: "Olá, tudo bem?",
    createdAt: "2026-04-10T20:30:00Z",
    sender,
    ...overrides,
  };
}

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "exp-1",
    groupId: "group-1",
    creatorId: "user-1",
    title: "Almoço",
    expenseType: "single_amount",
    totalAmount: 5000,
    serviceFeePercent: 0,
    fixedFees: 0,
    status: "active",
    createdAt: "2026-04-10T20:00:00Z",
    updatedAt: "2026-04-10T20:00:00Z",
    ...overrides,
  };
}

describe("ChatMessageBubble", () => {
  const emptyExpenses = new Map<string, Expense>();
  const emptySettlements = new Map<
    string,
    { settlement: Settlement; fromUser: UserProfile; toUser: UserProfile }
  >();

  it("renders text message content", () => {
    render(
      <ChatMessageBubble
        message={makeTextMessage()}
        isOwn={true}
        expenses={emptyExpenses}
        settlements={emptySettlements}
        showAvatar={false}
      />,
    );

    expect(screen.getByText("Olá, tudo bem?")).toBeInTheDocument();
  });

  it("renders time for text messages", () => {
    render(
      <ChatMessageBubble
        message={makeTextMessage()}
        isOwn={false}
        expenses={emptyExpenses}
        settlements={emptySettlements}
        showAvatar={false}
      />,
    );

    // Time should be rendered (format varies by timezone, check for colon)
    const timeEl = screen.getByText(/\d{2}:\d{2}/);
    expect(timeEl).toBeInTheDocument();
  });

  it("shows avatar for counterparty when showAvatar is true", () => {
    render(
      <ChatMessageBubble
        message={makeTextMessage({ senderId: "user-2", sender: counterparty })}
        isOwn={false}
        expenses={emptyExpenses}
        settlements={emptySettlements}
        showAvatar={true}
      />,
    );

    expect(screen.getByText("BS")).toBeInTheDocument();
  });

  it("does not show avatar for own messages", () => {
    render(
      <ChatMessageBubble
        message={makeTextMessage()}
        isOwn={true}
        expenses={emptyExpenses}
        settlements={emptySettlements}
        showAvatar={true}
      />,
    );

    expect(screen.queryByText("AS")).not.toBeInTheDocument();
  });

  it("renders system expense card for expense messages", () => {
    const expense = makeExpense();
    const expenseMap = new Map<string, Expense>([["exp-1", expense]]);

    render(
      <ChatMessageBubble
        message={makeTextMessage({
          id: "msg-2",
          messageType: "system_expense",
          expenseId: "exp-1",
          content: "",
        })}
        isOwn={false}
        expenses={expenseMap}
        settlements={emptySettlements}
        showAvatar={false}
      />,
    );

    expect(screen.getByText("Almoço")).toBeInTheDocument();
    expect(screen.getByText("R$ 50,00")).toBeInTheDocument();
  });

  it("renders system settlement card for settlement messages", () => {
    const settlement: Settlement = {
      id: "set-1",
      groupId: "group-1",
      fromUserId: "user-2",
      toUserId: "user-1",
      amountCents: 2500,
      status: "confirmed",
      createdAt: "2026-04-10T21:00:00Z",
    };
    const settlementMap = new Map([
      ["set-1", { settlement, fromUser: counterparty, toUser: sender }],
    ]);

    render(
      <ChatMessageBubble
        message={makeTextMessage({
          id: "msg-3",
          messageType: "system_settlement",
          settlementId: "set-1",
          content: "",
        })}
        isOwn={false}
        expenses={emptyExpenses}
        settlements={settlementMap}
        showAvatar={false}
      />,
    );

    expect(screen.getByText("R$ 25,00")).toBeInTheDocument();
    expect(screen.getByText("Pagamento confirmado")).toBeInTheDocument();
  });
});
