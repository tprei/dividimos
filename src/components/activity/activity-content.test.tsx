import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ActivityContent } from "./activity-content";
import { voidSettlement } from "@/lib/sync/mutations";
import { loadActivity } from "@/lib/sync/refresh";
import { useAppStore } from "@/stores/app-store";
import type { GroupEvent, GroupSnapshot, Me, Settlement, UserProfile } from "@/types/ledger";

vi.mock("@/lib/sync/refresh", () => ({
  loadActivity: vi.fn().mockResolvedValue(undefined),
  refreshSettlement: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/sync/mutations", () => ({
  voidSettlement: vi.fn().mockResolvedValue({
    groupId: "group-dm",
    ledgerVersion: 2,
    eventId: 99,
  }),
}));

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("react-hot-toast", () => ({ default: toastMocks }));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));


const me: Me = {
  id: "me-id",
  handle: "me",
  name: "Eu Mesmo",
  avatarUrl: null,
  isBot: false,
  email: "me@example.com",
  pixKeyType: "email",
  pixKeyHint: "me@example.com",
  onboarded: true,
  notificationPreferences: {
    expenses: true,
    settlements: true,
    nudges: true,
  },
};

const alice: UserProfile = {
  id: "user-alice",
  handle: "alice",
  name: "Alice",
  avatarUrl: null,
  isBot: false,
};

const bob: UserProfile = {
  id: "user-bob",
  handle: "bob",
  name: "Bob",
  avatarUrl: null,
  isBot: false,
};

const groupNormal: GroupSnapshot = {
  group: {
    id: "group-1",
    name: "Amigos da Praia",
    kind: "group",
    ledgerVersion: 1,
    creatorId: "me-id",
    dmUserA: null,
    dmUserB: null,
    createdAt: "2026-09-01T00:00:00Z",
  },
  members: [
    {
      groupId: "group-1",
      userId: me.id,
      status: "accepted",
      invitedBy: null,
      acceptedAt: "2026-09-01T00:00:00Z",
      user: me,
    },
    {
      groupId: "group-1",
      userId: alice.id,
      status: "accepted",
      invitedBy: null,
      acceptedAt: "2026-09-01T00:00:00Z",
      user: alice,
    },
  ],
  balances: [],
  guests: [],
  settlements: [],
  recentExpenses: [],
  expenseCount: 0,
  lastEventId: 10,
  unreadCount: 0,
  lastMessage: null,
  lastActivityAt: "2026-09-06T12:00:00Z",
  pairwiseEdges: [],
};

const groupDm: GroupSnapshot = {
  group: {
    id: "group-dm",
    name: "DM com Bob",
    kind: "dm",
    ledgerVersion: 1,
    creatorId: "me-id",
    dmUserA: me.id,
    dmUserB: bob.id,
    createdAt: "2026-09-01T00:00:00Z",
  },
  members: [
    {
      groupId: "group-dm",
      userId: me.id,
      status: "accepted",
      invitedBy: null,
      acceptedAt: "2026-09-01T00:00:00Z",
      user: me,
    },
    {
      groupId: "group-dm",
      userId: bob.id,
      status: "accepted",
      invitedBy: null,
      acceptedAt: "2026-09-01T00:00:00Z",
      user: bob,
    },
  ],
  balances: [],
  guests: [],
  settlements: [],
  recentExpenses: [],
  expenseCount: 0,
  lastEventId: 11,
  unreadCount: 0,
  lastMessage: null,
  lastActivityAt: "2026-09-06T12:00:00Z",
  pairwiseEdges: [],
};

const expenseCreatedEvent: GroupEvent = {
  id: 101,
  groupId: "group-1",
  actorId: "user-alice",
  kind: "expense_created",
  expenseId: "exp-123",
  settlementId: null,
  subjectUserId: null,
  payload: { totalCents: 5000 },
  createdAt: "2026-09-06T12:00:00Z",
  actor: alice,
  expenseTitle: "Almoço",
};

const dmEvent: GroupEvent = {
  id: 102,
  groupId: "group-dm",
  actorId: "user-bob",
  kind: "expense_created",
  expenseId: "exp-456",
  settlementId: null,
  subjectUserId: null,
  payload: { totalCents: 2000 },
  createdAt: "2026-09-06T12:30:00Z",
  actor: bob,
  expenseTitle: "Café",
};

const recordedSettlementEvent: GroupEvent = {
  id: 103,
  groupId: "group-dm",
  actorId: "me-id",
  kind: "settlement_recorded",
  expenseId: null,
  settlementId: "sett-789",
  subjectUserId: "user-bob",
  payload: {
    amountCents: 3500,
    fromUserId: "user-bob",
    toUserId: "me-id",
  },
  createdAt: "2026-09-06T13:00:00Z",
  actor: me,
  expenseTitle: null,
};

