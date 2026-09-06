import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GroupSnapshot, Me } from "@/types/ledger";
import { useAppStore } from "@/stores/app-store";
import { LedgerError } from "@/lib/sync/errors";

const mutations = vi.hoisted(() => ({
  confirmSettlement: vi.fn(),
  recordSettlement: vi.fn(),
  voidSettlement: vi.fn(),
}));
vi.mock("@/lib/sync/mutations", () => mutations);

const groupMutations = vi.hoisted(() => ({
  sendNudge: vi.fn(),
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
    return null;
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { DashboardContent } from "./dashboard-content";

const me: Me = {
  id: "user-1",
  handle: "alice",
  name: "Alice Souza",
  avatarUrl: null,
  email: "alice@example.com",
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: true,
  notificationPreferences: {},
};

const carol = { id: "user-2", handle: "carol", name: "Carol Souza", avatarUrl: null };
const dave = { id: "user-3", handle: "dave", name: "Dave Lima", avatarUrl: null };

function settlement(overrides: Partial<GroupSnapshot["pendingSettlements"][number]> = {}) {
  return {
    id: "set-1",
    operationId: "op-1",
    groupId: "g1",
    fromUserId: carol.id,
    toUserId: me.id,
    amountCents: 3000,
    status: "pending" as const,
    createdBy: carol.id,
    createdAt: "2026-01-01T00:00:00Z",
    confirmedAt: null,
    voidedAt: null,
    voidedBy: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<GroupSnapshot> = {}): GroupSnapshot {
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
    pendingSettlements: [],
    recentExpenses: [],
    lastEventId: 0,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-02T00:00:00Z",
  };
  return { ...base, ...overrides, group: { ...base.group, ...overrides.group } };
}

function seedStore(snapshots: GroupSnapshot[]) {
  const groups = Object.fromEntries(snapshots.map((s) => [s.group.id, s]));
  useAppStore.setState({ hydrated: true, me, groups, groupOrder: snapshots.map((s) => s.group.id) });
}

describe("DashboardContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pixProps.current = null;
    useAppStore.getState().reset();
  });

  it("renders the skeleton before hydration", () => {
    useAppStore.setState({ hydrated: false, me });
    render(<DashboardContent />);

    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("renders the greeting and the net balance across debt rows", () => {
    seedStore([
      snapshot({
        balances: [
          { kind: "user", participantId: me.id, netCents: -3000 },
          { kind: "user", participantId: carol.id, netCents: 3000 },
        ],
      }),
    ]);
    render(<DashboardContent />);

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("A pagar")).toBeInTheDocument();
    expect(screen.getAllByText("R$ 30,00").length).toBeGreaterThan(0);
  });

  it("confirms an incoming pending settlement", async () => {
    mutations.confirmSettlement.mockResolvedValue({});
    seedStore([
      snapshot({ pendingSettlements: [settlement({ fromUserId: carol.id, toUserId: me.id })] }),
    ]);
    render(<DashboardContent />);

    fireEvent.click(screen.getByRole("button", { name: /confirmar/i }));

    await waitFor(() => {
      expect(mutations.confirmSettlement).toHaveBeenCalledWith("g1", "set-1");
    });
  });

  it("declines an incoming pending settlement with voidSettlement", async () => {
    mutations.voidSettlement.mockResolvedValue({});
    seedStore([
      snapshot({ pendingSettlements: [settlement({ fromUserId: carol.id, toUserId: me.id })] }),
    ]);
    render(<DashboardContent />);

    fireEvent.click(screen.getByRole("button", { name: /recusar/i }));

    await waitFor(() => {
      expect(mutations.voidSettlement).toHaveBeenCalledWith("g1", "set-1", false);
    });
  });

  it("shows a toast when confirming fails", async () => {
    mutations.confirmSettlement.mockRejectedValue(new LedgerError("network"));
    seedStore([
      snapshot({ pendingSettlements: [settlement({ fromUserId: carol.id, toUserId: me.id })] }),
    ]);
    render(<DashboardContent />);

    fireEvent.click(screen.getByRole("button", { name: /confirmar/i }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("Sem conexão. Tente de novo quando a internet voltar.");
    });
  });

  it("lets me cancel an outgoing pending settlement", async () => {
    mutations.voidSettlement.mockResolvedValue({});
    seedStore([
      snapshot({ pendingSettlements: [settlement({ fromUserId: me.id, toUserId: dave.id })] }),
    ]);
    render(<DashboardContent />);

    expect(screen.getByText("Aguardando confirmação")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /cancelar/i }));

    await waitFor(() => {
      expect(mutations.voidSettlement).toHaveBeenCalledWith("g1", "set-1", false);
    });
    expect(mutations.confirmSettlement).not.toHaveBeenCalled();
  });

  it("opens the Pix modal in pay mode and records the settlement through it", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Pagar via Pix" }));

    await waitFor(() => {
      expect(pixProps.current).not.toBeNull();
    });
    expect(pixProps.current?.recipientName).toBe("Carol Souza");
    expect(pixProps.current?.amountCents).toBe(5000);
    expect(pixProps.current?.mode).toBe("pay");
    expect(pixProps.current?.pixKey).toBeUndefined();

    const onMarkPaid = pixProps.current?.onMarkPaid as (cents: number) => Promise<void>;
    await onMarkPaid(3000);

    expect(mutations.recordSettlement).toHaveBeenCalledWith({
      groupId: "g1",
      toUserId: carol.id,
      amountCents: 3000,
    });
  });

  it("renders guest debt rows with a chip and no pay action", () => {
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

    expect(screen.getByText("Convidado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pagar via Pix" })).not.toBeInTheDocument();
  });

  it("sends a nudge to a debtor from the Você recebe tab", async () => {
    groupMutations.sendNudge.mockResolvedValue({ groupId: "g1", ledgerVersion: 1, eventId: 10 });
    seedStore([
      snapshot({
        balances: [
          { kind: "user", participantId: me.id, netCents: 5000 },
          { kind: "user", participantId: carol.id, netCents: -5000 },
        ],
      }),
    ]);
    render(<DashboardContent />);

    fireEvent.click(screen.getByRole("button", { name: /você recebe/i }));
    fireEvent.click(screen.getByRole("button", { name: /lembrar/i }));

    await waitFor(() => {
      expect(groupMutations.sendNudge).toHaveBeenCalledWith("g1", carol.id);
      expect(toastSuccess).toHaveBeenCalledWith("Lembrete enviado");
    });
  });

  it("shows an error toast when sending a nudge fails with cooldown", async () => {
    groupMutations.sendNudge.mockRejectedValue(new LedgerError("nudge_cooldown"));
    seedStore([
      snapshot({
        balances: [
          { kind: "user", participantId: me.id, netCents: 5000 },
          { kind: "user", participantId: carol.id, netCents: -5000 },
        ],
      }),
    ]);
    render(<DashboardContent />);

    fireEvent.click(screen.getByRole("button", { name: /você recebe/i }));
    fireEvent.click(screen.getByRole("button", { name: /lembrar/i }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("Você já lembrou essa pessoa hoje.");
    });
  });
});
