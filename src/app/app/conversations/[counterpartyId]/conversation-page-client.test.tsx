import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ConversationPageClient,
  type ConversationInitialData,
} from "./conversation-page-client";
import type { ChatMessageType, UserProfile } from "@/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/hooks/use-realtime-chat", () => ({
  useRealtimeChat: vi.fn(),
}));

vi.mock("@/lib/supabase/chat-actions", () => ({
  loadConversationMessages: vi.fn(() =>
    Promise.resolve({ messages: [], expenses: new Map(), settlements: new Map(), profiles: new Map() }),
  ),
  sendChatMessage: vi.fn(() => Promise.resolve({ error: "not implemented" })),
}));

vi.mock("@/lib/supabase/chat-draft-confirm", () => ({
  confirmChatDraft: vi.fn(() => Promise.resolve({ error: "not implemented" })),
}));

vi.mock("@/lib/push/push-notify", () => ({
  notifyDmTextMessage: vi.fn(() => Promise.resolve()),
  notifyExpenseActivated: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/supabase/unread-actions", () => ({
  markConversationRead: vi.fn(() => Promise.resolve()),
}));

const chainEq = () => {
  const obj: Record<string, unknown> = {};
  obj.eq = () => obj;
  obj.in = () => obj;
  obj.then = (resolve: (v: { error: null }) => void) => { resolve({ error: null }); return obj; };
  return obj;
};

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      update: () => chainEq(),
      delete: () => chainEq(),
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null }),
          in: () => Promise.resolve({ data: [] }),
        }),
        in: () => Promise.resolve({ data: [] }),
      }),
    }),
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "user-1" } } }),
    },
  }),
}));

vi.mock("@/lib/supabase/expense-mappers", () => ({
  expenseRowToExpense: vi.fn(),
  settlementRowToSettlement: vi.fn(),
}));

vi.mock("@/components/chat/conversation-header", () => ({
  ConversationHeader: ({ counterparty, actions }: { counterparty: UserProfile; actions?: React.ReactNode }) => (
    <div data-testid="conversation-header">{counterparty.name}{actions}</div>
  ),
}));

vi.mock("@/components/chat/conversation-pay-button", () => ({
  ConversationPayButton: () => <button data-testid="pay-button">Pagar</button>,
}));

vi.mock("@/components/chat/conversation-quick-actions", () => ({
  ConversationQuickActions: () => <div data-testid="quick-actions" />,
}));

vi.mock("@/components/chat/quick-charge-sheet", () => ({
  QuickChargeSheet: () => <div data-testid="quick-charge-sheet" />,
}));

vi.mock("@/components/chat/quick-split-sheet", () => ({
  QuickSplitSheet: () => <div data-testid="quick-split-sheet" />,
}));

vi.mock("@/components/chat/chat-thread", () => ({
  ChatThread: ({ messages }: { messages: unknown[] }) => (
    <div data-testid="chat-thread">Messages: {messages.length}</div>
  ),
}));

vi.mock("@/components/chat/chat-ai-input", () => ({
  ChatAiInput: () => <div data-testid="chat-ai-input" />,
}));

const currentUser: UserProfile = {
  id: "user-1",
  handle: "alice",
  name: "Alice",
  avatarUrl: undefined,
};

const counterparty: UserProfile = {
  id: "user-2",
  handle: "bob",
  name: "Bob",
  avatarUrl: undefined,
};

function makeInitialData(overrides: Partial<ConversationInitialData> = {}): ConversationInitialData {
  return {
    counterpartyId: "user-2",
    currentUser,
    groupId: "group-1",
    counterparty,
    thread: {
      messages: [],
      expenses: [],
      settlements: [],
      profiles: [["user-2", counterparty]],
    },
    hasMore: false,
    callerStatus: "accepted",
    counterpartyStatus: "accepted",
    error: null,
    ...overrides,
  };
}

describe("ConversationPageClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders chat thread with initial data", () => {
    render(<ConversationPageClient initialData={makeInitialData()} />);

    expect(screen.getByTestId("conversation-header")).toHaveTextContent("Bob");
    expect(screen.getByTestId("chat-thread")).toHaveTextContent("Messages: 0");
    expect(screen.getByTestId("chat-ai-input")).toBeInTheDocument();
    expect(screen.getByTestId("quick-actions")).toBeInTheDocument();
  });

  it("renders error state with retry button", () => {
    render(
      <ConversationPageClient
        initialData={makeInitialData({ error: "Usuário não encontrado" })}
      />,
    );

    expect(screen.getByText("Usuário não encontrado")).toBeInTheDocument();
    expect(screen.getByText("Tentar novamente")).toBeInTheDocument();
  });

  it("renders invite acceptance UI when caller is invited", () => {
    render(
      <ConversationPageClient
        initialData={makeInitialData({ callerStatus: "invited" })}
      />,
    );

    expect(screen.getByText("Aceitar convite")).toBeInTheDocument();
    expect(screen.getByText("Recusar")).toBeInTheDocument();
    expect(
      screen.getByText(/Esta conversa está pendente/),
    ).toBeInTheDocument();
  });

  it("renders declined state", () => {
    render(
      <ConversationPageClient
        initialData={makeInitialData({ callerStatus: "declined" })}
      />,
    );

    expect(screen.getByText("Você recusou este convite.")).toBeInTheDocument();
  });

  it("shows pending banner when counterparty has not accepted", () => {
    render(
      <ConversationPageClient
        initialData={makeInitialData({ counterpartyStatus: "invited" })}
      />,
    );

    expect(
      screen.getByText(/Aguardando @bob aceitar o convite/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("pay-button")).not.toBeInTheDocument();
  });

  it("shows pay button when both parties accepted", () => {
    render(<ConversationPageClient initialData={makeInitialData()} />);

    expect(screen.getByTestId("pay-button")).toBeInTheDocument();
  });

  it("renders messages from SSR data", () => {
    const message = {
      id: "msg-1",
      groupId: "group-1",
      senderId: "user-1",
      messageType: "text" as ChatMessageType,
      content: "Hello!",
      createdAt: "2026-01-01T00:00:00Z",
      sender: currentUser,
    };

    render(
      <ConversationPageClient
        initialData={makeInitialData({
          thread: {
            messages: [message],
            expenses: [],
            settlements: [],
            profiles: [["user-1", currentUser], ["user-2", counterparty]],
          },
        })}
      />,
    );

    expect(screen.getByTestId("chat-thread")).toHaveTextContent("Messages: 1");
  });

  it("does not render chat input when counterparty is pending", () => {
    render(
      <ConversationPageClient
        initialData={makeInitialData({ counterpartyStatus: "invited" })}
      />,
    );

    expect(screen.queryByTestId("chat-ai-input")).not.toBeInTheDocument();
    expect(screen.queryByTestId("quick-actions")).not.toBeInTheDocument();
  });

  it("returns null when counterparty or thread is missing", () => {
    const { container } = render(
      <ConversationPageClient
        initialData={makeInitialData({ counterparty: null, thread: null, error: null })}
      />,
    );

    expect(container.innerHTML).toBe("");
  });
});
