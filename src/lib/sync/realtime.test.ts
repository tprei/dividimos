import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAppStore } from "@/stores/app-store";
import type { Database } from "@/types/database";
import type { ChatMessage, GroupSnapshot, Me } from "@/types/ledger";
import { runBootstrap } from "./bootstrap";
import { getSupabase } from "./client";
import { reconcileChat } from "./chat-reconcile";
import {
  handleChatBroadcast,
  mergeChatBroadcast,
  parseMembershipPayload,
  shouldRefreshGroup,
  startRealtime,
  subscribeChat,
} from "./realtime";
import { refreshGroup } from "./refresh";
const authState = vi.hoisted(() => ({ generation: 0 }));
vi.mock("./client", () => ({
  getSupabase: vi.fn(),
  getAuthGeneration: () => authState.generation,
}));
vi.mock("./bootstrap", () => ({ runBootstrap: vi.fn() }));
vi.mock("./refresh", () => ({ refreshGroup: vi.fn(async () => {}) }));
vi.mock("./chat-reconcile", () => ({
  isMalformedHint: vi.fn(() => false),
  reconcileChat: vi.fn(),
  invalidateChatReconciliation: vi.fn(),
}));

const meUser: Me = {
  id: "user-1",
  handle: "user1",
  name: "User One",
  avatarUrl: null,
  isBot: false,
  email: "user1@example.com",
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: true,
  notificationPreferences: {
    expenses: true,
    settlements: true,
    messages: true,
  },
};

const baseSnapshot: GroupSnapshot = {
  group: {
    id: "group-1",
    kind: "group",
    name: "Viagem",
    creatorId: "user-1",
    dmUserA: null,
    dmUserB: null,
    ledgerVersion: 5,
    createdAt: "2026-09-01T10:00:00.000Z",
  },
  dmCounterparty: null,
  members: [],
  balances: [],
  guests: [],
  settlements: [],
  recentExpenses: [],
  expenseCount: 0,
  lastEventId: 20,
  unreadCount: 0,
  lastMessage: null,
  lastActivityAt: "2026-09-01T10:00:00.000Z",
  pairwiseEdges: [],
};

const incomingMessage: ChatMessage = {
  id: "msg-101",
  clientId: "client-uuid-101",
  groupId: "group-1",
  senderId: "user-2",
  content: "E aí pessoal!",
  erased: false,
  createdAt: "2026-09-05T12:00:00.000Z",
  sender: {
    id: "user-2",
    handle: "user2",
    name: "User Two",
    avatarUrl: null,
    isBot: false,
  },
};

describe("shouldRefreshGroup", () => {
  it("returns false for stale version and stale event", () => {
    const payload = {
      group_id: "group-1",
      ledger_version: 5,
      event_id: 20,
    };
    expect(shouldRefreshGroup(baseSnapshot, payload)).toBe(false);

    const olderPayload = {
      group_id: "group-1",
      ledger_version: 4,
      event_id: 19,
    };
    expect(shouldRefreshGroup(baseSnapshot, olderPayload)).toBe(false);
  });

  it("returns true when ledger_version is newer", () => {
    const payload = {
      group_id: "group-1",
      ledger_version: 6,
      event_id: 20,
    };
    expect(shouldRefreshGroup(baseSnapshot, payload)).toBe(true);
  });

  it("returns true when only event_id is newer", () => {
    const payload = {
      group_id: "group-1",
      ledger_version: 5,
      event_id: 21,
    };
    expect(shouldRefreshGroup(baseSnapshot, payload)).toBe(true);
  });

  it("returns false for malformed payloads", () => {
    expect(shouldRefreshGroup(baseSnapshot, null)).toBe(false);
    expect(shouldRefreshGroup(baseSnapshot, undefined)).toBe(false);
    expect(shouldRefreshGroup(baseSnapshot, {})).toBe(false);
    expect(
      shouldRefreshGroup(baseSnapshot, {
        group_id: "group-1",
        ledger_version: "6",
        event_id: 21,
      }),
    ).toBe(false);
    expect(
      shouldRefreshGroup(baseSnapshot, {
        group_id: 123,
        ledger_version: 6,
        event_id: 21,
      }),
    ).toBe(false);
    expect(
      shouldRefreshGroup(baseSnapshot, {
        ledger_version: 6,
        event_id: 21,
      }),
    ).toBe(false);
  });

  it("returns true for unknown group with valid payload", () => {
    const payload = {
      group_id: "group-x",
      ledger_version: 1,
      event_id: 1,
    };
    expect(shouldRefreshGroup(undefined, payload)).toBe(true);
  });

  it("returns false for unknown group with malformed payload", () => {
    expect(shouldRefreshGroup(undefined, { bad: "payload" })).toBe(false);
  });
});

