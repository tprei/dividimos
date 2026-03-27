import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import toast from "react-hot-toast";
import type { GroupSettlement, User } from "@/types";

// Mock react-hot-toast
vi.mock("react-hot-toast", () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock next/dynamic to pass through
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<{ default: React.ComponentType }>) => {
    let Component: React.ComponentType | null = null;
    loader().then((m) => {
      Component = m.default;
    });
    return function DynamicWrapper(props: Record<string, unknown>) {
      if (!Component) return null;
      return <Component {...props} />;
    };
  },
}));

// Mock PixQrModal since it's dynamically imported
vi.mock("@/components/settlement/pix-qr-modal", () => ({
  PixQrModal: ({ onMarkPaid, onClose }: { onMarkPaid: (amount: number) => void; onClose: () => void; open: boolean }) => (
    <div data-testid="pix-modal">
      <button data-testid="mark-paid-btn" onClick={() => onMarkPaid(1000)}>
        Mark Paid
      </button>
      <button data-testid="close-modal-btn" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

// Mock supabase client
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
    removeChannel: vi.fn(),
  }),
}));

const mockMarkGroupSettlementPaid = vi.fn();
const mockLoadGroupSettlements = vi.fn();
const mockSyncGroupSettlements = vi.fn();
const mockLoadGroupBillsAndLedger = vi.fn();

vi.mock("@/lib/supabase/group-settlement-actions", () => ({
  markGroupSettlementPaid: (...args: unknown[]) => mockMarkGroupSettlementPaid(...args),
  loadGroupSettlements: (...args: unknown[]) => mockLoadGroupSettlements(...args),
  syncGroupSettlements: (...args: unknown[]) => mockSyncGroupSettlements(...args),
  loadGroupBillsAndLedger: (...args: unknown[]) => mockLoadGroupBillsAndLedger(...args),
}));

vi.mock("@/lib/group-settlement", () => ({
  computeGroupNetEdges: () => [],
}));

vi.mock("@/lib/simplify", () => ({
  simplifyDebts: () => ({ originalEdges: [], simplifiedEdges: [], originalCount: 0, simplifiedCount: 0, steps: [] }),
}));

const participants: User[] = [
  { id: "user-1", name: "Alice", handle: "alice", email: "a@t.co", pixKeyType: "email", pixKeyHint: "", onboarded: true, createdAt: "" },
  { id: "user-2", name: "Bob", handle: "bob", email: "b@t.co", pixKeyType: "email", pixKeyHint: "", onboarded: true, createdAt: "" },
];

const pendingSettlements: GroupSettlement[] = [
  {
    id: "s-1",
    groupId: "g-1",
    fromUserId: "user-1",
    toUserId: "user-2",
    amountCents: 5000,
    paidAmountCents: 0,
    status: "pending",
    createdAt: "2026-01-01",
  },
];

const twoPendingSettlements: GroupSettlement[] = [
  ...pendingSettlements,
  {
    id: "s-2",
    groupId: "g-1",
    fromUserId: "user-1",
    toUserId: "user-2",
    amountCents: 3000,
    paidAmountCents: 0,
    status: "pending",
    createdAt: "2026-01-01",
  },
];

describe("GroupSettlementView error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadGroupBillsAndLedger.mockResolvedValue({ bills: [], ledger: [], participants: [] });
    mockSyncGroupSettlements.mockResolvedValue(pendingSettlements);
    mockLoadGroupSettlements.mockResolvedValue(pendingSettlements);
  });

  it("shows error toast when handleMarkPaid fails", async () => {
    mockMarkGroupSettlementPaid.mockResolvedValue({ error: "invalid input syntax for type uuid" });

    const { GroupSettlementView } = await import("./group-settlement-view");
    render(
      <GroupSettlementView groupId="g-1" participants={participants} currentUserId="user-1" />,
    );

    // Wait for loading to finish
    await waitFor(() => {
      expect(screen.queryByText("Tudo liquidado!")).not.toBeInTheDocument();
    });

    // Click "Pagar via Pix" button
    const payBtn = await screen.findByText("Pagar via Pix");
    await userEvent.click(payBtn);

    // Click mark paid in the modal
    const markPaidBtn = await screen.findByTestId("mark-paid-btn");
    await userEvent.click(markPaidBtn);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Erro ao registrar pagamento");
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("shows success toast when handleMarkPaid succeeds", async () => {
    mockMarkGroupSettlementPaid.mockResolvedValue({ paymentId: "pay-1" });
    // After payment, settlements refresh to empty (settled)
    mockLoadGroupSettlements.mockResolvedValue([]);

    const { GroupSettlementView } = await import("./group-settlement-view");
    render(
      <GroupSettlementView groupId="g-1" participants={participants} currentUserId="user-1" />,
    );

    const payBtn = await screen.findByText("Pagar via Pix");
    await userEvent.click(payBtn);

    const markPaidBtn = await screen.findByTestId("mark-paid-btn");
    await userEvent.click(markPaidBtn);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Pagamento registrado");
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("shows error toast when all payments in handleSettleAll fail", async () => {
    mockSyncGroupSettlements.mockResolvedValue(twoPendingSettlements);
    mockLoadGroupSettlements.mockResolvedValue(twoPendingSettlements);
    mockMarkGroupSettlementPaid.mockResolvedValue({ error: "invalid uuid" });

    const { GroupSettlementView } = await import("./group-settlement-view");
    render(
      <GroupSettlementView groupId="g-1" participants={participants} currentUserId="user-1" />,
    );

    const settleAllBtn = await screen.findByText(/Liquidar tudo/);
    await userEvent.click(settleAllBtn);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Erro ao registrar pagamentos");
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("shows partial failure toast when some payments in handleSettleAll fail", async () => {
    mockSyncGroupSettlements.mockResolvedValue(twoPendingSettlements);
    mockLoadGroupSettlements.mockResolvedValue(twoPendingSettlements);
    mockMarkGroupSettlementPaid
      .mockResolvedValueOnce({ paymentId: "pay-1" })
      .mockResolvedValueOnce({ error: "invalid uuid" });

    const { GroupSettlementView } = await import("./group-settlement-view");
    render(
      <GroupSettlementView groupId="g-1" participants={participants} currentUserId="user-1" />,
    );

    const settleAllBtn = await screen.findByText(/Liquidar tudo/);
    await userEvent.click(settleAllBtn);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("1 de 2 pagamentos falharam");
    });
  });

  it("shows success toast when handleSettleAll succeeds", async () => {
    mockSyncGroupSettlements.mockResolvedValue(twoPendingSettlements);
    mockLoadGroupSettlements.mockResolvedValue(twoPendingSettlements);
    mockMarkGroupSettlementPaid.mockResolvedValue({ paymentId: "pay-1" });

    const { GroupSettlementView } = await import("./group-settlement-view");
    render(
      <GroupSettlementView groupId="g-1" participants={participants} currentUserId="user-1" />,
    );

    const settleAllBtn = await screen.findByText(/Liquidar tudo/);
    await userEvent.click(settleAllBtn);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Todos os pagamentos registrados");
    });
    expect(toast.error).not.toHaveBeenCalled();
  });
});
