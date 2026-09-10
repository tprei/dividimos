import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GroupChatClient } from "./group-chat-client";
import { useAppStore } from "@/stores/app-store";
import type { ChatMessage, GroupSnapshot, Me } from "@/types/ledger";

const mutations = vi.hoisted(() => ({
  sendMessage: vi.fn().mockResolvedValue({ id: "message-ack" }),
  markRead: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/sync/mutations", () => mutations);

const refresh = vi.hoisted(() => ({
  loadConversation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/sync/refresh", () => refresh);

const realtime = vi.hoisted(() => ({
  subscribeChat: vi.fn(() => vi.fn()),
}));
vi.mock("@/lib/sync/realtime", () => realtime);

vi.mock("react-hot-toast", () => ({
  default: { error: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn() }),
  useParams: () => ({ id: "group-1" }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
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

const carol = {
  id: "user-carol",
  handle: "carol",
  name: "Carol Souza",
  avatarUrl: null,
};

function makeSnapshot(overrides: Partial<GroupSnapshot> = {}): GroupSnapshot {
  return {
    group: {
      id: "group-1",
      kind: "group",
      name: "Churrasco",
      creatorId: me.id,
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
    },
    members: [
      {
        groupId: "group-1",
        userId: me.id,
        status: "accepted",
        invitedBy: null,
        acceptedAt: null,
        user: me,
      },
      {
        groupId: "group-1",
        userId: carol.id,
        status: "accepted",
        invitedBy: null,
        acceptedAt: null,
        user: carol,
      },
    ],
    balances: [],
    guests: [],
    settlements: [],
    recentExpenses: [],
    lastEventId: 0,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-01T00:00:00Z",
    expenseCount: 0,
    pairwiseEdges: [],
    ...overrides,
  };
}

function seed(
  snapshot: GroupSnapshot,
  messages: ChatMessage[] = [],
): void {
  useAppStore.setState({
    hydrated: true,
    me,
    groups: { [snapshot.group.id]: snapshot },
    groupOrder: [snapshot.group.id],
    conversations: {
      [snapshot.group.id]: {
        messages,
        events: [],
        messageCursor: null,
        messagesComplete: true,
        eventCursor: null,
        eventsComplete: true,
        readWatermark: null,
        reconcile: { status: "idle", readableThroughMessageId: null },
      },
    },
  });
}

describe("GroupChatClient", () => {
  beforeEach(() => {
    useAppStore.getState().reset();
    vi.clearAllMocks();
  });

  it("renders the group timeline and identity", () => {
    const message: ChatMessage = {
      id: "message-1",
      clientId: "client-1",
      groupId: "group-1",
      senderId: carol.id,
      content: "Levo o carvão",
      createdAt: "2026-01-01T10:00:00Z",
      sender: carol,
    };
    seed(makeSnapshot(), [message]);

    render(<GroupChatClient groupId="group-1" />);

    expect(screen.getByText("Churrasco")).toBeDefined();
    expect(screen.getByText("Levo o carvão")).toBeDefined();
    expect(screen.getByText("2 membros")).toBeDefined();
    expect(screen.getByRole("link", { name: "Ver grupo" }).getAttribute("href")).toBe(
      "/app/groups/group-1",
    );
  });

  it("sends a message through the group mutation", async () => {
    seed(makeSnapshot());

    render(<GroupChatClient groupId="group-1" />);

    const input = screen.getByPlaceholderText("Mensagem...");
    fireEvent.change(input, { target: { value: "Olá grupo!" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" }));

    await waitFor(() => {
      expect(mutations.sendMessage).toHaveBeenCalledWith("group-1", "Olá grupo!");
    });
  });

  it("acknowledges the newest incoming message when an unread group opens", async () => {
    const older: ChatMessage = {
      id: "message-1",
      clientId: "client-1",
      groupId: "group-1",
      senderId: carol.id,
      content: "Primeira",
      createdAt: "2026-01-01T10:00:00Z",
      sender: carol,
    };
    const newest: ChatMessage = {
      ...older,
      id: "message-2",
      clientId: "client-2",
      content: "Segunda",
      createdAt: "2026-01-01T11:00:00Z",
    };
    seed(makeSnapshot({ unreadCount: 4 }), [older, newest]);

    render(<GroupChatClient groupId="group-1" />);

    await waitFor(() => {
      // A watermark, not a wall-clock read: the receipt names the message.
      expect(mutations.markRead).toHaveBeenCalledWith("group-1", "message-2");
    });
  });

  it("acknowledges nothing when the group holds no incoming message", async () => {
    seed(makeSnapshot({ unreadCount: 4 }));

    render(<GroupChatClient groupId="group-1" />);

    // Give the read effect a chance to run before asserting it did not.
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Ver grupo" })).toBeInTheDocument();
    });
    expect(mutations.markRead).not.toHaveBeenCalled();
  });
});
