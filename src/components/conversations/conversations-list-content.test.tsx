import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationsListContent } from "./conversations-list-content";
import { useAppStore } from "@/stores/app-store";
import type { GroupSnapshot, Me, UserProfile } from "@/types/ledger";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
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
const realtime = vi.hoisted(() => ({
  subscribeChat: vi.fn(() => vi.fn()),
}));
vi.mock("@/lib/sync/realtime", () => realtime);

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

const carol: UserProfile = {
  id: "user-carol",
  handle: "carol",
  name: "Carol Souza",
  avatarUrl: null,
};

const bob: UserProfile = {
  id: "user-bob",
  handle: "bob",
  name: "Bob Silva",
  avatarUrl: null,
};

function makeDmSnapshot(
  counterparty: UserProfile = carol,
  overrides: Partial<GroupSnapshot> = {},
): GroupSnapshot {
  return {
    group: {
      id: "dm-1",
      kind: "dm",
      name: counterparty.name,
      creatorId: me.id,
      dmUserA: me.id,
      dmUserB: counterparty.id,
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
    },
    members: [
      {
        groupId: "dm-1",
        userId: me.id,
        status: "accepted",
        invitedBy: null,
        acceptedAt: null,
        user: me,
      },
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
    lastEventId: 0,
    unreadCount: 2,
    lastMessage: {
      content: "Tudo certo?",
      senderId: counterparty.id,
      createdAt: "2026-01-01T10:00:00Z",
    },
    lastActivityAt: "2026-01-01T10:00:00Z",
    pairwiseEdges: [],
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
      {
        groupId: "group-1",
        userId: me.id,
        status: "accepted",
        invitedBy: null,
        acceptedAt: null,
        user: me,
      },
    ],
    balances: [],
    guests: [],
    settlements: [],
    recentExpenses: [],
    expenseCount: 0,
    lastEventId: 0,
    unreadCount: 0,
    lastMessage: {
      content: "Comprei o carvão",
      senderId: me.id,
      createdAt: "2026-01-01T09:00:00Z",
    },
    lastActivityAt: "2026-01-01T09:00:00Z",
    pairwiseEdges: [],
    ...overrides,
  };
}

function seedGroups(snapshots: GroupSnapshot[]) {
  useAppStore.setState({
    hydrated: true,
    me,
    groups: Object.fromEntries(snapshots.map((snapshot) => [snapshot.group.id, snapshot])),
    groupOrder: snapshots.map((snapshot) => snapshot.group.id),
  });
}

