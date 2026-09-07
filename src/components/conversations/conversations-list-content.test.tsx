import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationsListContent } from "./conversations-list-content";
import { useAppStore } from "@/stores/app-store";
import type { GroupSnapshot, Me } from "@/types/ledger";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [k: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/conversations/new-conversation-button", () => ({
  NewConversationButton: () => <div data-testid="new-conv-button" />,
}));

vi.mock("@/components/conversations/conversation-share-modal", () => ({
  ConversationShareModal: () => null,
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

function makeDmSnapshot(overrides: Partial<GroupSnapshot> = {}): GroupSnapshot {
  return {
    group: {
      id: "dm-1",
      kind: "dm",
      name: "Carol Souza",
      creatorId: me.id,
      dmUserA: me.id,
      dmUserB: carol.id,
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
    },
    members: [
      { groupId: "dm-1", userId: me.id, status: "accepted", invitedBy: null, acceptedAt: null, user: me },
      { groupId: "dm-1", userId: carol.id, status: "accepted", invitedBy: null, acceptedAt: null, user: carol },
    ],
    balances: [],
    guests: [],
    settlements: [],
    recentExpenses: [],
    lastEventId: 0,
    unreadCount: 2,
    lastMessage: { content: "Tudo certo?", senderId: carol.id, createdAt: "2026-01-01T10:00:00Z" },
    lastActivityAt: "2026-01-01T10:00:00Z",
    ...overrides,
  };
}

function makeGroupSnapshot(overrides: Partial<GroupSnapshot> = {}): GroupSnapshot {
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
      { groupId: "group-1", userId: me.id, status: "accepted", invitedBy: null, acceptedAt: null, user: me },
    ],
    balances: [],
    guests: [],
    settlements: [],
    recentExpenses: [],
    lastEventId: 0,
    unreadCount: 0,
    lastMessage: { content: "Comprei o carvão", senderId: me.id, createdAt: "2026-01-01T09:00:00Z" },
    lastActivityAt: "2026-01-01T09:00:00Z",
    ...overrides,
  };
}

describe("ConversationsListContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders DM rows with counterparty info and unread badge", () => {
    const dm = makeDmSnapshot({ unreadCount: 5 });
    useAppStore.setState({
      hydrated: true,
      me,
      groups: { [dm.group.id]: dm },
      groupOrder: [dm.group.id],
    });

    render(<ConversationsListContent />);

    expect(screen.getByText("Carol Souza")).toBeDefined();
    expect(screen.getByText("Tudo certo?")).toBeDefined();
    expect(screen.getByTestId("unread-badge").textContent).toBe("5");

    const rowLink = screen.getByTestId("conversation-row-dm");
    expect(rowLink.getAttribute("href")).toBe(`/app/conversations/${carol.id}`);
  });

  it("renders an invitation row for a DM where I am the invitee", () => {
    const dm = makeDmSnapshot({
      group: {
        id: "dm-1",
        kind: "dm",
        name: "Carol Souza",
        creatorId: carol.id,
        dmUserA: carol.id,
        dmUserB: me.id,
        ledgerVersion: 1,
        createdAt: "2026-01-01T00:00:00Z",
      },
      members: [
        { groupId: "dm-1", userId: me.id, status: "invited", invitedBy: carol.id, acceptedAt: null, user: me },
        { groupId: "dm-1", userId: carol.id, status: "accepted", invitedBy: null, acceptedAt: "2026-01-01T00:00:00Z", user: carol },
      ],
      unreadCount: 0,
      lastMessage: null,
    });
    useAppStore.setState({
      hydrated: true,
      me,
      groups: { [dm.group.id]: dm },
      groupOrder: [dm.group.id],
    });

    render(<ConversationsListContent />);

    expect(screen.getByText("Carol Souza")).toBeDefined();
    expect(screen.getByText("Convite para conversar")).toBeDefined();
    expect(screen.queryByText("Sem mensagens")).toBeNull();
    expect(screen.queryByTestId("unread-badge")).toBeNull();

    const rowLink = screen.getByTestId("conversation-row-dm");
    expect(rowLink.getAttribute("href")).toBe(`/app/conversations/${carol.id}`);
  });

  it("renders an awaiting label for a DM whose counterparty has not accepted", () => {
    const dm = makeDmSnapshot({
      members: [
        { groupId: "dm-1", userId: me.id, status: "accepted", invitedBy: null, acceptedAt: "2026-01-01T00:00:00Z", user: me },
        { groupId: "dm-1", userId: carol.id, status: "invited", invitedBy: me.id, acceptedAt: null, user: carol },
      ],
      unreadCount: 0,
      lastMessage: null,
    });
    useAppStore.setState({
      hydrated: true,
      me,
      groups: { [dm.group.id]: dm },
      groupOrder: [dm.group.id],
    });

    render(<ConversationsListContent />);

    expect(screen.getByText("Carol Souza")).toBeDefined();
    expect(screen.getByText("Aguardando aceitar o convite")).toBeDefined();
    expect(screen.queryByText("Sem mensagens")).toBeNull();
    expect(screen.queryByTestId("unread-badge")).toBeNull();

    const rowLink = screen.getByTestId("conversation-row-dm");
    expect(rowLink.getAttribute("href")).toBe(`/app/conversations/${carol.id}`);
  });

  it("renders group rows when they have messages, and ignores groups without messages", () => {
    const groupWithMsg = makeGroupSnapshot({
      group: {
        id: "g-active",
        kind: "group",
        name: "Churrasco",
        creatorId: me.id,
        dmUserA: null,
        dmUserB: null,
        ledgerVersion: 1,
        createdAt: "2026-01-01T00:00:00Z",
      },
      lastMessage: { content: "Comprei o carvão", senderId: me.id, createdAt: "2026-01-01T09:00:00Z" },
    });
    const groupEmpty = makeGroupSnapshot({
      group: {
        id: "g-empty",
        kind: "group",
        name: "Viagem",
        creatorId: me.id,
        dmUserA: null,
        dmUserB: null,
        ledgerVersion: 1,
        createdAt: "2026-01-01T00:00:00Z",
      },
      lastMessage: null,
    });

    useAppStore.setState({
      hydrated: true,
      me,
      groups: {
        [groupWithMsg.group.id]: groupWithMsg,
        [groupEmpty.group.id]: groupEmpty,
      },
      groupOrder: [groupWithMsg.group.id, groupEmpty.group.id],
    });

    render(<ConversationsListContent />);

    expect(screen.getByText("Churrasco")).toBeDefined();
    expect(screen.getByText("Comprei o carvão")).toBeDefined();
    expect(screen.queryByText("Viagem")).toBeNull();

    const rowLink = screen.getByTestId("conversation-row-group");
    expect(rowLink.getAttribute("href")).toBe("/app/groups/g-active");
  });
});