describe("mergeChatBroadcast", () => {
  beforeEach(() => {
    useAppStore.getState().reset();
  });

  it("appends new message and updates lastMessage and unreadCount for other sender", () => {
    useAppStore.setState({
      me: meUser,
      groups: { "group-1": baseSnapshot },
      conversations: {},
    });

    const patch = mergeChatBroadcast(
      useAppStore.getState(),
      "group-1",
      incomingMessage,
    );

    expect(patch.conversations?.["group-1"]?.messages).toHaveLength(1);
    expect(patch.conversations?.["group-1"]?.messages[0]).toEqual(
      incomingMessage,
    );
    expect(patch.groups?.["group-1"]?.unreadCount).toBe(1);
    expect(patch.groups?.["group-1"]?.lastMessage).toEqual({
      content: "E aí pessoal!",
      erased: false,
      senderId: "user-2",
      createdAt: "2026-09-05T12:00:00.000Z",
      sender: incomingMessage.sender,
    });
  });

  it("ignores a broadcast from a blocked sender without touching preview or unread", () => {
    useAppStore.setState({
      me: meUser,
      groups: { "group-1": baseSnapshot },
      conversations: {},
      blockedUsers: [{ id: incomingMessage.senderId, handle: "blocked", name: "Blocked", avatarUrl: null, isBot: false }],
    });

    const patch = mergeChatBroadcast(useAppStore.getState(), "group-1", incomingMessage);

    expect(patch).toEqual({});
  });

  it("does not bump unreadCount when message sender is me", () => {
    const myMessage: ChatMessage = {
      ...incomingMessage,
      senderId: meUser.id,
    };

    useAppStore.setState({
      me: meUser,
      groups: { "group-1": baseSnapshot },
      conversations: {},
    });

    const patch = mergeChatBroadcast(
      useAppStore.getState(),
      "group-1",
      myMessage,
    );

    expect(patch.conversations?.["group-1"]?.messages).toHaveLength(1);
    expect(patch.groups?.["group-1"]?.unreadCount).toBe(0);
    expect(patch.groups?.["group-1"]?.lastMessage?.content).toBe(
      "E aí pessoal!",
    );
  });

  it("dedupes message by clientId", () => {
    useAppStore.setState({
      me: meUser,
      groups: { "group-1": { ...baseSnapshot, unreadCount: 3 } },
      conversations: {
        "group-1": {
          messages: [
            {
              ...incomingMessage,
              id: "temp-optimistic-id",
              clientId: incomingMessage.clientId,
            },
          ],
          events: [],
          messageCursor: null,
          messagesComplete: true,
          eventCursor: null,
          eventsComplete: true,
          readWatermark: null,
          reconcile: { status: "ready", readableThroughMessageId: null },
        },
      },
    });

    const patch = mergeChatBroadcast(
      useAppStore.getState(),
      "group-1",
      incomingMessage,
    );

    expect(patch.conversations?.["group-1"]?.messages).toHaveLength(1);
    expect(patch.conversations?.["group-1"]?.messages[0]?.id).toBe(
      incomingMessage.id,
    );
    expect(patch.groups?.["group-1"]?.unreadCount).toBe(3);
    expect(patch.groups?.["group-1"]?.lastMessage?.content).toBe(
      "E aí pessoal!",
    );
  });

  it("replaces a held message with its erasure broadcast", () => {
    useAppStore.setState({
      me: meUser,
      groups: { "group-1": baseSnapshot },
      conversations: {
        "group-1": {
          messages: [incomingMessage],
          events: [],
          messageCursor: null,
          messagesComplete: true,
          eventCursor: null,
          eventsComplete: true,
          readWatermark: null,
          reconcile: { status: "ready", readableThroughMessageId: null },
        },
      },
    });

    const erasure: ChatMessage = { ...incomingMessage, content: null, erased: true };
    const patch = mergeChatBroadcast(useAppStore.getState(), "group-1", erasure);

    expect(patch.conversations?.["group-1"]?.messages).toHaveLength(1);
    expect(patch.conversations?.["group-1"]?.messages[0]?.erased).toBe(true);
    expect(patch.conversations?.["group-1"]?.messages[0]?.content).toBeNull();
    expect(patch.groups?.["group-1"]?.unreadCount).toBe(0);
    expect(patch.groups?.["group-1"]?.lastMessage?.erased).toBe(true);
  });

  it("does not move the preview backward or bump unread for an out-of-window erasure", () => {
    const window = [
      { ...incomingMessage, id: "m-2", clientId: "c-2", createdAt: "2026-09-05T12:00:00.000Z" },
      { ...incomingMessage, id: "m-3", clientId: "c-3", createdAt: "2026-09-05T13:00:00.000Z" },
    ];
    useAppStore.setState({
      me: meUser,
      groups: {
        "group-1": {
          ...baseSnapshot,
          unreadCount: 4,
          lastMessage: {
            content: "última mensagem",
            erased: false,
            senderId: "user-2",
            createdAt: "2026-09-06T12:00:00.000Z",
            sender: incomingMessage.sender,
          },
        },
      },
      conversations: {
        "group-1": {
          messages: window,
          events: [],
          messageCursor: { createdAt: "2026-09-05T12:00:00.000Z", id: "m-2" },
          messagesComplete: false,
          eventCursor: null,
          eventsComplete: true,
          readWatermark: null,
          reconcile: { status: "ready", readableThroughMessageId: null },
        },
      },
    });

    const erasure: ChatMessage = {
      ...incomingMessage,
      content: null,
      erased: true,
      createdAt: "2026-09-04T12:00:00.000Z",
    };
    const patch = mergeChatBroadcast(useAppStore.getState(), "group-1", erasure);

    expect(patch.conversations).toBeUndefined();
    expect(useAppStore.getState().conversations["group-1"]?.messages).toEqual(window);
    expect(patch.groups?.["group-1"]?.unreadCount).toBe(4);
    expect(patch.groups?.["group-1"]?.lastMessage?.content).toBe(
      "última mensagem",
    );
    expect(patch.groups?.["group-1"]?.lastMessage?.erased).toBe(false);
  });

  it("does not reconcile an out-of-window erasure broadcast", () => {
    useAppStore.setState({
      me: meUser,
      groups: { "group-1": baseSnapshot },
      conversations: {
        "group-1": {
          messages: [
            { ...incomingMessage, id: "m-2", clientId: "c-2", createdAt: "2026-09-05T12:00:00.000Z" },
          ],
          events: [],
          messageCursor: null,
          messagesComplete: false,
          eventCursor: null,
          eventsComplete: true,
          readWatermark: null,
          reconcile: { status: "ready", readableThroughMessageId: null },
        },
      },
    });

    handleChatBroadcast(
      "group-1",
      {
        ...incomingMessage,
        id: "m-1",
        clientId: "c-1",
        content: null,
        erased: true,
        createdAt: "2026-09-04T12:00:00.000Z",
      },
      authState.generation,
    );

    expect(vi.mocked(reconcileChat)).not.toHaveBeenCalled();
  });

  it("keeps an erased preview against an equal-timestamp cleartext copy", () => {
    useAppStore.setState({
      me: meUser,
      groups: {
        "group-1": {
          ...baseSnapshot,
          unreadCount: 0,
          lastMessage: {
            content: null,
            erased: true,
            senderId: "user-2",
            createdAt: "2026-09-05T12:00:00.000Z",
            sender: incomingMessage.sender,
          },
        },
      },
      conversations: {},
    });

    const patch = mergeChatBroadcast(
      useAppStore.getState(),
      "group-1",
      incomingMessage,
    );

    expect(patch.groups?.["group-1"]?.lastMessage?.erased).toBe(true);
    expect(patch.groups?.["group-1"]?.lastMessage?.content).toBeNull();
  });

  it("dedupes message by id", () => {
    useAppStore.setState({
      me: meUser,
      groups: { "group-1": { ...baseSnapshot, unreadCount: 2 } },
      conversations: {
        "group-1": {
          messages: [incomingMessage],
          events: [],
          messageCursor: null,
          messagesComplete: true,
          eventCursor: null,
          eventsComplete: true,
          readWatermark: null,
          reconcile: { status: "ready", readableThroughMessageId: null },
        },
      },
    });

    const patch = mergeChatBroadcast(
      useAppStore.getState(),
      "group-1",
      incomingMessage,
    );

    expect(patch.conversations?.["group-1"]?.messages).toHaveLength(1);
    expect(patch.groups?.["group-1"]?.unreadCount).toBe(2);
  });
});

