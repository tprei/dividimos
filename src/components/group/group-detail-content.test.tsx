import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore } from "react";
import { GroupDetailContent } from "./group-detail-content";
import { LedgerError } from "@/lib/sync/errors";
import { refreshGroup } from "@/lib/sync/refresh";
import { groupReadKey, useAppStore } from "@/stores/app-store";
import type { GroupSnapshot, Me } from "@/types/ledger";

const routerMock = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
}));

const URL_CHANGE = "test:urlchange";

function subscribeToUrl(notify: () => void) {
  window.addEventListener("popstate", notify);
  window.addEventListener(URL_CHANGE, notify);
  return () => {
    window.removeEventListener("popstate", notify);
    window.removeEventListener(URL_CHANGE, notify);
  };
}

function useLocationSearchParams() {
  return new URLSearchParams(useSyncExternalStore(subscribeToUrl, () => window.location.search));
}

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  useSearchParams: () => useLocationSearchParams(),
}));

/** Next syncs history.pushState/replaceState into useSearchParams; so does this. */
function syncHistoryWithSearchParams() {
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method].bind(window.history);
    vi.spyOn(window.history, method).mockImplementation((data, unused, url) => {
      original(data, unused, url);
      window.dispatchEvent(new Event(URL_CHANGE));
    });
  }
}

function pullDown(target: HTMLElement, travel: number) {
  act(() => {
    fireEvent.touchStart(target, { touches: [{ identifier: 1, clientX: 100, clientY: 100 }] });
  });
  act(() => {
    fireEvent.touchMove(target, { touches: [{ identifier: 1, clientX: 100, clientY: 100 + travel }] });
  });
  act(() => {
    fireEvent.touchEnd(target);
  });
}

const mockAccept = vi.fn();
const mockDecline = vi.fn();
vi.mock("@/hooks/use-invitation-actions", () => ({
  useInvitationActions: () => ({
    accept: mockAccept,
    decline: mockDecline,
    pendingGroupId: null,
  }),
}));


vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/sync/refresh", () => ({
  refreshGroup: vi.fn(),
  loadMoreExpenses: vi.fn(),
}));

vi.mock("@/lib/sync/mutations-group", () => ({
  createInviteLink: vi.fn(),
  deactivateInviteLink: vi.fn(),
  inviteMember: vi.fn(),
  lookupUserByHandle: vi.fn(),
  removeMember: vi.fn(),
  leaveGroup: vi.fn(),
  deleteGroup: vi.fn(),
}));

vi.mock("./group-settlement-view", () => ({
  GroupSettlementView: () => <div data-testid="settlement-stub" />,
}));

const inviteModalProps: Array<{ open: boolean; groupId: string; groupName: string }> = [];

