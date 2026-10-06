import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GroupSettlementView } from "./group-settlement-view";
import { recordSettlement } from "@/lib/sync/mutations";
import { useAppStore } from "@/stores/app-store";
import type { GroupSnapshot, Me, MutationAck } from "@/types/ledger";

vi.mock("@/lib/sync/mutations", () => ({
  recordSettlement: vi.fn(),
}));

vi.mock("@/hooks/use-haptics", () => ({
  haptics: {
    tap: vi.fn(),
    impact: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    selectionChanged: vi.fn(),
  },
}));

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const groupId = "g-lia-caio";
const meId = "user-1";
const counterpartyId = "user-2";
const debtCents = 6000;

const me: Me = {
  id: meId,
  handle: "lia",
  name: "Lia Costa",
  avatarUrl: null,
  isBot: false,
  email: "lia@example.com",
  pixKeyType: null,
  pixKeyHint: null,
  onboarded: true,
  notificationPreferences: {},
};

function member(userId: string, handle: string, name: string) {
  return {
    groupId,
    userId,
    status: "accepted" as const,
    invitedBy: null,
    acceptedAt: null,
    user: { id: userId, handle, name, avatarUrl: null, isBot: false },
  };
}

function snapshot(overrides: Partial<GroupSnapshot> = {}): GroupSnapshot {
  return {
    group: {
      id: groupId,
      kind: "group",
      name: "Passeio da turma",
      creatorId: counterpartyId,
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: 3,
      createdAt: "2026-01-01T00:00:00Z",
    },
    dmCounterparty: null,
    members: [
      member(meId, "lia", "Lia Costa"),
      member(counterpartyId, "caio", "Caio Lima"),
    ],
    balances: [
      { kind: "user", participantId: meId, netCents: -debtCents },
      { kind: "user", participantId: counterpartyId, netCents: debtCents },
    ],
    guests: [],
    settlements: [],
    recentExpenses: [],
    lastEventId: 2,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-02T00:00:00Z",
    expenseCount: 1,
    pairwiseEdges: [
      { fromKind: "user", fromId: meId, toId: counterpartyId, amountCents: debtCents },
    ],
    archivedAt: null,
    formerMembers: [],
    financialHistorySharedAt: null,
    ...overrides,
  };
}

function clearedSnapshot(): GroupSnapshot {
  return snapshot({
    balances: [
      { kind: "user", participantId: meId, netCents: 0 },
      { kind: "user", participantId: counterpartyId, netCents: 0 },
    ],
    pairwiseEdges: [],
  });
}

function seed(snapshotValue: GroupSnapshot) {
  useAppStore.setState({
    hydrated: true,
    me: { ...me },
    groups: { [groupId]: snapshotValue },
    groupOrder: [groupId],
  });
}

beforeEach(() => {
  useAppStore.getState().reset();
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ copiaECola: "pix-payload-6000" }),
  });
});

describe("GroupSettlementView full-payment pending lifecycle", () => {
  it("keeps the real Pix dialog pending through the optimistic settle until the RPC acknowledges", async () => {
    const user = userEvent.setup();
    const deferred = Promise.withResolvers<MutationAck>();
    vi.mocked(recordSettlement).mockImplementation(() => deferred.promise);
    const open = snapshot();
    const cleared = clearedSnapshot();
    seed(open);

    const view = render(
      <GroupSettlementView groupId={groupId} snapshot={open} meId={meId} />,
    );

    const transfers = screen.getByRole("region", { name: "Quem paga quem" });
    await user.click(within(transfers).getByRole("button", { name: /Pagar/ }));

    const registerButton = await waitFor(() => {
      const button = within(screen.getByRole("dialog")).getByRole("button", {
        name: /Registrar pagamento|Já paguei/i,
      });
      expect(button).toBeEnabled();
      return button;
    });

    await user.click(registerButton);

    act(() => {
      seed(cleared);
    });
    view.rerender(
      <GroupSettlementView groupId={groupId} snapshot={cleared} meId={meId} />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      document.querySelector('[data-pix-state="pending"]'),
    ).toBeInTheDocument();
    expect(registerButton).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /fechar|close/i }),
    ).not.toBeInTheDocument();

    await act(async () => {
      deferred.resolve({ groupId, ledgerVersion: 4, eventId: 3 });
    });

    const receipt = screen.getByRole("dialog", { name: "Pagamento registrado" });
    expect(within(receipt).getByText("R$ 60,00")).toBeInTheDocument();
    const closeButton = within(receipt).getByRole("button", { name: "Fechar" });
    expect(closeButton).toBeEnabled();

    await user.click(closeButton);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