type BroadcastListener = (message: { payload: unknown }) => void;

type StatusListener = (status: string) => void;

class FakeChannel {
  readonly topic: string;
  readonly config: unknown;
  readonly listeners = new Map<string, BroadcastListener[]>();
  statusCallback: StatusListener | null = null;
  subscribed = false;

  constructor(topic: string, config: unknown) {
    this.topic = topic;
    this.config = config;
  }

  on(
    _kind: "broadcast",
    filter: { event: string },
    listener: BroadcastListener,
  ): this {
    const existing = this.listeners.get(filter.event) ?? [];
    existing.push(listener);
    this.listeners.set(filter.event, existing);
    return this;
  }

  subscribe(callback?: StatusListener): this {
    this.subscribed = true;
    this.statusCallback = callback ?? null;
    return this;
  }

  emitStatus(status: string): void {
    this.statusCallback?.(status);
  }

  emit(event: string, payload: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener({ payload });
    }
  }
}

let createdChannels: FakeChannel[] = [];
let removedChannels: FakeChannel[] = [];
const bootstrapResolvers: Array<(value: void) => void> = [];
const bootstrapPromises: Promise<void>[] = [];

describe("parseMembershipPayload", () => {
  it("accepts a payload with a string group_id", () => {
    expect(parseMembershipPayload({ group_id: "group-9" })).toEqual({
      group_id: "group-9",
    });
  });

  it("rejects malformed payloads", () => {
    expect(parseMembershipPayload(null)).toBeNull();
    expect(parseMembershipPayload("group-9")).toBeNull();
    expect(parseMembershipPayload(42)).toBeNull();
    expect(parseMembershipPayload({ group_id: null })).toBeNull();
    expect(parseMembershipPayload({ groupId: "group-9" })).toBeNull();
  });
});