vi.mock("./group-invite-modal", () => ({
  GroupInviteModal: (props: { open: boolean; groupId: string; groupName: string }) => {
    inviteModalProps.push(props);
    return props.open ? <div data-testid="invite-modal-stub" /> : null;
  },
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

function snapshot(): GroupSnapshot {
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
      {
        groupId,
        userId: "user-3",
        status: "invited",
        invitedBy: "user-1",
        acceptedAt: null,
        user: { id: "user-3", handle: "dave", name: "Dave Lima", avatarUrl: null, isBot: false },
      },
    ],
    balances: [
      { kind: "user", participantId: "user-1", netCents: -5000 },
      { kind: "user", participantId: "user-2", netCents: 5000 },
    ],
    guests: [{ id: "guest-1", displayName: "Bruno", expenseId: "e1" }],
    settlements: [],
    recentExpenses: [
      {
        id: "e1",
        groupId,
        creatorId: "user-1",
        status: "active",
        occurredOn: "2026-09-01",
        createdAt: "2026-09-01T12:00:00Z",
        versionNo: 1,
        title: "Jantar",
        merchantName: null,
        expenseType: "single_amount",
        totalCents: 12000,
        myShareCents: 4000,
        myPaidCents: 0,
        participantCount: 3,
      },
    ],
    expenseCount: 0,
    lastEventId: 1,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-02T00:00:00Z",
    pairwiseEdges: [],
  };
}

function seedLoaded() {
  const snap = snapshot();
  useAppStore.setState({
    hydrated: true,
    me,
    groups: { [groupId]: snap },
    groupOrder: [groupId],
    expenseLists: {
      [groupId]: { ids: ["e1"], cursor: null, complete: true, total: null },
    },
    expenses: Object.fromEntries(
      snap.recentExpenses.map((e) => [e.id, e]),
    ),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  useAppStore.getState().reset();
  inviteModalProps.length = 0;
  vi.clearAllMocks();
  window.history.replaceState(null, "", `/app/groups/${groupId}`);
  syncHistoryWithSearchParams();
  vi.mocked(refreshGroup).mockResolvedValue(undefined);
});

describe("GroupDetailContent", () => {
  it("shows a skeleton before hydration and does not fetch", () => {
    useAppStore.setState({ hydrated: false, me: null, groups: {}, groupOrder: [] });

    render(<GroupDetailContent groupId={groupId} />);

    expect(screen.queryByText("Viagem")).not.toBeInTheDocument();
    expect(refreshGroup).not.toHaveBeenCalled();
  });

  it("renders a cached group without a skeleton or a refetch", async () => {
    seedLoaded();
    const { container } = render(<GroupDetailContent groupId={groupId} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Viagem" })).toBeInTheDocument();
    });
    expect(container.querySelectorAll(".animate-pulse, [class*='shimmer']")).toHaveLength(0);
    expect(refreshGroup).not.toHaveBeenCalled();
  });

  it("stops at the unavailable state when a completed read has no snapshot", () => {
    useAppStore.setState({
      hydrated: true,
      me,
      groups: {},
      groupOrder: [],
      reads: { [groupReadKey(groupId)]: { status: "ready" } },
    });

    render(<GroupDetailContent groupId={groupId} />);

    expect(
      screen.getByText("Esse grupo não está mais disponível"),
    ).toBeInTheDocument();
    expect(refreshGroup).not.toHaveBeenCalled();
  });

  it("fetches the group when hydrated without a snapshot", async () => {
    useAppStore.setState({ hydrated: true, me, groups: {}, groupOrder: [] });

    render(<GroupDetailContent groupId={groupId} />);

    expect(screen.queryByText("Viagem")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(refreshGroup).toHaveBeenCalledWith(groupId);
    });
  });

  it("shows the empty state when the group is no longer available", async () => {
    useAppStore.setState({ hydrated: true, me, groups: {}, groupOrder: [] });
    vi.mocked(refreshGroup).mockRejectedValueOnce(
      new LedgerError("group_not_found"),
    );

    render(<GroupDetailContent groupId={groupId} />);

    expect(
      await screen.findByText("Esse grupo não está mais disponível"),
    ).toBeInTheDocument();
  });

  it("offers a retry, not a missing-group message, when the read fails", async () => {
    useAppStore.setState({
      hydrated: true,
      me,
      groups: {},
      groupOrder: [],
      reads: { [groupReadKey(groupId)]: { status: "error", code: "network" } },
    });
    vi.mocked(refreshGroup).mockRejectedValueOnce(new LedgerError("network"));

    render(<GroupDetailContent groupId={groupId} />);

    expect(
      await screen.findByRole("button", { name: /Tentar novamente/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Esse grupo não está mais disponível")).toBeNull();
  });

  it("warns without discarding a group already on screen", async () => {
    seedLoaded();
    vi.mocked(refreshGroup).mockRejectedValueOnce(new LedgerError("network"));

    render(<GroupDetailContent groupId={groupId} />);
    await waitFor(() => {
      expect(screen.getAllByText("Viagem").length).toBeGreaterThan(0);
    });
  });


  it("opens the group profile in place from the header avatar", async () => {
    seedLoaded();
    useAppStore.setState((state) => ({
      groups: {
        ...state.groups,
        [groupId]: {
          ...state.groups[groupId],
          overview: { avatar: { kind: "emoji", emoji: "🍕" }, spending: null },
        },
      },
    }));

    const user = userEvent.setup();
    render(<GroupDetailContent groupId={groupId} />);

    const [avatarButton] = screen.getAllByRole("button", { name: "Ver perfil do grupo" });
    expect(within(avatarButton).getByRole("img", { name: "Viagem" })).toHaveTextContent("🍕");

    await user.click(avatarButton);

    expect(window.history.pushState).toHaveBeenCalledOnce();
    expect(window.location.search).toBe("?view=info");
    expect(screen.getByRole("heading", { name: "Viagem", level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Seções do grupo" })).not.toBeInTheDocument();
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("opens the group profile from a deliberate pull down the top of the screen", () => {
    seedLoaded();
    render(<GroupDetailContent groupId={groupId} />);

    pullDown(screen.getByTestId("settlement-stub"), 90);
    expect(window.location.search).toBe("");

    pullDown(screen.getByTestId("settlement-stub"), 320);
    expect(window.location.search).toBe("?view=info");
    expect(screen.getByRole("button", { name: /4 pessoas/ })).toBeInTheDocument();
  });

  it("closes a deep-linked profile with a pull and stays on the group", () => {
    seedLoaded();
    window.history.replaceState(null, "", `/app/groups/${groupId}?view=info`);
    render(<GroupDetailContent groupId={groupId} />);

    const heading = screen.getByRole("heading", { name: "Viagem", level: 1 });
    pullDown(heading, 320);

    expect(window.location.pathname).toBe(`/app/groups/${groupId}`);
    expect(window.location.search).toBe("");
    expect(screen.getByRole("radio", { name: "Saldos" })).toBeInTheDocument();
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("goes back through history exactly once when the profile it pushed is closed twice in a row", async () => {
    seedLoaded();
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const user = userEvent.setup();
    render(<GroupDetailContent groupId={groupId} />);

    await user.click(screen.getAllByRole("button", { name: "Ver perfil do grupo" })[0]);
    const voltar = screen.getByRole("button", { name: "Voltar" });
    await user.click(voltar);
    await user.click(voltar);

    expect(back).toHaveBeenCalledOnce();
    expect(window.history.replaceState).not.toHaveBeenCalled();
  });

  it("still opens the profile by pulling on the tabs after the @handle panel was left open on Membros", async () => {
    seedLoaded();
    const user = userEvent.setup();
    render(<GroupDetailContent groupId={groupId} />);

    await user.click(screen.getByRole("radio", { name: "Membros" }));
    await user.click(screen.getByRole("button", { name: "Convidar por @handle" }));
    await user.click(screen.getByRole("radio", { name: "Saldos" }));

    pullDown(screen.getByRole("radio", { name: "Saldos" }), 320);

    expect(window.location.search).toBe("?view=info");
  });

  it("returns from the profile to the Membros tab through the people row", async () => {
    seedLoaded();
    window.history.replaceState(null, "", `/app/groups/${groupId}?view=info`);
    const user = userEvent.setup();
    render(<GroupDetailContent groupId={groupId} />);

    await user.click(screen.getByRole("button", { name: /4 pessoas/ }));

    expect(window.location.search).toBe("");
    expect(screen.getByRole("radio", { name: "Membros" })).toBeChecked();
  });

  it("links to the group chat with an unread count", () => {
    useAppStore.setState({
      hydrated: true,
      me,
      groups: { [groupId]: { ...snapshot(), unreadCount: 7 } },
      groupOrder: [groupId],
    });

    render(<GroupDetailContent groupId={groupId} />);

    const chatLink = screen.getByRole("link", { name: "Conversa" });
    expect(chatLink.getAttribute("href")).toBe(`/app/groups/${groupId}/chat`);
    expect(screen.getByLabelText("7 mensagens não lidas")).toBeInTheDocument();
  });


  it("reveals the bills panel when the Contas tab is selected", async () => {
    seedLoaded();

    render(<GroupDetailContent groupId={groupId} />);

    expect(screen.queryByText("Jantar")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Contas" }));

    expect(screen.getByText("Jantar")).toBeInTheDocument();
  });

  it("reveals the members panel when the Membros tab is selected", async () => {
    seedLoaded();

    render(<GroupDetailContent groupId={groupId} />);

    expect(screen.queryByText("Pendente")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Membros" }));

    expect(screen.getByText("Pendente")).toBeInTheDocument();
    expect(screen.getByText("Convidado")).toBeInTheDocument();
  });

  it("opens the Membros tab straight from a ?tab=membros deep link", () => {
    seedLoaded();
    window.history.replaceState(null, "", `/app/groups/${groupId}?tab=membros`);

    render(<GroupDetailContent groupId={groupId} />);

    expect(screen.getByText("Pendente")).toBeInTheDocument();
  });

  it("opens the link invite modal from the Membros tab", async () => {
    seedLoaded();

    render(<GroupDetailContent groupId={groupId} />);

    expect(screen.queryByTestId("invite-modal-stub")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Membros" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Compartilhar link e QR code do grupo" }),
    );

    expect(screen.getByTestId("invite-modal-stub")).toBeInTheDocument();
    const props = inviteModalProps.at(-1)!;
    expect(props.groupId).toBe(groupId);
    expect(props.groupName).toBe("Viagem");
  });


  it("shows the invite controls to an accepted non-creator member", async () => {
    useAppStore.setState({
      hydrated: true,
      me: {
        ...me,
        id: "user-2",
        handle: "carol",
        name: "Carol Souza",
        email: "carol@example.com",
      },
      groups: { [groupId]: snapshot() },
      groupOrder: [groupId],
    });

    render(<GroupDetailContent groupId={groupId} />);

    await userEvent.click(screen.getByRole("radio", { name: "Membros" }));

    await userEvent.click(
      screen.getByRole("button", { name: "Compartilhar link e QR code do grupo" }),
    );
    expect(screen.getByTestId("invite-modal-stub")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Convidar por @handle" }));
    expect(screen.getByText("Convidar por @handle")).toBeInTheDocument();
  });

  it("hides the invite controls from a pending invitee", () => {
    useAppStore.setState({
      hydrated: true,
      me: {
        ...me,
        id: "user-3",
        handle: "dave",
        name: "Dave Lima",
        email: "dave@example.com",
      },
      groups: { [groupId]: snapshot() },
      groupOrder: [groupId],
    });

    render(<GroupDetailContent groupId={groupId} />);

    expect(screen.getByText("Convite para o grupo")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Compartilhar link e QR code do grupo" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Convidar por @handle" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Membros" })).not.toBeInTheDocument();
  });

  it("renders pending invite view when viewer status is invited", () => {
    const snap = snapshot();
    // user-3 is invited by user-1 (Alice)
    useAppStore.setState({
      hydrated: true,
      me: {
        id: "user-3",
        handle: "dave",
        name: "Dave Lima",
        avatarUrl: null,
        isBot: false,
        email: "dave@example.com",
        pixKeyType: null,
        pixKeyHint: null,
        onboarded: true,
        notificationPreferences: {},
      },
      groups: { [groupId]: snap },
      groupOrder: [groupId],
    });

    render(<GroupDetailContent groupId={groupId} />);

    expect(screen.getByRole("button", { name: "Aceitar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recusar" })).toBeInTheDocument();

    expect(screen.queryByRole("radiogroup", { name: "Seções do grupo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("accepting an invitation updates state and renders tabs in place", async () => {
    const user = userEvent.setup();
    const snap = snapshot();
    const meDave = {
      id: "user-3",
      handle: "dave",
      name: "Dave Lima",
      avatarUrl: null,
      isBot: false,
      email: "dave@example.com",
      pixKeyType: null,
      pixKeyHint: null,
      onboarded: true,
      notificationPreferences: {},
    };

    useAppStore.setState({
      hydrated: true,
      me: meDave,
      groups: { [groupId]: snap },
      groupOrder: [groupId],
    });

    mockAccept.mockImplementationOnce(async (id: string) => {
      // Simulate hook refreshing snapshot in store to status: accepted
      const current = useAppStore.getState().groups[id];
      if (current) {
        useAppStore.setState({
          groups: {
            [id]: {
              ...current,
              members: current.members.map((m) =>
                m.userId === meDave.id ? { ...m, status: "accepted" as const } : m,
              ),
            },
          },
        });
      }
    });

    render(<GroupDetailContent groupId={groupId} />);

    expect(screen.getByText("Convite para o grupo")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Aceitar" }));

    expect(mockAccept).toHaveBeenCalledWith(groupId);

    // After acceptance, full group tabs render in place
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "Saldos" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Contas" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Membros" })).toBeInTheDocument();
    });
    expect(screen.queryByText("Convite para o grupo")).not.toBeInTheDocument();
  });

  it("clicking Recusar opens confirmation dialog and confirming calls decline and redirects", async () => {
    const user = userEvent.setup();
    const snap = snapshot();
    useAppStore.setState({
      hydrated: true,
      me: {
        id: "user-3",
        handle: "dave",
        name: "Dave Lima",
        avatarUrl: null,
        isBot: false,
        email: "dave@example.com",
        pixKeyType: null,
        pixKeyHint: null,
        onboarded: true,
        notificationPreferences: {},
      },
      groups: { [groupId]: snap },
      groupOrder: [groupId],
    });

    render(<GroupDetailContent groupId={groupId} />);

    // Click Recusar button on view
    await user.click(screen.getByRole("button", { name: "Recusar" }));

    // Dialog opens
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Recusar convite?")).toBeInTheDocument();
    expect(
      screen.getByText("Você precisará de um novo convite para voltar."),
    ).toBeInTheDocument();

    const dialog = screen.getByRole("dialog");
    const confirmDeclineBtn = within(dialog).getByRole("button", { name: "Recusar" });
    mockDecline.mockResolvedValue(true);
    await user.click(confirmDeclineBtn);

    expect(mockDecline).toHaveBeenCalledWith(groupId);
    await waitFor(() => {
      expect(routerMock.replace).toHaveBeenCalledWith("/app/groups");
    });
  });
});
