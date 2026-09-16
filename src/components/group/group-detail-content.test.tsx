import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

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

const settlementProps: Array<{
  groupId: string;
  snapshot: GroupSnapshot;
  meId: string;
}> = [];

vi.mock("./group-settlement-view", () => ({
  GroupSettlementView: (props: {
    groupId: string;
    snapshot: GroupSnapshot;
    meId: string;
  }) => {
    settlementProps.push(props);
    return <div data-testid="settlement-stub" />;
  },
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
  useAppStore.getState().reset();
  settlementProps.length = 0;
  inviteModalProps.length = 0;
  vi.clearAllMocks();
  vi.mocked(refreshGroup).mockResolvedValue(undefined);
});

describe("GroupDetailContent", () => {
  it("shows a skeleton before hydration and does not fetch", () => {
    useAppStore.setState({ hydrated: false, me: null, groups: {}, groupOrder: [] });

    render(<GroupDetailContent groupId={groupId} />);

    expect(screen.queryByText("Viagem")).not.toBeInTheDocument();
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

  it("renders the settlement header and passes the snapshot on mount", () => {
    seedLoaded();

    render(<GroupDetailContent groupId={groupId} />);

    expect(screen.getByText("Acerto do grupo")).toBeInTheDocument();
    expect(screen.getByText("Viagem")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Saldos" })).toBeInTheDocument();
    expect(screen.getByTestId("settlement-stub")).toBeInTheDocument();

    const props = settlementProps.at(-1)!;
    expect(props.groupId).toBe(groupId);
    expect(props.meId).toBe(me.id);
    expect(props.snapshot.group.id).toBe(groupId);
    expect(props.snapshot.balances).toEqual([
      { kind: "user", participantId: "user-1", netCents: -5000 },
      { kind: "user", participantId: "user-2", netCents: 5000 },
    ]);
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

  it("restores the group header when another tab is selected", async () => {
    seedLoaded();

    render(<GroupDetailContent groupId={groupId} />);

    await userEvent.click(screen.getByRole("tab", { name: "Contas" }));

    expect(screen.getByText(/2 membros/)).toBeInTheDocument();
    expect(screen.getByText("Jantar")).toBeInTheDocument();
    expect(screen.queryByText("Acerto do grupo")).not.toBeInTheDocument();
  });

  it("reveals the bills panel when the Contas tab is selected", async () => {
    seedLoaded();

    render(<GroupDetailContent groupId={groupId} />);

    expect(screen.queryByText("Jantar")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Contas" }));

    expect(screen.getByText("Jantar")).toBeInTheDocument();
  });

  it("reveals the members panel when the Membros tab is selected", async () => {
    seedLoaded();

    render(<GroupDetailContent groupId={groupId} />);

    expect(screen.queryByText("Pendente")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Membros" }));

    expect(screen.getByText("Pendente")).toBeInTheDocument();
    expect(screen.getByText("Convidado")).toBeInTheDocument();
  });

  it("opens the link invite modal from the Membros tab", async () => {
    seedLoaded();

    render(<GroupDetailContent groupId={groupId} />);

    expect(screen.queryByTestId("invite-modal-stub")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Membros" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Compartilhar link e QR code do grupo" }),
    );

    expect(screen.getByTestId("invite-modal-stub")).toBeInTheDocument();
    const props = inviteModalProps.at(-1)!;
    expect(props.groupId).toBe(groupId);
    expect(props.groupName).toBe("Viagem");
  });

  it("opens the handle invite panel from the Membros tab", async () => {
    seedLoaded();

    render(<GroupDetailContent groupId={groupId} />);

    await userEvent.click(screen.getByRole("tab", { name: "Membros" }));
    await userEvent.click(screen.getByRole("button", { name: "Convidar por @handle" }));
    expect(screen.getByText("Convidar por @handle")).toBeInTheDocument();
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

    // Shows hero card and info card
    expect(screen.getByText("Convite para o grupo")).toBeInTheDocument();
    expect(screen.getAllByText("Viagem").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Convite de Alice")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Alice convidou você para este grupo. Aceite para participar da conversa e dos acertos.",
      ),
    ).toBeInTheDocument();

    // Has Accept and Decline buttons
    expect(screen.getByRole("button", { name: "Aceitar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recusar" })).toBeInTheDocument();

    // Does NOT render tabs or empty state or Tudo liquidado
    expect(screen.queryByRole("tab", { name: "Saldos" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Contas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Membros" })).not.toBeInTheDocument();
    expect(screen.queryByText("Tudo liquidado!")).not.toBeInTheDocument();
  });

  it("accepting an invitation updates state and renders tabs in place", async () => {
    const user = userEvent.setup();
    const snap = snapshot();
    const meDave = {
      id: "user-3",
      handle: "dave",
      name: "Dave Lima",
      avatarUrl: null,
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
      expect(screen.getByRole("tab", { name: "Saldos" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Contas" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Membros" })).toBeInTheDocument();
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
    await user.click(confirmDeclineBtn);

    expect(mockDecline).toHaveBeenCalledWith(groupId);
    await waitFor(() => {
      expect(routerMock.replace).toHaveBeenCalledWith("/app/groups");
    });
  });
});
