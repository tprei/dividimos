import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "@/stores/app-store";
import type { ChatMessage, GroupSnapshot, Me } from "@/types/ledger";
import { mergeChatBroadcast, shouldRefreshGroup } from "./realtime";

const meUser: Me = {
  id: "user-1",
  handle: "user1",
  name: "User One",
  avatarUrl: null,
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
  members: [],
  balances: [],
  pendingSettlements: [],
  recentExpenses: [],
  lastEventId: 20,
  unreadCount: 0,
  lastMessage: null,
  lastActivityAt: "2026-09-01T10:00:00.000Z",
};

const incomingMessage: ChatMessage = {
  id: "msg-101",
  clientId: "client-uuid-101",
  groupId: "group-1",
  senderId: "user-2",
  content: "E aí pessoal!",
  createdAt: "2026-09-05T12:00:00.000Z",
  sender: {
    id: "user-2",
    handle: "user2",
    name: "User Two",
    avatarUrl: null,
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
      senderId: "user-2",
      createdAt: "2026-09-05T12:00:00.000Z",
    });
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
          oldestCursor: null,
        },
      },
    });

    const patch = mergeChatBroadcast(
      useAppStore.getState(),
      "group-1",
      incomingMessage,
    );

    expect(patch.conversations).toBeUndefined();
    expect(patch.groups?.["group-1"]?.unreadCount).toBe(3);
    expect(patch.groups?.["group-1"]?.lastMessage?.content).toBe(
      "E aí pessoal!",
    );
  });

  it("dedupes message by id", () => {
    useAppStore.setState({
      me: meUser,
      groups: { "group-1": { ...baseSnapshot, unreadCount: 2 } },
      conversations: {
        "group-1": {
          messages: [incomingMessage],
          events: [],
          oldestCursor: null,
        },
      },
    });

    const patch = mergeChatBroadcast(
      useAppStore.getState(),
      "group-1",
      incomingMessage,
    );

    expect(patch.conversations).toBeUndefined();
    expect(patch.groups?.["group-1"]?.unreadCount).toBe(2);
  });
});
