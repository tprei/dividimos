import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, Conversation, Me } from "@/types/ledger";
import { useAppStore } from "@/stores/app-store";
import { conversationState } from "@/stores/app-store-merge";
import { advanceAuthGeneration } from "./client";
import { loadConversation, refreshGroup } from "./refresh";
import {
  invalidateChatReconciliation,
  isMalformedHint,
  reconcileChat,
  resetChatReconciliation,
} from "./chat-reconcile";

vi.mock("./refresh", () => ({ loadConversation: vi.fn(), refreshGroup: vi.fn(async () => {}) }));

const ME: Me = {
  id: "user-me",
  handle: "me_user",
  name: "Eu Mesmo",
  avatarUrl: null,
  email: "me@example.com",
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: true,
  notificationPreferences: { expenses: true, settlements: true, nudges: true },
};

function message(id: string, createdAt: string): ChatMessage {
  return {
    id,
    clientId: id,
    groupId: "g1",
    senderId: "user-other",
    content: "oi",
    createdAt,
    sender: { id: "user-other", handle: "outro", name: "Outro", avatarUrl: null },
  };
}

function page(overrides: Partial<Conversation> = {}): Conversation {
  return {
    messages: [],
    messageCursor: null,
    messagesComplete: true,
    events: [],
    eventCursor: null,
    eventsComplete: true,
    readWatermark: null,
    ...overrides,
  };
}

/** Applies pages the way the real loader does, so store state advances too. */
function respondWith(pages: Conversation[]): void {
  let call = 0;
  vi.mocked(loadConversation).mockImplementation(async (groupId, cursors) => {
    const result = pages[Math.min(call, pages.length - 1)] ?? page();
    call += 1;
    useAppStore
      .getState()
      .applyConversation(groupId, {
        kind: cursors === undefined ? "head" : "older",
        envelope: result,
      });
    return result;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetChatReconciliation();
  useAppStore.getState().reset();
  useAppStore.setState({ me: ME });
});

describe("reconcileChat", () => {
  it("walks past a full head page instead of assuming it is all history", async () => {
    respondWith([
      page({
        messages: [message("m50", "2026-01-02T10:00:00.000000Z")],
        messageCursor: { createdAt: "2026-01-02T10:00:00.000000Z", id: "m50" },
        messagesComplete: false,
      }),
      page({
        messages: [message("m1", "2026-01-01T10:00:00.000000Z")],
        messageCursor: null,
        messagesComplete: true,
      }),
    ]);

    reconcileChat("g1");
    await vi.waitFor(() => {
      expect(useAppStore.getState().conversations.g1?.reconcile.status).toBe("ready");
    });

    expect(loadConversation).toHaveBeenCalledTimes(2);
    expect(refreshGroup).toHaveBeenCalledWith("g1");
    // The second call must page strictly older using the first page's cursor.
    expect(vi.mocked(loadConversation).mock.calls[1]?.[1]).toEqual({
      messageBefore: { createdAt: "2026-01-02T10:00:00.000000Z", id: "m50" },
      eventBefore: null,
    });
    expect(useAppStore.getState().conversations.g1?.messages).toHaveLength(2);
  });

  it("does not treat one exhausted stream as proof the other is complete", async () => {
    respondWith([
      page({
        messages: [message("m9", "2026-01-02T10:00:00.000000Z")],
        messageCursor: { createdAt: "2026-01-02T10:00:00.000000Z", id: "m9" },
        messagesComplete: false,
        eventsComplete: true,
      }),
      page({ messagesComplete: true, eventsComplete: true }),
    ]);

    reconcileChat("g1");
    await vi.waitFor(() => {
      expect(useAppStore.getState().conversations.g1?.reconcile.status).toBe("ready");
    });

    expect(loadConversation).toHaveBeenCalledTimes(2);
  });
  it("continues paging events when messages are already exhausted", async () => {
    respondWith([
      page({
        messageCursor: null,
        messagesComplete: true,
        eventCursor: { createdAt: "2026-01-02T10:00:00.000000Z", id: "40" },
        eventsComplete: false,
      }),
      page(),
    ]);

    reconcileChat("g1");
    await vi.waitFor(() => {
      expect(useAppStore.getState().conversations.g1?.reconcile.status).toBe("ready");
    });

    expect(loadConversation).toHaveBeenCalledTimes(2);
    expect(vi.mocked(loadConversation).mock.calls[1]?.[1]).toEqual({
      messageBefore: null,
      eventBefore: { createdAt: "2026-01-02T10:00:00.000000Z", id: "40" },
    });
  });

  it("keeps prior rows and cursors when a page fails", async () => {
    useAppStore.setState({
      conversations: {
        g1: conversationState({
          messages: [message("m1", "2026-01-02T10:00:00.000000Z")],
          messageCursor: { createdAt: "2026-01-02T10:00:00.000000Z", id: "m1" },
        }),
      },
    });
    vi.mocked(loadConversation).mockRejectedValue(new Error("offline"));

    reconcileChat("g1");
    await vi.waitFor(() => {
      expect(useAppStore.getState().conversations.g1?.reconcile.status).toBe("error");
    });

    const conversation = useAppStore.getState().conversations.g1;
    expect(conversation?.messages).toHaveLength(1);
    expect(conversation?.messageCursor?.id).toBe("m1");
    expect(conversation?.reconcile.readableThroughMessageId).toBeNull();
  });

  it("cannot publish after the account changed", async () => {
    const gate = Promise.withResolvers<Conversation>();
    vi.mocked(loadConversation).mockReturnValue(gate.promise);

    reconcileChat("g1");
    advanceAuthGeneration();
    gate.resolve(page({ messages: [message("m1", "2026-01-02T10:00:00.000000Z")] }));
    await gate.promise;

    expect(useAppStore.getState().conversations.g1).toBeUndefined();
  });

  it("cannot publish after its subscription was invalidated", async () => {
    const gate = Promise.withResolvers<Conversation>();
    vi.mocked(loadConversation).mockReturnValue(gate.promise);

    reconcileChat("g1");
    invalidateChatReconciliation("g1");
    gate.resolve(page());
    await gate.promise;

    expect(useAppStore.getState().conversations.g1?.reconcile.status).not.toBe("ready");
  });

  it("coalesces repeated hints into one run plus a single follow-up", async () => {
    const gate = Promise.withResolvers<Conversation>();
    vi.mocked(loadConversation).mockReturnValueOnce(gate.promise);

    reconcileChat("g1");
    reconcileChat("g1");
    reconcileChat("g1");
    expect(loadConversation).toHaveBeenCalledTimes(1);

    respondWith([page()]);
    gate.resolve(page());
    await vi.waitFor(() => {
      expect(loadConversation).toHaveBeenCalledTimes(2);
    });
  });
});

describe("isMalformedHint", () => {
  it("flags a broadcast older than the known history but not one inside it", () => {
    useAppStore.setState({
      conversations: {
        g1: conversationState({
          messages: [message("m5", "2026-01-02T10:00:00.000000Z")],
          messagesComplete: false,
        }),
      },
    });

    expect(isMalformedHint("g1", "2026-01-01T10:00:00.000000Z")).toBe(true);
    expect(isMalformedHint("g1", "2026-01-03T10:00:00.000000Z")).toBe(false);
  });

  it("never flags when the history is already complete", () => {
    useAppStore.setState({
      conversations: {
        g1: conversationState({
          messages: [message("m5", "2026-01-02T10:00:00.000000Z")],
          messagesComplete: true,
        }),
      },
    });

    expect(isMalformedHint("g1", "2026-01-01T10:00:00.000000Z")).toBe(false);
  });
});
