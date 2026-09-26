import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GroupProfileView } from "./group-profile-view";
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

function renderProfile(avatar: GroupAvatar = { kind: "initials" }) {
  const onClose = vi.fn();
  const onShowMembers = vi.fn();
  render(
    <GroupProfileView
      groupId={groupId}
      snapshot={snapshot(avatar)}
      meId={me.id}
      onClose={onClose}
      onShowMembers={onShowMembers}
      onDepart={vi.fn()}
    />,
  );
  return { onClose, onShowMembers };
}

beforeEach(() => {
  useAppStore.getState().reset();
  useAppStore.setState({ hydrated: true, me });
  vi.clearAllMocks();
});

describe("GroupProfileView", () => {
  it("shows the group identity and what the group has spent", async () => {
    const { onShowMembers } = renderProfile();
    const user = userEvent.setup();

    expect(screen.getByRole("heading", { name: "Viagem", level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId("group-spending")).toHaveTextContent("120,00");

    await user.click(screen.getByRole("button", { name: /2 pessoas/ }));
    expect(onShowMembers).toHaveBeenCalledOnce();
  });

  it("shows the group photo as a full-bleed hero that carries the identity", () => {
    renderProfile({ kind: "photo", photoId: "photo-9" });

    const photo = screen.getByAltText("Viagem");
    expect(photo).toHaveAttribute("src", expect.stringContaining("/avatar?photoId="));

    // The photo is the header: the name, the member line and the only back
    // control all sit on top of the image, not in a row above it.
    const hero = photo.closest("section");
    expect(hero).not.toBeNull();
    const inHero = within(hero as HTMLElement);
    expect(inHero.getByRole("heading", { name: "Viagem" })).toBeInTheDocument();
    expect(inHero.getByText(/^2 membros · desde /)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Voltar" })).toHaveLength(1);
    expect(inHero.getByRole("button", { name: "Voltar" })).toBeInTheDocument();
  });

  it("carries the same identity header for a group without a photo", async () => {
    const { onClose } = renderProfile({ kind: "emoji", emoji: "🍕" });
    const user = userEvent.setup();

    const heading = screen.getByRole("heading", { name: "Viagem", level: 1 });
    const hero = within(heading.closest("section") as HTMLElement);
    expect(hero.getByRole("img", { name: "Viagem" })).toHaveTextContent("🍕");
    await user.click(hero.getByRole("button", { name: "Voltar" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("opens the avatar editor from the group avatar", async () => {
    renderProfile();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Foto do grupo" }));

    expect(screen.getByRole("dialog", { name: "Foto do grupo" })).toBeInTheDocument();
  });
});
