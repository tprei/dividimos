import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationPageClient } from "./conversation-page-client";
import { useAppStore } from "@/stores/app-store";
import type { ChatExpenseResult } from "@/lib/chat-expense-parser";
import type { ChatMessage, GroupEvent, GroupSnapshot, Me } from "@/types/ledger";
const mutations = vi.hoisted(() => ({
  sendMessage: vi.fn().mockResolvedValue({ id: "msg-ack" }),
  markRead: vi.fn().mockResolvedValue(undefined),
  createExpense: vi.fn().mockResolvedValue({ expenseId: "exp-ack" }),
}));
vi.mock("@/lib/sync/mutations", () => mutations);

const mutationsGroup = vi.hoisted(() => ({
  getOrCreateDm: vi.fn().mockResolvedValue({ groupId: "dm-1", created: false }),
  acceptInvitation: vi.fn().mockResolvedValue({ eventId: 1 }),
  declineInvitation: vi.fn().mockResolvedValue({ eventId: 2 }),
}));
vi.mock("@/lib/sync/mutations-group", () => mutationsGroup);

const refresh = vi.hoisted(() => ({
  loadConversation: vi.fn().mockResolvedValue(undefined),
  refreshGroup: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/sync/refresh", () => refresh);

const realtime = vi.hoisted(() => ({
  subscribeChat: vi.fn(() => vi.fn()),
}));
vi.mock("@/lib/sync/realtime", () => realtime);

const aiParse = vi.hoisted(() => ({
  result: null as ChatExpenseResult | null,
  parse: vi.fn(),
  reset: vi.fn(),
}));
vi.mock("@/hooks/use-ai-expense-parse", () => ({
  useAiExpenseParse: () => ({
    result: aiParse.result,
    parse: aiParse.parse,
    reset: aiParse.reset,
    isParsing: false,
    error: null,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const me: Me = {
  id: "user-me",
  handle: "alice",
  name: "Alice Souza",
  avatarUrl: null,
  email: "alice@example.com",
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: true,
  notificationPreferences: {},
};

const counterparty = {
  id: "user-other",
  handle: "bob",
  name: "Bob Silva",
  avatarUrl: null,
};
const incomingMessage: ChatMessage = {
  id: "msg-incoming",
  clientId: "client-incoming",
  groupId: "dm-1",
  senderId: counterparty.id,
  content: "Oi, Alice!",
  createdAt: "2026-01-01T00:01:00Z",
  sender: counterparty,
};


function makeDmSnapshot(overrides: Partial<GroupSnapshot> = {}): GroupSnapshot {
  return {
    group: {
      id: "dm-1",
      kind: "dm",
      name: "Bob Silva",
      creatorId: me.id,
      dmUserA: me.id,
      dmUserB: counterparty.id,
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
    },
    members: [
      { groupId: "dm-1", userId: me.id, status: "accepted", invitedBy: null, acceptedAt: null, user: me },
      {
        groupId: "dm-1",
        userId: counterparty.id,
        status: "accepted",
        invitedBy: null,
        acceptedAt: null,
        user: counterparty,
      },
    ],
    balances: [],
    guests: [],
    settlements: [],
    recentExpenses: [],
    expenseCount: 0,
    lastEventId: 1,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-01T00:00:00Z",
    pairwiseEdges: [],
    ...overrides,
  };
}

function seedDm(
  snapshot: GroupSnapshot,
  conversation: { messages: ChatMessage[]; events: GroupEvent[] },
) {
  useAppStore.setState({
    hydrated: true,
    me,
    groups: { [snapshot.group.id]: snapshot },
    groupOrder: [snapshot.group.id],
    conversations: {
      [snapshot.group.id]: {
        messages: conversation.messages,
        events: conversation.events,
        messageCursor: null,
        messagesComplete: true,
        eventCursor: null,
        eventsComplete: true,
        readWatermark: null,
        reconcile: {
          status: "ready",
          // Mirrors the store reducer: with a complete history, the newest
          // incoming message is the acknowledgeable boundary.
          readableThroughMessageId:
            conversation.messages.filter((m) => m.senderId !== me.id).at(-1)?.id ?? null,
        },
      },
    },
  });
}
function aiDraft(overrides: Partial<ChatExpenseResult> = {}): ChatExpenseResult {
  return {
    title: "Jantar",
    amountCents: 10000,
    expenseType: "single_amount",
    splitType: "equal",
    allocations: [],
    items: [],
    participants: [],
    payerHandle: null,
    merchantName: null,
    confidence: "high",
    ...overrides,
  };
}


describe("ConversationPageClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aiParse.result = null;
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
  });

  it("timeline merges messages and events by createdAt", () => {
    const message1: ChatMessage = {
      id: "m-1",
      clientId: "c-1",
      groupId: "dm-1",
      senderId: counterparty.id,
      content: "Primeira mensagem",
      createdAt: "2026-01-01T10:00:00Z",
      sender: counterparty,
    };
    const event1: GroupEvent = {
      id: 1,
      groupId: "dm-1",
      actorId: me.id,
      kind: "expense_created",
      expenseId: "e-1",
      settlementId: null,
      subjectUserId: null,
      payload: { totalCents: 2000, title: "Café" },
      createdAt: "2026-01-01T11:00:00Z",
      actor: me,
      expenseTitle: "Café",
    };
    const message2: ChatMessage = {
      id: "m-2",
      clientId: "c-2",
      groupId: "dm-1",
      senderId: me.id,
      content: "Segunda mensagem",
      createdAt: "2026-01-01T12:00:00Z",
      sender: me,
    };

    seedDm(makeDmSnapshot(), {
      messages: [message2, message1],
      events: [event1],
    });

    render(<ConversationPageClient counterpartyId={counterparty.id} />);

    expect(screen.getByText("Primeira mensagem")).toBeDefined();
    expect(screen.getByText("Café")).toBeDefined();
    expect(screen.getByText("Segunda mensagem")).toBeDefined();

    const text1 = screen.getByText("Primeira mensagem");
    const text2 = screen.getByText("Segunda mensagem");
    expect(text1.compareDocumentPosition(text2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("loads DM history on mount without waiting for realtime", async () => {
    seedDm(makeDmSnapshot(), { messages: [], events: [] });

    render(<ConversationPageClient counterpartyId={counterparty.id} />);

    await waitFor(() => {
      expect(refresh.loadConversation).toHaveBeenCalledWith("dm-1");
    });
  });
  it("does not render chat actions when the account is absent from the DM", () => {
    const snapshot = makeDmSnapshot({
      members: [makeDmSnapshot().members[1]!],
    });
    seedDm(snapshot, { messages: [], events: [] });

    render(<ConversationPageClient counterpartyId={counterparty.id} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Essa conversa não está disponível para sua conta.",
    );
    expect(screen.queryByTestId("chat-input")).toBeNull();
    expect(screen.queryByText("Nova cobrança")).toBeNull();
  });

  it("sending a message calls sendMessage", async () => {
    seedDm(makeDmSnapshot(), { messages: [], events: [] });

    render(<ConversationPageClient counterpartyId={counterparty.id} />);

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "Olá Bob!" } });

    const sendBtn = screen.getByTestId("send-button");
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(mutations.sendMessage).toHaveBeenCalledWith("dm-1", "Olá Bob!");
    });
  });
  it("opening with unread calls markRead at the latest incoming message", async () => {
    seedDm(makeDmSnapshot({ unreadCount: 3 }), { messages: [incomingMessage], events: [] });

    render(<ConversationPageClient counterpartyId={counterparty.id} />);

    await waitFor(() => {
      expect(mutations.markRead).toHaveBeenCalledWith("dm-1", "msg-incoming");
    });
  });
  it("rejects an unresolved chat actor before the confirmation write", async () => {
    aiParse.result = aiDraft({
      participants: [{ spokenName: "Carol", matchedHandle: null, confidence: "low" }],
      payerHandle: "carol",
    });
    seedDm(makeDmSnapshot(), { messages: [], events: [] });

    render(<ConversationPageClient counterpartyId={counterparty.id} />);
    fireEvent.click(screen.getByTestId("draft-confirm-button"));

    await waitFor(() => {
      expect(screen.getByTestId("draft-error")).toHaveTextContent("identificar");
    });
    expect(mutations.createExpense).not.toHaveBeenCalled();
  });

  it("writes a valid chat actor set through the direct confirmation handler", async () => {
    aiParse.result = aiDraft({ payerHandle: "SELF" });
    seedDm(makeDmSnapshot(), { messages: [], events: [] });

    render(<ConversationPageClient counterpartyId={counterparty.id} />);
    fireEvent.click(screen.getByTestId("draft-confirm-button"));

    await waitFor(() => {
      expect(mutations.createExpense).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: "dm-1",
          payload: expect.objectContaining({
            participants: [
              { kind: "user", userId: me.id },
              { kind: "user", userId: counterparty.id },
            ],
            payers: [{ participantIndex: 0, amountCents: 10000 }],
          }),
        }),
      );
    });
  });
  it("rejects a quick-charge payer when the displayed handles conflict", async () => {
    const conflictingCounterparty = { ...counterparty, handle: me.handle };
    seedDm(
      makeDmSnapshot({
        members: [
          makeDmSnapshot().members[0],
          {
            ...makeDmSnapshot().members[1],
            user: conflictingCounterparty,
          },
        ],
      }),
      { messages: [], events: [] },
    );

    render(<ConversationPageClient counterpartyId={counterparty.id} />);
    fireEvent.click(screen.getByText("Nova cobrança"));
    fireEvent.change(screen.getByTestId("quick-charge-amount"), {
      target: { value: "100,00" },
    });
    fireEvent.click(screen.getByTestId("quick-charge-confirm"));

    await waitFor(() => {
      expect(screen.getByTestId("quick-charge-error")).toHaveTextContent("handles");
    });
    expect(mutations.createExpense).not.toHaveBeenCalled();
  });
});
