import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAppStore } from "@/stores/app-store";
import type { Database } from "@/types/database";
import type { ChatMessage, GroupMember, GroupSnapshot, Me } from "@/types/ledger";
import { catchUpBootstrap } from "./bootstrap";
import type * as BootstrapModule from "./bootstrap";
import {
  invalidateChatReconciliation,
  reconcileChat,
} from "./chat-reconcile";
import { getSupabase, rpc } from "./client";
import {
  mergeChatBroadcast,
  parseMembershipPayload,
  shouldRefreshGroup,
  startRealtime,
  subscribeChat,
} from "./realtime";
import { refreshGroup, refreshMyOpenAssignmentRooms } from "./refresh";
const authState = vi.hoisted(() => ({ generation: 0 }));
vi.mock("./client", () => ({
  getSupabase: vi.fn(),
  rpc: vi.fn(),
  getAuthGeneration: () => authState.generation,
}));
vi.mock("./refresh", () => ({
  loadConversation: vi.fn(async () => null),
  refreshGroup: vi.fn(async () => {}),
  refreshMyOpenAssignmentRooms: vi.fn(async () => {}),
  refreshHostedAssignmentRooms: vi.fn(async () => {}),
}));
vi.mock("./bootstrap", async (importOriginal) => {
  const actual = await importOriginal<typeof BootstrapModule>();
  return { ...actual, catchUpBootstrap: vi.fn(actual.catchUpBootstrap) };
});
vi.mock("./chat-reconcile", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    reconcileChat: vi.fn(),
    invalidateChatReconciliation: vi.fn(),
  };
});

const rpcMock = vi.mocked(rpc);

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