describe("startRealtime", () => {
  let stop: (() => void) | null = null;

  afterEach(() => {
    stop?.();
    stop = null;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    createdChannels = [];
    removedChannels = [];
    authState.generation = 0;
    bootstrapResolvers.length = 0;
    bootstrapPromises.length = 0;
    useAppStore.getState().reset();

    const fakeSupabase = {
      channel: (topic: string, config?: unknown) => {
        const channel = new FakeChannel(topic, config);
        createdChannels.push(channel);
        return channel;
      },
      removeChannel: (channel: FakeChannel) => {
        removedChannels.push(channel);
      },
    };
    vi.mocked(getSupabase).mockImplementation(
      () => fakeSupabase as unknown as SupabaseClient<Database>,
    );
    vi.mocked(runBootstrap).mockImplementation(() => {
      const { promise, resolve } = Promise.withResolvers<void>();
      bootstrapResolvers.push(resolve);
      bootstrapPromises.push(promise);
      return promise;
    });
  });

  function userChannel(userId: string): FakeChannel {
    const channel = createdChannels.find((c) => c.topic === `user:${userId}`);
    if (!channel) throw new Error(`user channel for ${userId} not opened`);
    return channel;
  }

  async function settleRefreshes(): Promise<void> {
    await Promise.allSettled(bootstrapPromises);
  }

  it("opens the user channel with the membership event once me exists", () => {
    useAppStore.setState({ me: meUser });
    stop = startRealtime();

    const channel = userChannel(meUser.id);
    expect(channel.config).toEqual({ config: { private: true } });
    expect(channel.subscribed).toBe(true);
    expect(channel.listeners.has("membership")).toBe(true);
  });
  it("ignores chat broadcasts from the previous account", () => {
    useAppStore.setState({ me: meUser });
    const stopChat = subscribeChat("group-1");
    const channel = createdChannels.find((item) => item.topic === "chat:group-1");
    if (!channel) throw new Error("chat channel not opened");

    authState.generation = 1;
    channel.emit("message", incomingMessage);

    expect(useAppStore.getState().conversations).toEqual({});
    stopChat();
  });

  it("opens no user channel before sign-in and opens it when me appears", () => {
    stop = startRealtime();
    expect(createdChannels).toStrictEqual([]);

    useAppStore.setState({ me: meUser });
    expect(createdChannels.map((c) => c.topic)).toStrictEqual([
      `user:${meUser.id}`,
    ]);
  });

  it("still opens group channels alongside the user channel", () => {
    useAppStore.setState({ me: meUser, groupOrder: ["group-1"] });
    stop = startRealtime();

    expect(createdChannels.map((c) => c.topic)).toStrictEqual([
      "group:group-1",
      `user:${meUser.id}`,
    ]);
  });

  it("replaces the user channel when me changes identity", () => {
    useAppStore.setState({ me: meUser });
    stop = startRealtime();
    const first = userChannel(meUser.id);

    const otherUser: Me = { ...meUser, id: "user-2", handle: "user2" };
    useAppStore.setState({ me: otherUser });

    const second = userChannel(otherUser.id);
    expect(second).not.toBe(first);
    expect(removedChannels).toStrictEqual([first]);
  });

  it("refreshes bootstrap exactly once for a valid membership broadcast", async () => {
    useAppStore.setState({ me: meUser });
    stop = startRealtime();
    const channel = userChannel(meUser.id);

    channel.emit("membership", { group_id: "group-9" });
    expect(runBootstrap).toHaveBeenCalledTimes(1);

    bootstrapResolvers[0]?.();
    await settleRefreshes();
    expect(runBootstrap).toHaveBeenCalledTimes(1);
  });

  it("ignores malformed membership broadcasts", async () => {
    useAppStore.setState({ me: meUser });
    stop = startRealtime();
    const channel = userChannel(meUser.id);

    channel.emit("membership", { ledger_version: 3 });
    channel.emit("membership", "group-9");
    channel.emit("membership", null);

    await settleRefreshes();
    expect(runBootstrap).not.toHaveBeenCalled();
  });

  it("coalesces overlapping membership broadcasts into one in-flight refresh", async () => {
    useAppStore.setState({ me: meUser });
    stop = startRealtime();
    const channel = userChannel(meUser.id);

    channel.emit("membership", { group_id: "group-9" });
    channel.emit("membership", { group_id: "group-10" });
    channel.emit("membership", { group_id: "group-11" });
    expect(runBootstrap).toHaveBeenCalledTimes(1);

    bootstrapResolvers[0]?.();
    await vi.waitFor(() => expect(runBootstrap).toHaveBeenCalledTimes(2));

    bootstrapResolvers[1]?.();
    await settleRefreshes();
    expect(runBootstrap).toHaveBeenCalledTimes(2);
  });

  it("removes the user channel on cleanup", () => {
    useAppStore.setState({ me: meUser });
    stop = startRealtime();
    const channel = userChannel(meUser.id);

    stop();

    expect(removedChannels).toStrictEqual([channel]);
  });

  it("refreshes a group once when its channel recovers, not on first subscribe", () => {
    useAppStore.setState({ me: meUser, groupOrder: ["group-1"] });
    stop = startRealtime();
    const channel = createdChannels.find((c) => c.topic === "group:group-1");
    if (!channel) throw new Error("group channel not opened");

    channel.emitStatus("SUBSCRIBED");
    expect(refreshGroup).not.toHaveBeenCalled();

    channel.emitStatus("CHANNEL_ERROR");
    channel.emitStatus("TIMED_OUT");
    channel.emitStatus("SUBSCRIBED");
    expect(refreshGroup).toHaveBeenCalledTimes(1);
    expect(refreshGroup).toHaveBeenCalledWith("group-1");

    channel.emitStatus("CHANNEL_ERROR");
    channel.emitStatus("SUBSCRIBED");
    expect(refreshGroup).toHaveBeenCalledTimes(2);
  });

  it("refreshes memberships when the user channel recovers after a drop", () => {
    useAppStore.setState({ me: meUser });
    stop = startRealtime();
    const channel = userChannel(meUser.id);

    channel.emitStatus("SUBSCRIBED");
    expect(runBootstrap).not.toHaveBeenCalled();

    channel.emitStatus("CLOSED");
    channel.emitStatus("SUBSCRIBED");
    expect(runBootstrap).toHaveBeenCalledTimes(1);
  });
});
