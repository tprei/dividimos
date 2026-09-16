import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GroupSnapshot, Me } from "@/types/ledger";
import { useAppStore } from "@/stores/app-store";
import { LedgerError } from "@/lib/sync/errors";

const mutations = vi.hoisted(() => ({
  recordSettlement: vi.fn(),
}));
vi.mock("@/lib/sync/mutations", () => mutations);

const groupMutations = vi.hoisted(() => ({
  acceptInvitation: vi.fn(),
  declineInvitation: vi.fn(),
  sendNudge: vi.fn(),
  retryNudgeDispatch: vi.fn(),
}));
vi.mock("@/lib/sync/mutations-group", () => groupMutations);

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("react-hot-toast", () => ({
  default: {
    error: (message: string) => toastError(message),
    success: (message: string) => toastSuccess(message),
  },
}));

const pixProps = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));
vi.mock("@/components/settlement/pix-qr-modal", () => ({
  PixQrModal: (props: Record<string, unknown>) => {
    pixProps.current = props;
    return <div data-testid="pix-modal" />;
  },
}));

const quickProps = vi.hoisted(() => ({
  current: null as { open: boolean } | null,
}));
vi.mock("@/components/dashboard/quick-charge-modal", () => ({
  QuickChargeModal: (props: { open: boolean }) => {
    quickProps.current = props;
    return <div data-testid="quick-charge-modal" />;
  },
}));

vi.mock("@/components/pwa/install-prompt", () => ({
  InstallPrompt: () => null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/app",
}));

vi.mock("@/lib/sync/client", () => ({
  getSupabase: () => ({
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) },
  }),
  getAuthGeneration: () => 1,
  advanceAuthGeneration: () => 1,
  rpc: vi.fn(),
}));

vi.mock("@/lib/sync/auth", () => ({
  attachAuthListener: () => () => {},
}));

vi.mock("@/lib/sync/bootstrap", () => ({
  runBootstrap: vi.fn().mockResolvedValue(undefined),
  attachVisibilityRefresh: () => () => {},
}));

vi.mock("@/lib/sync/realtime", () => ({
  startRealtime: () => () => {},
}));

vi.mock("@/lib/push/native-registration", () => ({
  invalidateNativeRegistration: vi.fn(),
  registerNativePushToken: vi.fn(),
}));

