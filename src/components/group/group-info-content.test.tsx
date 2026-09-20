import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GroupInfoContent } from "./group-info-content";
import { refreshGroup } from "@/lib/sync/refresh";
import { useAppStore } from "@/stores/app-store";
import type { GroupAvatar, GroupSnapshot, Me } from "@/types/ledger";

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/sync/refresh", () => ({
  refreshGroup: vi.fn(),
  loadMoreExpenses: vi.fn(),
}));

vi.mock("@/lib/sync/mutations-group", () => ({
  inviteMember: vi.fn(),
  lookupUserByHandle: vi.fn(),
  removeMember: vi.fn(),
  leaveGroup: vi.fn(),
  deleteGroup: vi.fn(),
  setGroupAvatar: vi.fn(),
}));

const me: Me = {
  id: "user-1",
  handle: "alice",
  name: "Alice",
  avatarUrl: null,
  isBot: false,
  email: "alice@example.com",
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: true,
  notificationPreferences: {},
};

const groupId = "g1";

function snapshot(avatar: GroupAvatar): GroupSnapshot {
  return {
    group: {
      id: groupId,
      kind: "group",
      name: "Viagem",
      creatorId: "user-1",
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
    },
    members: [
      {
        groupId,
        userId: "user-1",
        status: "accepted",
        invitedBy: null,
        acceptedAt: null,
        user: { id: "user-1", handle: "alice", name: "Alice", avatarUrl: null, isBot: false },
      },
      {
        groupId,
        userId: "user-2",
        status: "accepted",
        invitedBy: null,
        acceptedAt: null,
        user: { id: "user-2", handle: "carol", name: "Carol Souza", avatarUrl: null, isBot: false },
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
    lastActivityAt: "2026-01-02T00:00:00Z",
    pairwiseEdges: [],
    overview: {
      avatar,
      spending: {
        totalCents: 12000,
        participants: [
          {
            kind: "user",
            participantId: "user-1",
            user: { id: "user-1", handle: "alice", name: "Alice", avatarUrl: null, isBot: false },
            shareCents: 12000,
          },
        ],
      },
    },
  };
}

function seedLoaded(avatar: GroupAvatar = { kind: "initials" }) {
  useAppStore.setState({
    hydrated: true,
    me,
    groups: { [groupId]: snapshot(avatar) },
    groupOrder: [groupId],
  });
}

beforeEach(() => {
  useAppStore.getState().reset();
  vi.clearAllMocks();
  vi.mocked(refreshGroup).mockResolvedValue(undefined);
});

describe("GroupInfoContent", () => {
  it("shows the group identity and what the group has spent", () => {
    seedLoaded();

    render(<GroupInfoContent groupId={groupId} />);

    expect(screen.getByRole("heading", { name: "Viagem", level: 2 })).toBeInTheDocument();
    expect(screen.getByText(/2 membros · desde/)).toBeInTheDocument();
    const spending = screen.getByTestId("group-spending");
    expect(spending).toHaveTextContent("120,00");
  });

  it("expands the group photo into a full-width hero", async () => {
    seedLoaded({ kind: "photo", photoId: "photo-9" });
    const user = userEvent.setup();

    render(<GroupInfoContent groupId={groupId} />);

    const expand = screen.getByRole("button", { name: "Ampliar imagem do grupo" });
    expect(expand).toHaveAttribute("aria-expanded", "false");

    await user.click(expand);

    const collapsed = screen.getByRole("button", { name: "Recolher imagem do grupo" });
    expect(collapsed).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByAltText("Viagem")).toHaveAttribute(
      "src",
      expect.stringContaining("/avatar?photoId="),
    );
  });

  it("opens the avatar editor from the image action", async () => {
    seedLoaded();
    const user = userEvent.setup();

    render(<GroupInfoContent groupId={groupId} />);

    await user.click(screen.getByRole("button", { name: "Imagem" }));

    expect(screen.getByRole("dialog", { name: "Editar imagem do grupo" })).toBeInTheDocument();
  });
});