const activeSettlement: Settlement = {
  id: "sett-789",
  operationId: "op-789",
  groupId: "group-dm",
  fromUserId: bob.id,
  toUserId: me.id,
  amountCents: 3500,
  status: "confirmed",
  createdBy: me.id,
  createdAt: "2026-09-06T13:00:00Z",
  confirmedAt: "2026-09-06T13:00:00Z",
  voidedAt: null,
  voidedBy: null,
};

describe("ActivityContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      hydrated: true,
      me,
      groups: {
        "group-1": groupNormal,
        "group-dm": groupDm,
      },
      activity: {
        items: [recordedSettlementEvent, dmEvent, expenseCreatedEvent],
        oldestId: 101,
        complete: false,
        read: { status: "ready" },
      },
    });
  });

  it("shows a retry instead of an empty history when the first read failed", () => {
    useAppStore.setState({
      activity: {
        items: [],
        oldestId: null,
        complete: false,
        read: { status: "error", code: "network" },
      },
    });

    render(<ActivityContent />);

    expect(screen.queryByText("Nenhuma atividade ainda")).toBeNull();
    expect(screen.getByRole("button", { name: /Tentar novamente/ })).toBeInTheDocument();
  });

  it("does not record a view when the read failed", () => {
    useAppStore.setState({
      activityViewedAt: {},
      activity: {
        items: [],
        oldestId: null,
        complete: false,
        read: { status: "error", code: "network" },
      },
    });

    render(<ActivityContent />);

    expect(useAppStore.getState().activityViewedAt[me.id]).toBeUndefined();
  });

  it("hides load-more once the server reported no older rows", () => {
    useAppStore.setState({
      activity: {
        items: [recordedSettlementEvent],
        oldestId: 101,
        complete: true,
        read: { status: "ready" },
      },
    });

    render(<ActivityContent />);

    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });

  it("renders activity feed with sentences and group labels (DM displays counterparty name)", () => {
    render(<ActivityContent />);

    expect(
      screen.getByText(/Alice adicionou Almoço.*50,00/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Bob adicionou Café.*20,00/),
    ).toBeInTheDocument();
    expect(screen.getByText(/35,00/)).toBeInTheDocument();

    expect(screen.getByText("Amigos da Praia")).toBeInTheDocument();
    expect(screen.getAllByText("Bob").length).toBeGreaterThanOrEqual(1);
  });

  it("links expense rows to /app/bill/<expenseId>", () => {
    render(<ActivityContent />);

    const expense1Link = screen
      .getByText(/Alice adicionou Almoço.*50,00/)
      .closest("a");
    expect(expense1Link).toHaveAttribute("href", "/app/bill/exp-123");

    const expense2Link = screen
      .getByText(/Bob adicionou Café.*20,00/)
      .closest("a");
    expect(expense2Link).toHaveAttribute("href", "/app/bill/exp-456");
  });

  it("loads activity on mount and records the view once the read succeeded", () => {
    render(<ActivityContent />);

    expect(loadActivity).toHaveBeenCalledWith();
    // The seeded slice is already "ready", so the newest snapshot activity is
    // recorded as seen for this account.
    expect(useAppStore.getState().activityViewedAt[me.id]).toBeDefined();
  });

  it("calls loadActivity(oldestId) when 'Carregar mais' is clicked", async () => {
    render(<ActivityContent />);
    const loadMoreButton = screen.getByRole("button", { name: "Carregar mais" });
    fireEvent.click(loadMoreButton);

    await waitFor(() => {
      expect(loadActivity).toHaveBeenCalledWith(101);
    });
  });

  it("shows 'Desfazer' on an active settlement and opens confirmation dialog without invoking voidSettlement", async () => {
    useAppStore.setState({
      groups: {
        "group-1": groupNormal,
        "group-dm": { ...groupDm, settlements: [activeSettlement] },
      },
    });
    render(<ActivityContent />);
    const undoButton = screen.getByTestId("activity-undo-settlement");
    expect(undoButton).toBeInTheDocument();

    fireEvent.click(undoButton);

    expect(voidSettlement).not.toHaveBeenCalled();
    expect(screen.getByText(/Desfazer este registro\?/)).toBeInTheDocument();
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Bob")).toBeInTheDocument();
    expect(dialog.getByText("você")).toBeInTheDocument();
    expect(
      screen.getByText(/O registro fica marcado como Desfeito e os saldos são recalculados na hora\./),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/O Pix em si não é estornado\. Combina a devolução direto com a outra pessoa\./),
    ).toBeInTheDocument();
  });

  it("closes confirmation dialog without calling voidSettlement when Cancelar is clicked in activity feed", async () => {
    useAppStore.setState({
      groups: {
        "group-1": groupNormal,
        "group-dm": { ...groupDm, settlements: [activeSettlement] },
      },
    });
    render(<ActivityContent />);
    fireEvent.click(screen.getByTestId("activity-undo-settlement"));
    expect(screen.getByText(/Desfazer este registro\?/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => {
      expect(screen.queryByText(/Desfazer este registro\?/)).not.toBeInTheDocument();
    });
    expect(voidSettlement).not.toHaveBeenCalled();
  });

  it("voids settlement when Desfazer registro is confirmed in dialog", async () => {
    useAppStore.setState({
      groups: {
        "group-1": groupNormal,
        "group-dm": { ...groupDm, settlements: [activeSettlement] },
      },
    });
    render(<ActivityContent />);
    fireEvent.click(screen.getByTestId("activity-undo-settlement"));

    fireEvent.click(screen.getByRole("button", { name: "Desfazer registro" }));

    await waitFor(() => {
      expect(voidSettlement).toHaveBeenCalledWith("group-dm", "sett-789");
    });
    expect(toastMocks.success).toHaveBeenCalledWith("Pagamento desfeito");
  });

  it("handles error gracefully when voidSettlement fails from activity dialog", async () => {
    vi.mocked(voidSettlement).mockRejectedValueOnce(new Error("Erro de rede"));
    useAppStore.setState({
      groups: {
        "group-1": groupNormal,
        "group-dm": { ...groupDm, settlements: [activeSettlement] },
      },
    });
    render(<ActivityContent />);
    fireEvent.click(screen.getByTestId("activity-undo-settlement"));

    fireEvent.click(screen.getByRole("button", { name: "Desfazer registro" }));

    await waitFor(() => {
      expect(voidSettlement).toHaveBeenCalledWith("group-dm", "sett-789");
    });
    await waitFor(() => {
      expect(toastMocks.error).toHaveBeenCalled();
    });
    expect(screen.getByRole("button", { name: "Desfazer registro" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).not.toBeDisabled();
  });

  it("does not show 'Desfazer' once the settlement is voided and gone from the snapshot", () => {
    const voidedEvent: GroupEvent = {
      id: 104,
      groupId: "group-dm",
      actorId: "me-id",
      kind: "settlement_voided",
      expenseId: null,
      settlementId: "sett-789",
      subjectUserId: "user-bob",
      payload: { amountCents: 3500 },
      createdAt: "2026-09-06T14:00:00Z",
      actor: me,
      expenseTitle: null,
    };

    useAppStore.setState({
      activity: {
        items: [recordedSettlementEvent, voidedEvent],
        oldestId: 101,
        complete: false,
        read: { status: "ready" },
      },
    });

    render(<ActivityContent />);

    expect(screen.queryByRole("button", { name: /Desfazer/i })).not.toBeInTheDocument();
  });

  it("offers Ver pagamento to a third member and keeps undo party-gated", () => {
    const thirdPartyEvent: GroupEvent = {
      ...recordedSettlementEvent,
      id: 105,
      settlementId: "sett-999",
      actor: bob,
      payload: { amountCents: 4200, fromUserId: bob.id, toUserId: alice.id },
    };
    useAppStore.setState({
      activity: {
        items: [thirdPartyEvent],
        oldestId: 105,
        complete: false,
        read: { status: "ready" },
      },
    });

    render(<ActivityContent />);

    expect(screen.getByTestId("activity-view-settlement")).toBeInTheDocument();
    expect(screen.queryByTestId("activity-undo-settlement")).not.toBeInTheDocument();
  });

  it("offers no settlement detail action without a settlement id", () => {
    const anonymousEvent: GroupEvent = {
      ...recordedSettlementEvent,
      settlementId: null,
    };
    useAppStore.setState({
      activity: {
        items: [anonymousEvent],
        oldestId: 105,
        complete: false,
        read: { status: "ready" },
      },
    });

    render(<ActivityContent />);

    expect(screen.queryByTestId("activity-view-settlement")).not.toBeInTheDocument();
  });

  it("opens the shared settlement sheet from the activity row", async () => {
    const { refreshSettlement } = await import("@/lib/sync/refresh");

    render(<ActivityContent />);
    fireEvent.click(screen.getByTestId("activity-view-settlement"));

    await waitFor(() => {
      expect(refreshSettlement).toHaveBeenCalledWith("sett-789");
    });
    expect(screen.getByTestId("settlement-detail-sheet")).toBeInTheDocument();
  });

  it("renders empty state when items is empty", () => {
    useAppStore.setState({
      activity: {
        items: [],
        oldestId: null,
        complete: false,
        read: { status: "ready" },
      },
    });

    render(<ActivityContent />);

    expect(screen.getByText("Nenhuma atividade ainda")).toBeInTheDocument();
    expect(
      screen.getByText("As atividades dos seus grupos aparecerão aqui."),
    ).toBeInTheDocument();
  });

  it("renders skeleton when not hydrated", () => {
    useAppStore.setState({
      hydrated: false,
    });

    const { container } = render(<ActivityContent />);

    expect(container.querySelectorAll(".animate-pulse, [class*='shimmer']").length).toBeGreaterThan(0);
    expect(screen.queryByText("Nenhuma atividade ainda")).not.toBeInTheDocument();
  });
});
