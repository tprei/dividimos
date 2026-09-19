import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SettlementDetailSheet } from "./settlement-detail-sheet";
import { refreshSettlement } from "@/lib/sync/refresh";
import { settlementReadKey, useAppStore, type ResourceReadState } from "@/stores/app-store";
import type { GroupSnapshot, Settlement } from "@/types/ledger";
vi.mock("@/lib/sync/refresh", () => ({
  refreshSettlement: vi.fn().mockResolvedValue(undefined),
}));
const viewerId = "user-c";
const payerId = "user-bob";
const recipientId = "user-alice";
function settlement(overrides: Partial<Settlement> = {}): Settlement {
  return {
    id: "set-1",
    operationId: "op-1",
    groupId: "g1",
    fromUserId: payerId,
    toUserId: recipientId,
    amountCents: 3000,
    status: "confirmed",
    createdBy: payerId,
    createdAt: "2026-09-06T12:00:00.000Z",
    confirmedAt: "2026-09-06T12:00:00.000Z",
    voidedAt: null,
    voidedBy: null,
    ...overrides,
  };
}
function groupSnapshot(): GroupSnapshot {
  const users = [
    [payerId, "bob", "Bob Silva"],
    [recipientId, "alice", "Alice Souza"],
    [viewerId, "carol", "Carol Dias"],
  ] as const;
  return {
    group: {
      id: "g1",
      kind: "group",
      name: "Viagem",
      creatorId: payerId,
      dmUserA: null,
      dmUserB: null,
      ledgerVersion: 7,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    members: users.map(([id, handle, name]) => ({
      groupId: "g1",
      userId: id,
      status: "accepted" as const,
      invitedBy: null,
      acceptedAt: "2026-01-02T00:00:00.000Z",
      user: { id, handle, name, avatarUrl: null, isBot: false },
    })),
    balances: [],
    guests: [],
    settlements: [],
    recentExpenses: [],
    expenseCount: 0,
    lastEventId: 7,
    unreadCount: 0,
    lastMessage: null,
    lastActivityAt: "2026-01-01T00:00:00.000Z",
    pairwiseEdges: [],
  };
}

function seedStore(options: { settlement?: Settlement | null; read?: ResourceReadState } = {}) {
  const id = options.settlement?.id ?? "set-1";
  useAppStore.setState({
    hydrated: true,
    groups: { g1: groupSnapshot() },
    settlementDetails: options.settlement ? { [options.settlement.id]: options.settlement } : {},
    reads: options.read === undefined ? {} : { [settlementReadKey(id)]: options.read },
  });
}

function renderSheet() {
  return render(
    <SettlementDetailSheet
      settlementId="set-1"
      groupId="g1"
      open
      onOpenChange={() => {}}
    />,
  );

}
describe("SettlementDetailSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.getState().reset();
  });

  it("shows payer, recipient, amount and status to a third member", () => {
    seedStore({ settlement: settlement() });
    renderSheet();

    expect(screen.getByTestId("settlement-detail-payer")).toHaveTextContent("Bob Silva");
    expect(screen.getByTestId("settlement-detail-recipient")).toHaveTextContent("Alice Souza");
    expect(screen.getByTestId("settlement-detail-amount")).toHaveTextContent("R$ 30,00");
    expect(screen.getByTestId("settlement-detail-status")).toHaveTextContent("Confirmado");
    expect(screen.queryByRole("button", { name: /Desfazer/i })).not.toBeInTheDocument();
  });

  it("keeps cached detail visible and retries a failed refresh", () => {
    seedStore({ settlement: settlement(), read: { status: "error", code: "network" } });
    renderSheet();

    expect(screen.getByTestId("settlement-detail-stale")).toBeInTheDocument();
    expect(screen.getByTestId("settlement-detail-amount")).toHaveTextContent("R$ 30,00");
    fireEvent.click(screen.getByTestId("settlement-detail-retry"));
    expect(refreshSettlement).toHaveBeenCalledTimes(1);
  });

  it("shows a retry instead of inventing a payment after the first failure", () => {
    seedStore({ settlement: null, read: { status: "error", code: "network" } });
    renderSheet();

    expect(screen.getByTestId("settlement-detail-error")).toBeInTheDocument();
    expect(screen.queryByTestId("settlement-detail-amount")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("settlement-detail-retry"));
    expect(refreshSettlement).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a missing payment from a lost group membership", () => {
    seedStore({ settlement: null, read: { status: "error", code: "settlement_not_found" } });
    renderSheet();
    expect(screen.getByTestId("settlement-detail-unavailable")).toHaveTextContent(
      "Pagamento não encontrado",
    );

    seedStore({ settlement: null, read: { status: "error", code: "not_a_member" } });
    renderSheet();
    expect(screen.getAllByTestId("settlement-detail-unavailable").at(-1)).toHaveTextContent(
      "Pagamento indisponível",
    );
  });

  it("marks a cached detail as updating while a fresh read runs", () => {
    seedStore({ settlement: settlement(), read: { status: "loading" } });
    renderSheet();

    expect(screen.getByTestId("settlement-detail-updating")).toBeInTheDocument();
    expect(screen.getByTestId("settlement-detail-amount")).toHaveTextContent("R$ 30,00");
    expect(refreshSettlement).not.toHaveBeenCalled();
  });
});