const bootstrapResponse = {
  me: meUser,
  groups: [],
  serverTime: "2026-09-26T12:00:00.000Z",
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
  archivedAt: null,
  financialHistorySharedAt: null,
  formerMembers: [],
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

  afterEach(async () => {
    stop?.();
    stop = null;
    await Promise.resolve();
    await Promise.resolve();
  });

  beforeEach(async () => {
    await catchUpBootstrap().catch(() => {});
    vi.clearAllMocks();
    createdChannels = [];
    removedChannels = [];
    authState.generation = 0;
    useAppStore.getState().reset();
    rpcMock.mockResolvedValue(bootstrapResponse as never);

    const fakeSupabase = {
      channel: (topic: string, config?: unknown) => {
        const channel = new FakeChannel(topic, config);
        createdChannels.push(channel);
        return channel;
      },
      removeChannel: (channel: FakeChannel) => {
        removedChannels.push(channel);
        channel.emitStatus("CLOSED");
        return Promise.resolve("ok");
      },
    };
    vi.mocked(getSupabase).mockImplementation(
      () => fakeSupabase as unknown as SupabaseClient<Database>,
    );
  });

  function groupChannel(groupId: string): FakeChannel {
    const channel = createdChannels.find((c) => c.topic === `group:${groupId}`);
    if (!channel) throw new Error(`group channel ${groupId} not opened`);
    return channel;
  }

  function userChannel(userId: string): FakeChannel {
    const channel = createdChannels.find((c) => c.topic === `user:${userId}`);
    if (!channel) throw new Error(`user channel for ${userId} not opened`);
    return channel;
  }

  function bootstrapReads(): number {
    return rpcMock.mock.calls.filter(([name]) => name === "bootstrap_overview_v2").length;
  }

  it("opens the user channel with the membership event once me exists", () => {
    useAppStore.setState({ me: meUser });
    stop = startRealtime();

    const channel = userChannel(meUser.id);
    expect(channel.config).toEqual({ config: { private: true } });
    expect(channel.subscribed).toBe(true);
    expect(channel.listeners.has("membership")).toBe(true);
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

  it("reads bootstrap once for a valid membership broadcast", () => {
    useAppStore.setState({ me: meUser });
    stop = startRealtime();

    userChannel(meUser.id).emit("membership", { group_id: "group-9" });

    expect(bootstrapReads()).toBe(1);
  });

  it("ignores malformed membership broadcasts", () => {
    useAppStore.setState({ me: meUser });
    stop = startRealtime();
    const channel = userChannel(meUser.id);

    channel.emit("membership", { ledger_version: 3 });
    channel.emit("membership", "group-9");
    channel.emit("membership", null);

    expect(bootstrapReads()).toBe(0);
  });

  it("catches up a first join through its pass and refreshes a group once per recovery", () => {
    useAppStore.setState({ me: meUser, groupOrder: ["group-1"] });
    stop = startRealtime();
    const channel = createdChannels.find((c) => c.topic === "group:group-1");
    if (!channel) throw new Error("group channel not opened");

    channel.emitStatus("SUBSCRIBED");
    expect(refreshGroup).not.toHaveBeenCalled();
    expect(bootstrapReads()).toBe(0);

    userChannel(meUser.id).emitStatus("SUBSCRIBED");
    expect(bootstrapReads()).toBe(1);
    expect(refreshGroup).not.toHaveBeenCalled();

    channel.emitStatus("SUBSCRIBED");
    expect(refreshGroup).not.toHaveBeenCalled();
    expect(bootstrapReads()).toBe(1);

    channel.emitStatus("CHANNEL_ERROR");
    channel.emitStatus("TIMED_OUT");
    channel.emitStatus("SUBSCRIBED");
    expect(refreshGroup).toHaveBeenCalledTimes(1);
    expect(refreshGroup).toHaveBeenCalledWith("group-1");
    expect(bootstrapReads()).toBe(1);

    channel.emitStatus("CHANNEL_ERROR");
    channel.emitStatus("SUBSCRIBED");
    expect(refreshGroup).toHaveBeenCalledTimes(2);
  });

  it("refreshes a group whose first join failed once it later subscribes", () => {
    useAppStore.setState({ groupOrder: ["group-error", "group-timeout"] });
    stop = startRealtime();
    const failed = groupChannel("group-error");
    const timedOut = groupChannel("group-timeout");

    failed.emitStatus("CHANNEL_ERROR");
    timedOut.emitStatus("TIMED_OUT");
    expect(bootstrapReads()).toBe(0);
    expect(refreshGroup).not.toHaveBeenCalled();

    failed.emitStatus("SUBSCRIBED");
    timedOut.emitStatus("SUBSCRIBED");

    expect(refreshGroup).toHaveBeenCalledTimes(2);
    expect(refreshGroup).toHaveBeenNthCalledWith(1, "group-error");
    expect(refreshGroup).toHaveBeenNthCalledWith(2, "group-timeout");
  });

  it("catches up again for a group channel added after startup", () => {
    useAppStore.setState({ groupOrder: ["group-1"] });
    stop = startRealtime();
    groupChannel("group-1").emitStatus("SUBSCRIBED");
    expect(refreshGroup).toHaveBeenCalledExactlyOnceWith("group-1");
    expect(bootstrapReads()).toBe(0);

    useAppStore.setState({ groupOrder: ["group-1", "group-2"] });
    groupChannel("group-2").emitStatus("SUBSCRIBED");

    expect(refreshGroup).toHaveBeenLastCalledWith("group-2");
    expect(refreshGroup).toHaveBeenCalledTimes(2);
    expect(bootstrapReads()).toBe(0);
  });

  it("catches up once for several groups joining in one pass", () => {
    useAppStore.setState({ groupOrder: ["group-1", "group-2", "group-3"] });
    stop = startRealtime();

    groupChannel("group-1").emitStatus("SUBSCRIBED");
    groupChannel("group-2").emitStatus("SUBSCRIBED");
    expect(bootstrapReads()).toBe(0);
    expect(refreshGroup).not.toHaveBeenCalled();

    groupChannel("group-3").emitStatus("SUBSCRIBED");

    expect(bootstrapReads()).toBe(1);
    expect(refreshGroup).not.toHaveBeenCalled();
  });

  it("catches up once for the user channel plus groups in one pass", () => {
    useAppStore.setState({ me: meUser, groupOrder: ["group-1", "group-2"] });
    stop = startRealtime();

    groupChannel("group-1").emitStatus("SUBSCRIBED");
    userChannel(meUser.id).emitStatus("SUBSCRIBED");
    expect(bootstrapReads()).toBe(0);
    expect(refreshGroup).not.toHaveBeenCalled();

    groupChannel("group-2").emitStatus("SUBSCRIBED");

    expect(bootstrapReads()).toBe(1);
    expect(refreshGroup).not.toHaveBeenCalled();
  });

  it("drops a group removed while pending and flushes the rest of its pass", () => {
    useAppStore.setState({ groupOrder: ["group-1", "group-2"] });
    stop = startRealtime();
    const removed = groupChannel("group-1");

    useAppStore.setState({ groupOrder: ["group-2"] });

    expect(removedChannels).toContain(removed);
    expect(bootstrapReads()).toBe(0);
    expect(refreshGroup).not.toHaveBeenCalled();

    groupChannel("group-2").emitStatus("SUBSCRIBED");

    expect(refreshGroup).toHaveBeenCalledExactlyOnceWith("group-2");
    expect(bootstrapReads()).toBe(0);
  });

  it("does not catch up a group that joined and was removed before its pass flushed", () => {
    useAppStore.setState({ groupOrder: ["group-1", "group-2"] });
    stop = startRealtime();

    groupChannel("group-1").emitStatus("SUBSCRIBED");
    useAppStore.setState({ groupOrder: ["group-2"] });
    groupChannel("group-2").emitStatus("SUBSCRIBED");

    expect(refreshGroup).toHaveBeenCalledExactlyOnceWith("group-2");
    expect(bootstrapReads()).toBe(0);
  });

  it("flushes a later pass independently while an earlier pass is pending", () => {
    useAppStore.setState({ groupOrder: ["group-1"] });
    stop = startRealtime();

    useAppStore.setState({ groupOrder: ["group-1", "group-2"] });
    groupChannel("group-2").emitStatus("SUBSCRIBED");
    expect(refreshGroup).toHaveBeenCalledExactlyOnceWith("group-2");
    expect(bootstrapReads()).toBe(0);

    groupChannel("group-1").emitStatus("SUBSCRIBED");

    expect(refreshGroup).toHaveBeenLastCalledWith("group-1");
    expect(refreshGroup).toHaveBeenCalledTimes(2);
    expect(bootstrapReads()).toBe(0);
  });

  it("subscribes a fresh channel for a group removed and re-added", () => {
    useAppStore.setState({ groupOrder: ["group-1"] });
    stop = startRealtime();
    const original = groupChannel("group-1");
    original.emitStatus("SUBSCRIBED");
    expect(refreshGroup).toHaveBeenCalledExactlyOnceWith("group-1");

    useAppStore.setState({ groupOrder: [] });
    useAppStore.setState({ groupOrder: ["group-1"] });

    expect(removedChannels).toEqual([original]);
    const fresh = createdChannels[1];
    if (!fresh) throw new Error("re-added group channel not opened");
    expect(fresh.topic).toBe("group:group-1");
    expect(fresh.subscribed).toBe(true);

    fresh.emitStatus("SUBSCRIBED");
    expect(refreshGroup).toHaveBeenCalledTimes(2);

    fresh.emit("ledger", { group_id: "group-1", ledger_version: 6, event_id: 21 });
    expect(refreshGroup).toHaveBeenCalledTimes(3);
  });

  it("ignores channel statuses after the signed-in account changed", () => {
    useAppStore.setState({ me: meUser, groupOrder: ["group-1"] });
    stop = startRealtime();
    authState.generation = 1;
    const channel = groupChannel("group-1");

    channel.emitStatus("SUBSCRIBED");
    channel.emitStatus("CHANNEL_ERROR");
    channel.emitStatus("SUBSCRIBED");

    expect(bootstrapReads()).toBe(0);
    expect(refreshGroup).not.toHaveBeenCalled();
  });

  it("removes the user channel on cleanup", () => {
    useAppStore.setState({ me: meUser });
    stop = startRealtime();
    const channel = userChannel(meUser.id);

    stop();

    expect(removedChannels).toStrictEqual([channel]);
  });

  it("catches up when the user channel recovers after a drop", () => {
    useAppStore.setState({ me: meUser });
    stop = startRealtime();
    const channel = userChannel(meUser.id);

    channel.emitStatus("CHANNEL_ERROR");
    expect(bootstrapReads()).toBe(0);

    channel.emitStatus("SUBSCRIBED");

    expect(bootstrapReads()).toBe(1);
    expect(refreshGroup).not.toHaveBeenCalled();
  });

  describe("private user topic content", () => {
    const roomSummary = {
      id: "00000000-0000-4000-8000-000000000021",
      groupId: "group-1",
      status: "open",
      revision: 4,
      title: "Bar do Zé",
      occurredOn: "2026-09-25",
      totalCents: 18260,
      host: { id: "00000000-0000-4000-8000-000000000022", handle: "bruno", name: "Bruno", avatarUrl: null, isBot: false },
      createdAt: "2026-09-25T20:00:00.000Z",
      itemCount: 3,
      ownedItemCount: 1,
      claimers: [
        { participantId: "00000000-0000-4000-8000-000000000023", userId: null, name: "Ana", avatarUrl: null },
      ],
      expenseId: null,
    };

    function chatPayload(overrides: { groupId?: string; message?: unknown } = {}): Record<string, unknown> {
      return {
        group_id: overrides.groupId ?? incomingMessage.groupId,
        message: overrides.message ?? incomingMessage,
        id: "transport-1",
      };
    }

    let chatSubscriptions: Array<() => void> = [];

    afterEach(() => {
      for (const unsubscribe of chatSubscriptions) unsubscribe();
      chatSubscriptions = [];
    });

    function member(
      groupId: string,
      user: typeof meUser,
      status: GroupMember["status"],
    ): GroupMember {
      return {
        groupId,
        userId: user.id,
        status,
        invitedBy: null,
        acceptedAt: null,
        user,
      };
    }

    function snapshotWith(
      groupId: string,
      members: GroupMember[],
    ): GroupSnapshot {
      return {
        ...baseSnapshot,
        group: { ...baseSnapshot.group, id: groupId },
        members,
      };
    }

    function openChat(groupId: string): void {
      chatSubscriptions.push(subscribeChat(groupId));
    }

    function joinUserTopic(): void {
      userChannel(meUser.id).emitStatus("SUBSCRIBED");
    }

    function seedConversation(
      status: "loading" | "error",
      readableThroughMessageId: string | null,
    ): void {
      useAppStore.setState({
        conversations: {
          "group-1": {
            messages: [],
            events: [],
            messageCursor: null,
            messagesComplete: true,
            eventCursor: null,
            eventsComplete: true,
            readWatermark: null,
            reconcile: { status, readableThroughMessageId },
          },
        },
      });
    }

    function seedGroup(): void {
      useAppStore.setState({
        me: meUser,
        groupOrder: ["group-1"],
        groups: { "group-1": baseSnapshot },
      });
      stop = startRealtime();
    }

    it("patches the conversation from a user-topic chat message", () => {
      seedGroup();
      openChat("group-1");
      expect(reconcileChat).toHaveBeenCalledExactlyOnceWith("group-1");
      joinUserTopic();
      expect(reconcileChat).toHaveBeenCalledTimes(2);
      expect(reconcileChat).toHaveBeenLastCalledWith("group-1");

      userChannel(meUser.id).emit("message", chatPayload());

      const state = useAppStore.getState();
      expect(state.conversations["group-1"]?.messages).toEqual([incomingMessage]);
      expect(state.groups["group-1"]?.unreadCount).toBe(1);
      expect(state.groups["group-1"]?.lastMessage).toEqual({
        content: "E aí pessoal!",
        erased: false,
        senderId: "user-2",
        createdAt: "2026-09-05T12:00:00.000Z",
        sender: incomingMessage.sender,
      });
      expect(refreshGroup).not.toHaveBeenCalled();
      expect(reconcileChat).toHaveBeenCalledTimes(2);
    });

    it("merges a repeated message once", () => {
      seedGroup();
      openChat("group-1");
      joinUserTopic();
      const channel = userChannel(meUser.id);

      channel.emit("message", chatPayload());
      channel.emit("message", chatPayload());

      const state = useAppStore.getState();
      expect(state.conversations["group-1"]?.messages).toHaveLength(1);
      expect(state.groups["group-1"]?.unreadCount).toBe(1);
    });

    it("does not reconcile an out-of-window erasure broadcast", () => {
      seedGroup();
      openChat("group-1");
      joinUserTopic();
      useAppStore.setState({
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

      userChannel(meUser.id).emit(
        "message",
        chatPayload({
          message: {
            ...incomingMessage,
            id: "m-1",
            clientId: "c-1",
            content: null,
            erased: true,
            createdAt: "2026-09-04T12:00:00.000Z",
          },
        }),
      );

      expect(reconcileChat).toHaveBeenCalledTimes(2);
    });

    it("does not merge a user-topic message for a chat without an active subscription", () => {
      seedGroup();
      joinUserTopic();
      vi.mocked(refreshMyOpenAssignmentRooms).mockClear();
      const channel = userChannel(meUser.id);

      channel.emit("message", chatPayload());

      const state = useAppStore.getState();
      expect(state.conversations).toEqual({});
      expect(state.groups["group-1"]?.unreadCount).toBe(0);
      expect(state.groups["group-1"]?.lastMessage).toBeNull();
      expect(refreshGroup).not.toHaveBeenCalled();
      expect(refreshMyOpenAssignmentRooms).not.toHaveBeenCalled();
      expect(reconcileChat).not.toHaveBeenCalled();
    });

    it("holds a live row while a head catch-up is in flight and marks the run dirty", () => {
      seedGroup();
      openChat("group-1");
      joinUserTopic();
      seedConversation("loading", "msg-99");
      vi.mocked(reconcileChat).mockClear();

      userChannel(meUser.id).emit("message", chatPayload());

      const conversation = useAppStore.getState().conversations["group-1"];
      expect(conversation?.messages).toEqual([]);
      expect(conversation?.reconcile.status).toBe("loading");
      expect(conversation?.reconcile.readableThroughMessageId).toBe("msg-99");
      expect(conversation?.messagesComplete).toBe(true);
      expect(reconcileChat).toHaveBeenCalledExactlyOnceWith("group-1");
    });

    it("holds a live row while a failed catch-up left an error status", () => {
      seedGroup();
      openChat("group-1");
      joinUserTopic();
      seedConversation("error", null);
      vi.mocked(reconcileChat).mockClear();

      userChannel(meUser.id).emit("message", chatPayload());

      const conversation = useAppStore.getState().conversations["group-1"];
      expect(conversation?.messages).toEqual([]);
      expect(conversation?.reconcile.status).toBe("error");
      expect(reconcileChat).toHaveBeenCalledExactlyOnceWith("group-1");
    });

    it("drops malformed payloads and messages for groups not in state", () => {
      seedGroup();
      openChat("group-1");
      joinUserTopic();
      const channel = userChannel(meUser.id);

      channel.emit("message", null);
      channel.emit("message", { group_id: "group-1" });
      channel.emit("message", { ...chatPayload(), extra: true });
      channel.emit("message", chatPayload({ message: { ...incomingMessage, content: 42 } }));
      channel.emit("message", chatPayload({ groupId: "group-unknown" }));

      const state = useAppStore.getState();
      expect(state.conversations).toEqual({});
      expect(state.groups["group-1"]?.unreadCount).toBe(0);
      expect(refreshGroup).not.toHaveBeenCalled();
    });

    it("patches the store from a user-topic room summary, tolerating the transport id", () => {
      seedGroup();

      userChannel(meUser.id).emit("assignment_room", { room: roomSummary, id: "transport-1" });

      expect(useAppStore.getState().assignmentRoomSummaries[roomSummary.id]).toEqual(roomSummary);
      expect(refreshGroup).not.toHaveBeenCalled();
      expect(refreshMyOpenAssignmentRooms).not.toHaveBeenCalled();
    });

    it("drops malformed room payloads and summaries for groups not in state", () => {
      seedGroup();
      const channel = userChannel(meUser.id);

      channel.emit("assignment_room", { room: { ...roomSummary, revision: "4" } });
      channel.emit("assignment_room", { room: roomSummary, extra: true });
      channel.emit("assignment_room", { room: { ...roomSummary, groupId: "group-2" } });
      channel.emit("assignment_room", null);

      expect(useAppStore.getState().assignmentRoomSummaries).toEqual({});
    });

    it("ignores user-topic content once the signed-in account changed", () => {
      seedGroup();
      openChat("group-1");
      joinUserTopic();
      const channel = userChannel(meUser.id);

      authState.generation = 1;
      channel.emit("message", chatPayload());
      channel.emit("assignment_room", { room: roomSummary });

      expect(useAppStore.getState().conversations).toEqual({});
      expect(useAppStore.getState().assignmentRoomSummaries).toEqual({});
    });

    it("refreshes group previews for a closed chat through chat_activity only", () => {
      seedGroup();
      joinUserTopic();
      const channel = groupChannel("group-1");

      channel.emit("chat_activity", { group_id: "group-1" });

      expect(refreshGroup).toHaveBeenCalledExactlyOnceWith("group-1");
      expect(useAppStore.getState().conversations).toEqual({});
    });

    function seedAcceptedGroup(): void {
      useAppStore.setState({
        me: meUser,
        groupOrder: ["group-1"],
        groups: {
          "group-1": snapshotWith("group-1", [
            member("group-1", meUser, "accepted"),
          ]),
        },
      });
      stop = startRealtime();
    }

    it("reconciles active chats and refreshes rooms once per user-topic recovery", () => {
      seedAcceptedGroup();
      openChat("group-1");
      expect(reconcileChat).toHaveBeenCalledTimes(1);
      const channel = userChannel(meUser.id);
      // The pass settle may fire a bootstrap, whose own rooms refresh is not
      // this test's subject.
      vi.mocked(catchUpBootstrap).mockImplementation(async () => {});

      channel.emitStatus("SUBSCRIBED");
      expect(reconcileChat).toHaveBeenCalledTimes(2);
      expect(refreshMyOpenAssignmentRooms).toHaveBeenCalledTimes(1);

      channel.emitStatus("SUBSCRIBED");
      expect(reconcileChat).toHaveBeenCalledTimes(2);
      expect(refreshMyOpenAssignmentRooms).toHaveBeenCalledTimes(1);

      channel.emitStatus("CHANNEL_ERROR");
      channel.emitStatus("SUBSCRIBED");
      expect(reconcileChat).toHaveBeenCalledTimes(3);
      expect(reconcileChat).toHaveBeenLastCalledWith("group-1");
      expect(refreshMyOpenAssignmentRooms).toHaveBeenCalledTimes(2);
      expect(refreshMyOpenAssignmentRooms).toHaveBeenLastCalledWith();
    });

    it("invalidates reconciliation only when the final subscriber closes", () => {
      seedGroup();
      const first = subscribeChat("group-1");
      const second = subscribeChat("group-1");

      first();
      expect(invalidateChatReconciliation).not.toHaveBeenCalled();

      second();
      expect(invalidateChatReconciliation).toHaveBeenCalledExactlyOnceWith("group-1");
    });
  });
});
