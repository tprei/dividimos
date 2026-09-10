import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import toast from "react-hot-toast";
import { CounterpartyDialog } from "./counterparty-dialog";
import type { DebtRow } from "@/lib/ledger/debt-rows";
import { LedgerError } from "@/lib/sync/errors";
import { refreshExpense } from "@/lib/sync/refresh";
import { useAppStore } from "@/stores/app-store";
import type { ExpenseDetail, GroupSnapshot, Me } from "@/types/ledger";

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/sync/refresh", () => ({
  refreshExpense: vi.fn(),
}));

const inviteProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("@/components/expense/guest-invite-dialog", () => ({
  GuestInviteDialog: (props: Record<string, unknown>) => {
    inviteProps.current = props;
    return <div data-testid="guest-invite-stub" />;
  },
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

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

function snapshot(): GroupSnapshot {
  return {
    group: {
      id: "g1",
      kind: "group",
      name: "Thiago e lucas",
      creatorId: me.id,
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: 1,
      createdAt: "2026-01-01T00:00:00Z",
    },
    members: [
      { groupId: "g1", userId: me.id, status: "accepted", invitedBy: null, acceptedAt: null, user: me },
      { groupId: "g1", userId: carol.id, status: "accepted", invitedBy: null, acceptedAt: null, user: carol },
    ],
    balances: [],
    guests: [{ id: "guest-1", displayName: "Lucas", expenseId: "exp-1" }],
    settlements: [],
    recentExpenses: [],
    expenseCount: 1,
    lastEventId: 0,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-09-01T00:00:00Z",
    pairwiseEdges: [],
  };
}

function expenseDetail(): ExpenseDetail {
  return {
    expense: {
      id: "exp-1",
      groupId: "g1",
      creatorId: me.id,
      status: "active",
      currentVersionNo: 1,
      occurredOn: "2026-09-01",
      createdAt: "2026-09-01T12:00:00Z",
      deletedAt: null,
      deletedBy: null,
    },
    current: {
      expenseId: "exp-1",
      versionNo: 1,
      authorId: me.id,
      createdAt: "2026-09-01T12:00:00Z",
      payload: { items: [], participants: [], shares: [], payers: [], itemAssignments: null },
      changeSummary: null,
      occurredOn: "2026-09-01",
      title: "Churrasco",
      merchantName: null,
      expenseType: "single_amount",
      totalCents: 1000,
      serviceFeeBasisPoints: 0,
      fixedFeeCents: 0,
    },
    versions: [],
    participants: [
      {
        participantIndex: 0,
        kind: "guest",
        shareCents: 302,
        paidCents: 0,
        user: null,
        guest: { id: "guest-1", displayName: "Lucas", claimedBy: null, claimLinkGeneration: 1 },
      },
    ],
    group: { id: "g1", name: "Thiago e lucas", kind: "group" },
  };
}

const guestRow: DebtRow = {
  groupId: "g1",
  groupName: "Thiago e lucas",
  isDm: false,
  counterpartyKind: "guest",
  counterpartyId: "guest-1",
  counterpartyName: "lucas",
  counterpartyAvatarUrl: null,
  amountCents: 302,
  direction: "owed",
};

const userRow: DebtRow = {
  groupId: "g1",
  groupName: "Thiago e lucas",
  isDm: false,
  counterpartyKind: "user",
  counterpartyId: carol.id,
  counterpartyName: carol.name,
  counterpartyAvatarUrl: null,
  amountCents: 500,
  direction: "owed",
};

function renderDialog(row: DebtRow) {
  const user = userEvent.setup();
  const handlers = {
    onClose: vi.fn(),
    onPay: vi.fn(),
    onCollect: vi.fn(),
    onNudge: vi.fn(),
    onQuickCharge: vi.fn(),
  };
  render(
    <CounterpartyDialog
      row={row}
      meId={me.id}
      open
      onClose={handlers.onClose}
      onPay={handlers.onPay}
      onCollect={handlers.onCollect}
      onNudge={handlers.onNudge}
      onQuickCharge={handlers.onQuickCharge}
      canQuickCharge
    />,
  );
  return { user, ...handlers };
}

describe("CounterpartyDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inviteProps.current = null;
    useAppStore.getState().reset();
    useAppStore.setState({
      me,
      groups: { g1: snapshot() },
      expenseDetails: { "exp-1": expenseDetail() },
    });
    vi.mocked(refreshExpense).mockResolvedValue(undefined);
  });

  it("exposes an invite action for a guest counterparty that opens the invite dialog", async () => {
    const { user } = renderDialog(guestRow);

    await user.click(screen.getByRole("button", { name: "Convidar" }));

    expect(refreshExpense).toHaveBeenCalledWith("exp-1");
    await waitFor(() => expect(inviteProps.current).not.toBeNull());
    expect(inviteProps.current?.guest).toEqual({
      id: "guest-1",
      displayName: "Lucas",
      claimedBy: null,
      claimLinkGeneration: 1,
    });
    expect(inviteProps.current?.shareCents).toBe(302);
    expect(inviteProps.current?.expenseTitle).toBe("Churrasco");
    expect(inviteProps.current?.expenseId).toBe("exp-1");
  });

  it("does not expose an invite action for a registered counterparty", () => {
    renderDialog(userRow);

    expect(screen.queryByRole("button", { name: "Convidar" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cobrar via Pix" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir conversa" })).toBeInTheDocument();
  });

  it("reports a failure to load the guest invite", async () => {
    vi.mocked(refreshExpense).mockRejectedValueOnce(new LedgerError("network"));
    const { user } = renderDialog(guestRow);

    await user.click(screen.getByRole("button", { name: "Convidar" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(inviteProps.current).toBeNull();
  });
});
