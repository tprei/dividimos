import { beforeEach, describe, expect, it, vi } from "vitest";
import * as framerMotion from "framer-motion";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationsSheet } from "./notifications-sheet";
import { loadActivity } from "@/lib/sync/refresh";
import { useAppStore } from "@/stores/app-store";
import type { GroupEvent, GroupSnapshot, Me } from "@/types/ledger";

vi.mock("@/lib/sync/refresh", () => ({
  loadActivity: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    onClick,
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  }) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}));

const me: Me = {
  id: "user-1",
  handle: "alice",
  name: "Alice Souza",
  avatarUrl: null,
  isBot: false,
  email: "alice@example.com",
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: true,
  notificationPreferences: {},
};

function snapshot(id = "g1"): GroupSnapshot {
  return {
    group: {
      id,
      kind: "group",
      name: "Churrasco do mês",
      creatorId: me.id,
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
    },
    members: [],
    balances: [],
    guests: [],
    settlements: [],
    recentExpenses: [],
    expenseCount: 0,
    lastEventId: 9,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-09-18T12:00:00.000Z",
    pairwiseEdges: [],
  };
}

function event(id: number, createdAt: string, expenseTitle: string): GroupEvent {
  return {
    id,
    groupId: "g1",
    actorId: null,
    kind: "expense_created",
    expenseId: null,
    settlementId: null,
    subjectUserId: null,
    payload: {},
    createdAt,
    actor: null,
    expenseTitle,
  };
}

function rowFor(text: string): HTMLElement {
  const row = screen.getByText(text).closest("li");
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

function renderSheet(invitations: GroupSnapshot[] = []) {
  const user = userEvent.setup();
  // A real mounted anchor: the popover positions against the bell exactly as
  // the dashboard does.
  const anchor = document.createElement("button");
  anchor.textContent = "trigger";
  document.body.appendChild(anchor);
  render(
    <NotificationsSheet
      open
      onOpenChange={vi.fn()}
      invitations={invitations}
      meId={me.id}
      anchor={anchor}
    />,
  );
  return { user };
}

describe("NotificationsSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(framerMotion, "useReducedMotion").mockReturnValue(true);
    useAppStore.getState().reset();
    useAppStore.setState({
      me,
      groups: { g1: snapshot() },
      activity: {
        items: [
          event(9, "2026-09-18T12:00:00.000Z", "Pizza"),
          event(8, "2026-09-17T12:00:00.000Z", "Cinema"),
        ],
        oldestId: 8,
        complete: true,
        read: { status: "ready" },
        readIds: [],
        dismissedIds: [],
      },
    });
    vi.mocked(loadActivity).mockResolvedValue(undefined);
  });

  it("discards a row: it leaves the preview and stops counting as unread", async () => {
    const { user } = renderSheet();

    await user.click(within(rowFor("Alguém adicionou Pizza")).getByRole("button", { name: "Descartar" }));

    await waitFor(() => expect(screen.queryByText("Alguém adicionou Pizza")).not.toBeInTheDocument());
    expect(useAppStore.getState().activity.dismissedIds).toEqual([9]);
    expect(useAppStore.getState().activity.readIds).toEqual([9]);
    expect(screen.getByText("Alguém adicionou Cinema")).toBeInTheDocument();
  });

  // The swipe-revealed action is a separate element from the inline one; both
  // must discard, not just dismiss.
  it("discards through the action revealed behind a swipeable row", async () => {
    vi.spyOn(framerMotion, "useReducedMotion").mockReturnValue(false);
    const { user } = renderSheet();

    await user.click(within(rowFor("Alguém adicionou Cinema")).getByRole("button", { name: "Descartar" }));

    await waitFor(() => expect(screen.queryByText("Alguém adicionou Cinema")).not.toBeInTheDocument());
    expect(useAppStore.getState().activity.dismissedIds).toEqual([8]);
    expect(useAppStore.getState().activity.readIds).toEqual([8]);
  });

  it("discards every visible row at once", async () => {
    const { user } = renderSheet();

    await user.click(screen.getByRole("button", { name: "Descartar todas" }));

    await waitFor(() => expect(screen.getByText("Nenhuma notificação")).toBeInTheDocument());
    expect(useAppStore.getState().activity.dismissedIds).toEqual([9, 8]);
    expect(useAppStore.getState().activity.readIds).toEqual([9, 8]);
    expect(screen.queryByRole("button", { name: "Descartar todas" })).not.toBeInTheDocument();
  });

  // The button discards everything loaded, so it must not vanish just because
  // invitations fill the five preview slots and no event row renders.
  it("keeps Descartar todas while invitations fill the whole preview", async () => {
    const { user } = renderSheet([
      snapshot("g2"),
      snapshot("g3"),
      snapshot("g4"),
      snapshot("g5"),
      snapshot("g6"),
    ]);

    expect(screen.queryByText("Alguém adicionou Pizza")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Descartar todas" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Descartar todas" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Descartar todas" })).not.toBeInTheDocument(),
    );
    expect(useAppStore.getState().activity.dismissedIds).toEqual([9, 8]);
    expect(useAppStore.getState().activity.readIds).toEqual([9, 8]);
  });

  it("discards all loaded events, not just the five preview rows", async () => {
    useAppStore.setState((state) => ({
      activity: {
        ...state.activity,
        items: [9, 8, 7, 6, 5, 4, 3].map((id, index) =>
          event(id, `2026-09-${18 - index}T12:00:00.000Z`, `Conta ${id}`),
        ),
      },
    }));
    const { user } = renderSheet();

    await user.click(screen.getByRole("button", { name: "Descartar todas" }));

    await waitFor(() => expect(screen.getByText("Nenhuma notificação")).toBeInTheDocument());
    expect(useAppStore.getState().activity.dismissedIds).toEqual([9, 8, 7, 6, 5, 4, 3]);
    expect(useAppStore.getState().activity.readIds).toEqual([9, 8, 7, 6, 5, 4, 3]);
  });

  // Keyboard activation reaches the revealed action as a click with detail 0,
  // the one path the tap-to-click stub cannot fake on its own; it must discard
  // once, not once per handler.
  it("discards exactly once on keyboard activation behind a swipeable row", async () => {
    vi.spyOn(framerMotion, "useReducedMotion").mockReturnValue(false);
    const dismissEvent = vi.spyOn(useAppStore.getState(), "dismissEvent");
    renderSheet();

    const button = within(rowFor("Alguém adicionou Cinema")).getByRole("button", { name: "Descartar" });
    fireEvent.click(button, { detail: 0 });

    await waitFor(() => expect(screen.queryByText("Alguém adicionou Cinema")).not.toBeInTheDocument());
    expect(dismissEvent).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().activity.dismissedIds).toEqual([8]);
    expect(useAppStore.getState().activity.readIds).toEqual([8]);
  });
});