vi.mock("@/lib/push/native-consent", () => ({
  hasNativePushConsent: () => false,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string } & React.ComponentProps<"a">) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import { DashboardContent } from "./dashboard-content";
import { AppShell } from "@/components/app-shell";

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

const carol = { id: "user-2", handle: "carol", name: "Carol Souza", avatarUrl: null, isBot: false };
const dave = { id: "user-3", handle: "dave", name: "Dave Lima", avatarUrl: null, isBot: false };
const meWithPixKey: Me = { ...me, pixKeyHint: "a****@banco.com" };
type SnapshotOverrides = Omit<Partial<GroupSnapshot>, "group"> & {
  group?: Partial<GroupSnapshot["group"]>;
};

function snapshot(overrides: SnapshotOverrides = {}): GroupSnapshot {
  const base: GroupSnapshot = {
    group: {
      id: "g1",
      kind: "group",
      name: "Jantar",
      creatorId: me.id,
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
    },
    members: [
      { groupId: "g1", userId: me.id, status: "accepted", invitedBy: null, acceptedAt: null, user: me },
      { groupId: "g1", userId: carol.id, status: "accepted", invitedBy: null, acceptedAt: null, user: carol },
      { groupId: "g1", userId: dave.id, status: "accepted", invitedBy: null, acceptedAt: null, user: dave },
    ],
    balances: [],
    guests: [],
    settlements: [],
    recentExpenses: [],
    expenseCount: 0,
    lastEventId: 0,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-02T00:00:00Z",
    pairwiseEdges: [],
  };
  return { ...base, ...overrides, group: { ...base.group, ...overrides.group } };
}

function seedStore(snapshots: GroupSnapshot[], user: Me = me) {
  const groups = Object.fromEntries(snapshots.map((item) => [item.group.id, item]));
  useAppStore.setState({ hydrated: true, me: user, groups, groupOrder: snapshots.map((item) => item.group.id) });
}

describe("DashboardContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pixProps.current = null;
    quickProps.current = null;
    useAppStore.getState().reset();
  });

  it("renders first-use onboarding card when user has zero groups and zero expenses", () => {
    useAppStore.setState({ hydrated: true, me, groups: {}, groupOrder: [] });
    render(<DashboardContent />);

    expect(screen.getByText("Comece por aqui")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Comece por aqui" })).toBeInTheDocument();
    expect(
      screen.getByText("Crie uma conta pra rachar ou entre num grupo pelo convite."),
    ).toBeInTheDocument();
    const novaLinks = screen.getAllByRole("link", { name: /Nova conta/ });
    expect(novaLinks.some((link) => link.getAttribute("href") === "/app/bill/new")).toBe(true);
    expect(screen.getByRole("link", { name: /Ler convite/ })).toHaveAttribute("href", "/app/scan-invite");
    expect(screen.queryByText("Tudo em dia")).not.toBeInTheDocument();
    expect(screen.queryByText("A pagar")).not.toBeInTheDocument();
    expect(screen.queryByText("A receber")).not.toBeInTheDocument();
    // Quick actions stay reachable on first use (home-quick-charge synthetic contract).
    expect(screen.getByText("Escanear nota")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cobrar rápido" })).toBeInTheDocument();
    expect(document.querySelector("[data-tour='debt-lists']")?.contains(screen.getByText("Comece por aqui"))).toBe(true);
  });

  it("renders settled affirmative state when user has groups but zero debt", () => {
    seedStore([snapshot({ balances: [] })]);
    render(<DashboardContent />);

    expect(screen.getByText("Tudo em dia por aqui")).toBeInTheDocument();
    expect(screen.getByText("Nenhuma pendência no momento.")).toBeInTheDocument();
    expect(document.querySelector("[data-tour='debt-lists']")?.contains(screen.getByText("Tudo em dia por aqui"))).toBe(true);
  });

  it("renders debt lists when debts exist", () => {
    // Single-direction fixture: only owes
    seedStore([
      snapshot({
        balances: [
          { kind: "user", participantId: me.id, netCents: -5000 },
          { kind: "user", participantId: carol.id, netCents: 5000 },
        ],
      }),
    ]);
    const { unmount } = render(<DashboardContent />);

    expect(screen.getByRole("heading", { name: "A pagar" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "A receber" })).not.toBeInTheDocument();
    expect(screen.queryByText("Comece por aqui")).not.toBeInTheDocument();
    expect(screen.queryByText("Tudo em dia por aqui")).not.toBeInTheDocument();

    unmount();

    // Two-direction fixture: both owes and owed
    seedStore([
      snapshot({
        balances: [
          { kind: "user", participantId: me.id, netCents: -5000 },
          { kind: "user", participantId: carol.id, netCents: 5000 },
        ],
      }),
      snapshot({
        group: { id: "g2", name: "Almoço" },
        members: [
          { groupId: "g2", userId: me.id, status: "accepted", invitedBy: null, acceptedAt: null, user: me },
          { groupId: "g2", userId: dave.id, status: "accepted", invitedBy: null, acceptedAt: null, user: dave },
        ],
        balances: [
          { kind: "user", participantId: me.id, netCents: 3000 },
          { kind: "user", participantId: dave.id, netCents: -3000 },
        ],
      }),
    ]);
    render(<DashboardContent />);

    expect(screen.getByRole("heading", { name: "A pagar" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A receber" })).toBeInTheDocument();
  });

  it("renders up to 3 recent bills with Ver todas link when bills exist", () => {
    seedStore([
      snapshot({
        group: { id: "g1", name: "Praia" },
        balances: [
          { kind: "user", participantId: me.id, netCents: -5000 },
          { kind: "user", participantId: carol.id, netCents: 5000 },
        ],
      }),
    ]);
    useAppStore.setState({
      expenses: {
        "e1": { id: "e1", groupId: "g1", creatorId: me.id, status: "active", occurredOn: "2026-09-10", createdAt: "2026-09-10T00:00:00Z", versionNo: 1, title: "Churrasco", merchantName: null, expenseType: "single_amount", totalCents: 23690, myShareCents: 7897, myPaidCents: 23690, participantCount: 3 },
        "e2": { id: "e2", groupId: "g1", creatorId: me.id, status: "deleted", occurredOn: "2026-09-11", createdAt: "2026-09-11T00:00:00Z", versionNo: 1, title: "Cancelado", merchantName: null, expenseType: "single_amount", totalCents: 4850, myShareCents: 2425, myPaidCents: 0, participantCount: 2 },
        "e3": { id: "e3", groupId: "g1", creatorId: me.id, status: "active", occurredOn: "2026-09-12", createdAt: "2026-09-12T00:00:00Z", versionNo: 1, title: "Uber", merchantName: null, expenseType: "single_amount", totalCents: 4850, myShareCents: 2425, myPaidCents: 0, participantCount: 2 },
        "e4": { id: "e4", groupId: "g1", creatorId: me.id, status: "active", occurredOn: "2026-09-13", createdAt: "2026-09-13T00:00:00Z", versionNo: 1, title: "Padaria", merchantName: null, expenseType: "single_amount", totalCents: 2000, myShareCents: 1000, myPaidCents: 2000, participantCount: 2 },
        "e5": { id: "e5", groupId: "g1", creatorId: me.id, status: "active", occurredOn: "2026-09-14", createdAt: "2026-09-14T00:00:00Z", versionNo: 1, title: "Cinema", merchantName: null, expenseType: "single_amount", totalCents: 6000, myShareCents: 3000, myPaidCents: 6000, participantCount: 2 },
      },
      myExpenses: { ids: ["e1", "e2", "e3", "e4", "e5"], cursor: null, complete: true, total: 5 },
    });
    render(<DashboardContent />);

    expect(screen.getByText("Contas recentes")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver todas" })).toHaveAttribute("href", "/app/bills");
    expect(screen.getByText("Churrasco")).toBeInTheDocument();
    expect(screen.getByText("Uber")).toBeInTheDocument();
    expect(screen.getByText("Padaria")).toBeInTheDocument();
    expect(screen.queryByText("Cancelado")).not.toBeInTheDocument();
    expect(screen.queryByText("Cinema")).not.toBeInTheDocument();
  });

  it("does not render Contas recentes section when myExpenses is empty", () => {
    useAppStore.setState({ hydrated: true, me, groups: {}, groupOrder: [] });
    render(<DashboardContent />);

    expect(screen.queryByText("Contas recentes")).not.toBeInTheDocument();
  });

  it("keeps the skeleton visible before hydration", () => {
    useAppStore.setState({ hydrated: false, me });
    render(<DashboardContent />);

    expect(screen.queryByText("Oi, Alice")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("matches net and direction totals to the displayed debt rows", () => {
    seedStore([
      snapshot({
        balances: [
          { kind: "user", participantId: me.id, netCents: -5000 },
          { kind: "user", participantId: carol.id, netCents: 5000 },
        ],
      }),
      snapshot({
        group: { id: "g2", name: "Almoço" },
        members: [
          { groupId: "g2", userId: me.id, status: "accepted", invitedBy: null, acceptedAt: null, user: me },
          { groupId: "g2", userId: dave.id, status: "accepted", invitedBy: null, acceptedAt: null, user: dave },
        ],
        balances: [
          { kind: "user", participantId: me.id, netCents: 3000 },
          { kind: "user", participantId: dave.id, netCents: -3000 },
        ],
      }),
    ]);
    render(<DashboardContent />);

    expect(screen.getByText("Oi, Alice")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Seu perfil" })).toHaveAttribute("href", "/app/profile");
    expect(screen.getByText("Saldo geral")).toBeInTheDocument();
    expect(screen.getByText(/20,00/)).toBeInTheDocument();
    expect(screen.getAllByText(/50,00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/30,00/).length).toBeGreaterThan(0);
  });

  it("opens the pay Pix flow from a payable row and records its direction", async () => {
    mutations.recordSettlement.mockResolvedValue({});
    seedStore([
      snapshot({
        balances: [
          { kind: "user", participantId: me.id, netCents: -5000 },
          { kind: "user", participantId: carol.id, netCents: 5000 },
        ],
      }),
    ]);
    render(<DashboardContent />);

    fireEvent.click(screen.getByRole("button", { name: /Carol Souza, você deve/ }));
    fireEvent.click(screen.getByRole("button", { name: "Pagar via Pix" }));

    await waitFor(() => expect(pixProps.current).not.toBeNull());
    expect(pixProps.current?.recipientUserId).toBe(carol.id);
    expect(pixProps.current?.groupId).toBe("g1");
    expect(pixProps.current?.recipientName).toBe(carol.name);
    expect(pixProps.current?.amountCents).toBe(5000);
    expect(pixProps.current?.mode).toBe("pay");

    const onMarkPaid = pixProps.current?.onMarkPaid as (cents: number) => Promise<void>;
    await onMarkPaid(3000);
    expect(mutations.recordSettlement).toHaveBeenCalledWith({
      groupId: "g1",
      fromUserId: me.id,
      toUserId: carol.id,
      amountCents: 3000,
    });
  });

  it("opens collect Pix with the viewer as merchant", async () => {
    seedStore([
      snapshot({
        balances: [
          { kind: "user", participantId: me.id, netCents: 5000 },
          { kind: "user", participantId: carol.id, netCents: -5000 },
        ],
      }),
    ]);
    render(<DashboardContent />);

    fireEvent.click(screen.getByRole("button", { name: /Carol Souza, te deve/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cobrar via Pix" }));

    await waitFor(() => expect(pixProps.current).not.toBeNull());
    expect(pixProps.current?.recipientUserId).toBe(me.id);
    expect(pixProps.current?.groupId).toBe("g1");
    expect(pixProps.current?.amountCents).toBe(5000);
    expect(pixProps.current?.mode).toBe("collect");
  });

  it("exposes nudge and quick charge from a receivable dialog", async () => {
    groupMutations.sendNudge.mockResolvedValue({
      ack: { groupId: "g1", ledgerVersion: 1, eventId: 10 },
      delivery: "delivered",
    });
    seedStore([
      snapshot({
        balances: [
          { kind: "user", participantId: me.id, netCents: 5000 },
          { kind: "user", participantId: carol.id, netCents: -5000 },
        ],
      }),
    ], meWithPixKey);
    render(<DashboardContent />);

    fireEvent.click(screen.getByRole("button", { name: /Carol Souza, te deve/ }));
    expect(screen.getByRole("button", { name: "Cobrar via Pix" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lembrar" }));
    await waitFor(() => {
      expect(groupMutations.sendNudge).toHaveBeenCalledWith("g1", carol.id);
      expect(toastSuccess).toHaveBeenCalledWith("Lembrete enviado");
    });
  });

  it("opens quick charge from the home actions when a Pix key exists", async () => {
    seedStore([snapshot()], meWithPixKey);
    render(<DashboardContent />);

    fireEvent.click(screen.getByRole("button", { name: "Cobrar rápido" }));
    await waitFor(() => expect(quickProps.current?.open).toBe(true));
  });

  it("does not claim success when the nudge reached nobody", async () => {
    groupMutations.sendNudge.mockResolvedValue({
      ack: { groupId: "g1", ledgerVersion: 1, eventId: 11 },
      delivery: "failed",
    });
    seedStore([
      snapshot({
        balances: [
          { kind: "user", participantId: me.id, netCents: 5000 },
          { kind: "user", participantId: carol.id, netCents: -5000 },
        ],
      }),
    ], meWithPixKey);
    render(<DashboardContent />);

    fireEvent.click(screen.getByRole("button", { name: /Carol Souza, te deve/ }));
    fireEvent.click(screen.getByRole("button", { name: "Lembrar" }));

    await waitFor(() => {
      expect(groupMutations.sendNudge).toHaveBeenCalledWith("g1", carol.id);
    });
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  it("disables quick charge without a Pix key", () => {
    seedStore([
      snapshot({
        balances: [
          { kind: "user", participantId: me.id, netCents: 5000 },
          { kind: "user", participantId: carol.id, netCents: -5000 },
        ],
      }),
    ]);
    render(<DashboardContent />);

    expect(screen.getByRole("button", { name: "Cobrar rápido" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Carol Souza, te deve/ }));
    expect(screen.getByRole("button", { name: "Cobrar via Pix" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lembrar" })).toBeInTheDocument();
  });

  it("keeps guest rows free of Pix and nudge actions", () => {
    seedStore([
      snapshot({
        balances: [
          { kind: "user", participantId: me.id, netCents: -4000 },
          { kind: "guest", participantId: "guest-1", netCents: 4000 },
        ],
        guests: [{ id: "guest-1", displayName: "Bruno Convidado", expenseId: "e1" }],
      }),
    ]);
    render(<DashboardContent />);

    fireEvent.click(screen.getByRole("button", { name: /Bruno Convidado, você deve/ }));
    expect(screen.getAllByText("Convidado").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Pagar via Pix" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cobrar via Pix" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lembrar" })).not.toBeInTheDocument();
  });

  it("shows invitation count and keeps a failed decline visible", async () => {
    groupMutations.declineInvitation.mockRejectedValue(new LedgerError("network"));
    const invitation = snapshot({
      group: { id: "invite-1", name: "Convite", creatorId: carol.id },
      members: [
        { groupId: "invite-1", userId: me.id, status: "invited", invitedBy: carol.id, acceptedAt: null, user: me },
        { groupId: "invite-1", userId: carol.id, status: "accepted", invitedBy: null, acceptedAt: null, user: carol },
      ],
    });
    seedStore([invitation]);
    useAppStore.setState({
      bootstrapStatus: "ready",
      lastBootstrappedAccountId: me.id,
    });
    render(
      <AppShell>
        <DashboardContent />
      </AppShell>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Notificações, 1 não lidas" }));
    expect(await screen.findByText("Convite · Convite")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Recusar convite para Convite" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Sem conexão. Tente de novo quando a internet voltar."));
    expect(screen.getByText("Convite · Convite")).toBeInTheDocument();
    expect(groupMutations.declineInvitation).toHaveBeenCalledWith("invite-1");
  });
});
