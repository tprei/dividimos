import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NewConversationButton } from "./new-conversation-button";
import { useAppStore } from "@/stores/app-store";
import type { GroupSnapshot, Me } from "@/types/ledger";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const mutationsGroup = vi.hoisted(() => ({
  getOrCreateDm: vi.fn().mockResolvedValue({ groupId: "dm-new", created: true }),
  lookupUserByHandle: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/sync/mutations-group", () => mutationsGroup);

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

const bob = { id: "user-bob", handle: "bob", name: "Bob Silva", avatarUrl: null };
const carol = { id: "user-carol", handle: "carol", name: "Carol Souza", avatarUrl: null };

function seedStoreWithContacts() {
  const group: GroupSnapshot = {
    group: {
      id: "g-1",
      kind: "group",
      name: "Viagem",
      creatorId: me.id,
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
    },
    members: [
      { groupId: "g-1", userId: me.id, status: "accepted", invitedBy: null, acceptedAt: null, user: me },
      { groupId: "g-1", userId: bob.id, status: "accepted", invitedBy: null, acceptedAt: null, user: bob },
      { groupId: "g-1", userId: carol.id, status: "accepted", invitedBy: null, acceptedAt: null, user: carol },
    ],
    balances: [],
    guests: [],
    pendingSettlements: [],
    recentExpenses: [],
    lastEventId: 0,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-01T00:00:00Z",
  };

  useAppStore.setState({
    hydrated: true,
    me,
    groups: { [group.group.id]: group },
    groupOrder: [group.group.id],
  });
}

describe("NewConversationButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedStoreWithContacts();
  });

  it("opens dialog on click and displays known contacts from store groups", async () => {
    render(<NewConversationButton />);

    const fab = screen.getByLabelText("Nova conversa");
    fireEvent.click(fab);

    expect(screen.getByText("Nova conversa")).toBeDefined();
    expect(screen.getByText("Bob Silva")).toBeDefined();
    expect(screen.getByText("Carol Souza")).toBeDefined();
  });

  it("clicking a contact initiates DM creation and navigates", async () => {
    render(<NewConversationButton />);

    fireEvent.click(screen.getByLabelText("Nova conversa"));

    const bobBtn = screen.getByText("Bob Silva");
    fireEvent.click(bobBtn);

    await waitFor(() => {
      expect(mutationsGroup.getOrCreateDm).toHaveBeenCalledWith(bob.id);
      expect(pushMock).toHaveBeenCalledWith(`/app/conversations/${bob.id}`);
    });
  });

  it("searches users by handle with debounce", async () => {
    const user = userEvent.setup();
    mutationsGroup.lookupUserByHandle.mockResolvedValue({
      id: "user-daniel",
      handle: "daniel",
      name: "Daniel Santos",
      avatarUrl: null,
    });

    render(<NewConversationButton />);

    fireEvent.click(screen.getByLabelText("Nova conversa"));

    const input = screen.getByPlaceholderText("buscar por handle");
    await user.type(input, "daniel");

    await waitFor(
      () => {
        expect(mutationsGroup.lookupUserByHandle).toHaveBeenCalledWith("daniel");
        expect(screen.getByText("Daniel Santos")).toBeDefined();
      },
      { timeout: 1500 },
    );
  });
});