describe("ConversationsListContent", () => {
  beforeEach(() => {
    useAppStore.getState().reset();
    vi.clearAllMocks();
  });

  it("renders DM rows with counterparty info, unread badge, and balance", () => {
    const dm = makeDmSnapshot(carol, {
      unreadCount: 5,
      balances: [
        { kind: "user", participantId: me.id, netCents: -1200 },
        { kind: "user", participantId: carol.id, netCents: 1200 },
      ],
    });
    seedGroups([dm]);

    render(<ConversationsListContent />);

    expect(screen.getByText("Carol Souza")).toBeDefined();
    expect(screen.getByText("Tudo certo?")).toBeDefined();
    expect(screen.getByLabelText("5 mensagens não lidas")).toBeDefined();

    const rowLink = screen.getByTestId("conversation-row-dm");
    expect(rowLink.textContent).toContain("−R$ 12,00");
    expect(rowLink.getAttribute("href")).toBe(`/app/conversations/${carol.id}`);
  });

  it("prefixes only an own DM preview with Você", () => {
    const dm = makeDmSnapshot(carol, {
      lastMessage: {
        content: "Eu pago hoje",
        senderId: me.id,
        createdAt: "2026-01-01T10:00:00Z",
      },
    });
    seedGroups([dm]);

    render(<ConversationsListContent />);

    expect(screen.getByText("Você: Eu pago hoje")).toBeDefined();
  });

  it("renders invitation rows without preview or unread state", () => {
    const dm = makeDmSnapshot(carol, {
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
        {
          groupId: "dm-1",
          userId: me.id,
          status: "invited",
          invitedBy: carol.id,
          acceptedAt: null,
          user: me,
        },
        {
          groupId: "dm-1",
          userId: carol.id,
          status: "accepted",
          invitedBy: null,
          acceptedAt: "2026-01-01T00:00:00Z",
          user: carol,
        },
      ],
      unreadCount: 3,
      lastMessage: null,
    });
    seedGroups([dm]);

    render(<ConversationsListContent />);

    expect(screen.getByText("Carol Souza")).toBeDefined();
    expect(screen.getByText("Convite para conversar")).toBeDefined();
    expect(screen.queryByText("Sem mensagens")).toBeNull();
    expect(screen.queryByLabelText("3 mensagens não lidas")).toBeNull();
  });

  it("renders an awaiting label for a pending counterparty", () => {
    const dm = makeDmSnapshot(carol, {
      members: [
        {
          groupId: "dm-1",
          userId: me.id,
          status: "accepted",
          invitedBy: null,
          acceptedAt: "2026-01-01T00:00:00Z",
          user: me,
        },
        {
          groupId: "dm-1",
          userId: carol.id,
          status: "invited",
          invitedBy: me.id,
          acceptedAt: null,
          user: carol,
        },
      ],
      unreadCount: 3,
      lastMessage: null,
    });
    seedGroups([dm]);

    render(<ConversationsListContent />);

    expect(screen.getByText("Aguardando aceitar o convite")).toBeDefined();
    expect(screen.queryByText("Sem mensagens")).toBeNull();
    expect(screen.queryByLabelText("3 mensagens não lidas")).toBeNull();
  });

  it("keeps group identity and includes groups without messages", () => {
    const group = makeGroupSnapshot({
      group: {
        id: "group-empty",
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
    seedGroups([group]);

    render(<ConversationsListContent />);

    expect(screen.getByText("Viagem")).toBeDefined();
    expect(screen.getByText("Sem mensagens")).toBeDefined();
    expect(screen.getByTestId("conversation-row-group").getAttribute("href")).toBe(
      "/app/groups/group-empty/chat",
    );
  });

  it("composes search and balance filters", () => {
    const carolDm = makeDmSnapshot(carol, {
      group: {
        id: "dm-carol",
        kind: "dm",
        name: carol.name,
        creatorId: me.id,
        dmUserA: me.id,
        dmUserB: carol.id,
        ledgerVersion: 1,
        createdAt: "2026-01-01T00:00:00Z",
      },
      balances: [
        { kind: "user", participantId: me.id, netCents: -1000 },
        { kind: "user", participantId: carol.id, netCents: 1000 },
      ],
    });
    const bobDm = makeDmSnapshot(bob, {
      group: {
        id: "dm-bob",
        kind: "dm",
        name: bob.name,
        creatorId: me.id,
        dmUserA: me.id,
        dmUserB: bob.id,
        ledgerVersion: 1,
        createdAt: "2026-01-01T00:00:00Z",
      },
      balances: [
        { kind: "user", participantId: me.id, netCents: 1000 },
        { kind: "user", participantId: bob.id, netCents: -1000 },
      ],
    });
    seedGroups([carolDm, bobDm]);

    render(<ConversationsListContent />);

    fireEvent.change(screen.getByLabelText("Buscar por nome"), {
      target: { value: "car" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "A pagar" }));

    expect(screen.getByText("Carol Souza")).toBeDefined();
    expect(screen.queryByText("Bob Silva")).toBeNull();
  });

  it("shows filtered empty state and clears filters", () => {
    const dm = makeDmSnapshot(carol, {
      balances: [
        { kind: "user", participantId: me.id, netCents: -1000 },
        { kind: "user", participantId: carol.id, netCents: 1000 },
      ],
    });
    seedGroups([dm]);

    render(<ConversationsListContent />);

    fireEvent.click(screen.getByRole("tab", { name: "A receber" }));

    expect(screen.getByText("Nenhuma conversa encontrada")).toBeDefined();
    const clearButton = screen.getByRole("button", { name: "Limpar filtros" });
    expect(clearButton).toBeDefined();

    fireEvent.click(clearButton);

    expect(screen.getByText("Carol Souza")).toBeDefined();
    expect(screen.queryByText("Nenhuma conversa encontrada")).toBeNull();
  });
});
