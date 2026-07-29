import React from "react";
import toast from "react-hot-toast";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  ConversationPageClient,
  type ConversationInitialData,
} from "./conversation-page-client";
import { buildChatExpenseConfirmationRequest } from "@/lib/supabase/chat-confirm";
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

vi.mock("@/lib/supabase/chat-confirm", () => ({
  buildChatExpenseConfirmationRequest: vi.fn(() => ({ error: "not implemented" })),
}));

vi.mock("@/lib/chat-confirmation-intent", () => ({
  confirmChatExpenseWithIntent: vi.fn(() =>
    Promise.resolve({ status: "error", error: "not implemented", code: "unknown" }),
  ),
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

const mockRpcFn = vi.fn(() =>
  Promise.resolve<{ data: null; error: { message: string } | null }>({
    data: null,
    error: null,
  }),
);

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
    rpc: mockRpcFn,
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "user-1" } } }),
    },
  }),
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
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
  ConversationQuickActions: ({ onCharge }: { onCharge: () => void }) => (
    <div data-testid="quick-actions">
      <button data-testid="open-quick-charge" onClick={onCharge}>
        Cobrar
      </button>
    </div>
  ),
}));

vi.mock("@/components/chat/quick-charge-sheet", () => ({
  QuickChargeSheet: ({
    onConfirm,
  }: {
    onConfirm: (result: {
      title: string;
      amountCents: number;
      expenseType: "single_amount";
      splitType: "equal";
      items: [];
      participants: { spokenName: string; matchedHandle: string; confidence: "high" }[];
      payerHandle: string;
      merchantName: null;
      confidence: "high";
    }) => void;
  }) => (
    <div data-testid="quick-charge-sheet">
      <button
        data-testid="quick-charge-self-paid"
        onClick={() =>
          onConfirm({
            title: "Cobrança",
            amountCents: 1001,
            expenseType: "single_amount",
            splitType: "equal",
            items: [],
            participants: [{ spokenName: "bob", matchedHandle: "bob", confidence: "high" }],
            payerHandle: "SELF",
            merchantName: null,
            confidence: "high",
          })
        }
      >
        Self paid
      </button>
      <button
        data-testid="quick-charge-counterparty-paid"
        onClick={() =>
          onConfirm({
            title: "Cobrança",
            amountCents: 1,
            expenseType: "single_amount",
            splitType: "equal",
            items: [],
            participants: [{ spokenName: "bob", matchedHandle: "bob", confidence: "high" }],
            payerHandle: "bob",
            merchantName: null,
            confidence: "high",
          })
        }
      >
        Counterparty paid
      </button>
    </div>
  ),
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

  it("shows declined state after a successful decline click", async () => {
    render(
      <ConversationPageClient
        initialData={makeInitialData({ callerStatus: "invited" })}
      />,
    );

    fireEvent.click(screen.getByText("Recusar"));

    expect(mockRpcFn).toHaveBeenCalledWith("decline_group_invitation", {
      p_group_id: "group-1",
    });
    await waitFor(() => {
      expect(screen.getByText("Você recusou este convite.")).toBeInTheDocument();
    });
  });

  it("keeps the invite pending and shows retryable feedback when decline is guard-rejected", async () => {
    mockRpcFn.mockResolvedValueOnce({
      data: null,
      error: { message: "has_outstanding_balance: you have an unsettled balance in this group" },
    });

    render(
      <ConversationPageClient
        initialData={makeInitialData({ callerStatus: "invited" })}
      />,
    );

    fireEvent.click(screen.getByText("Recusar"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Você possui um saldo pendente neste grupo. Peça para quitarem antes de recusar.",
      );
    });
    // The invite acceptance UI stays visible — never flipped to declined.
    expect(screen.getByText("Aceitar convite")).toBeInTheDocument();
  });

  it("shows accepted state after a successful accept click", async () => {
    render(
      <ConversationPageClient
        initialData={makeInitialData({ callerStatus: "invited" })}
      />,
    );

    fireEvent.click(screen.getByText("Aceitar convite"));

    await waitFor(() => {
      expect(mockRpcFn).toHaveBeenCalledWith("accept_group_invitation", {
        p_group_id: "group-1",
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId("chat-thread")).toBeInTheDocument();
    });
  });

  it("keeps the invite pending and shows retryable feedback when accept fails", async () => {
    mockRpcFn.mockResolvedValueOnce({
      data: null,
      error: { message: "not_invited: only a pending invitation can be accepted" },
    });

    render(
      <ConversationPageClient
        initialData={makeInitialData({ callerStatus: "invited" })}
      />,
    );

    fireEvent.click(screen.getByText("Aceitar convite"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Não foi possível aceitar o convite. Tente novamente.",
      );
    });
    // The RLS-denied direct-update path used to flip to "accepted" UI
    // even though the DB write silently failed. The RPC path surfaces
    // failure and keeps the pending-invite UI visible for retry.
    expect(screen.getByText("Aceitar convite")).toBeInTheDocument();
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

  // -------------------------------------------------------------------------
  // #474: Quick Charge must build exact 0/N shares, never an equal split.
  // -------------------------------------------------------------------------

  it("Quick Charge (self paid): builds exact shares actor=0, counterparty=N", async () => {
    vi.mocked(buildChatExpenseConfirmationRequest).mockReturnValue({ error: "stop here" });

    render(<ConversationPageClient initialData={makeInitialData()} />);

    fireEvent.click(screen.getByTestId("open-quick-charge"));
    fireEvent.click(screen.getByTestId("quick-charge-self-paid"));

    await waitFor(() => {
      expect(buildChatExpenseConfirmationRequest).toHaveBeenCalled();
    });

    const call = vi.mocked(buildChatExpenseConfirmationRequest).mock.calls[0][0];
    expect(call.precomputedShares).toEqual([
      { userId: "user-1", shareAmountCents: 0 },
      { userId: "user-2", shareAmountCents: 1001 },
    ]);
  });

  it("Quick Charge (counterparty paid): builds exact shares actor=N, counterparty=0, preserving a one-cent liability", async () => {
    vi.mocked(buildChatExpenseConfirmationRequest).mockReturnValue({ error: "stop here" });

    render(<ConversationPageClient initialData={makeInitialData()} />);

    fireEvent.click(screen.getByTestId("open-quick-charge"));
    fireEvent.click(screen.getByTestId("quick-charge-counterparty-paid"));

    await waitFor(() => {
      expect(buildChatExpenseConfirmationRequest).toHaveBeenCalled();
    });

    const call = vi.mocked(buildChatExpenseConfirmationRequest).mock.calls[0][0];
    expect(call.precomputedShares).toEqual([
      { userId: "user-1", shareAmountCents: 1 },
      { userId: "user-2", shareAmountCents: 0 },
    ]);
  });
});
