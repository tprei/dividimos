import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the handleMarkPaid integration logic in GroupSettlementView.
 *
 * Since GroupSettlementView is a complex component with realtime subscriptions
 * and dynamic imports, we test the core payment recording logic in isolation
 * by extracting the decision logic into testable scenarios.
 */

// Mock the action module
vi.mock("@/lib/supabase/group-settlement-actions", () => ({
  recordGroupSettlementPayment: vi.fn(),
  markGroupSettlementPaid: vi.fn(),
  loadGroupSettlements: vi.fn(),
  loadGroupBillsAndLedger: vi.fn(),
  upsertGroupSettlements: vi.fn(),
  confirmGroupSettlement: vi.fn(),
}));

import {
  recordGroupSettlementPayment,
  markGroupSettlementPaid,
} from "@/lib/supabase/group-settlement-actions";

interface Settlement {
  id: string;
  fromUserId: string;
  toUserId: string;
  amountCents: number;
  paidAmountCents: number;
}

/**
 * Mirrors the handleMarkPaid logic from GroupSettlementView.
 * This lets us unit-test the payment decision logic without rendering the component.
 */
async function handleMarkPaidLogic(
  settlementId: string,
  amountCents: number,
  settlements: Settlement[],
): Promise<{ action: "error" | "partial" | "full" | "not_found"; error?: string }> {
  const settlement = settlements.find((s) => s.id === settlementId);
  if (!settlement) return { action: "not_found" };

  const { error } = await (recordGroupSettlementPayment as ReturnType<typeof vi.fn>)(
    settlementId,
    settlement.fromUserId,
    settlement.toUserId,
    amountCents,
  );

  if (error) return { action: "error", error };

  const remainingAfterPayment = settlement.amountCents - settlement.paidAmountCents - amountCents;
  if (remainingAfterPayment <= 0) {
    await (markGroupSettlementPaid as ReturnType<typeof vi.fn>)(settlementId);
    return { action: "full" };
  }

  return { action: "partial" };
}

const mockSettlements: Settlement[] = [
  {
    id: "gs-1",
    fromUserId: "user-bob",
    toUserId: "user-alice",
    amountCents: 5000,
    paidAmountCents: 0,
  },
  {
    id: "gs-2",
    fromUserId: "user-bob",
    toUserId: "user-alice",
    amountCents: 5000,
    paidAmountCents: 2000,
  },
];

describe("handleMarkPaid logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(recordGroupSettlementPayment).mockResolvedValue({ error: undefined });
    vi.mocked(markGroupSettlementPaid).mockResolvedValue(undefined);
  });

  it("records payment and marks as paid_unconfirmed for full payment", async () => {
    const result = await handleMarkPaidLogic("gs-1", 5000, mockSettlements);

    expect(result.action).toBe("full");
    expect(recordGroupSettlementPayment).toHaveBeenCalledWith(
      "gs-1",
      "user-bob",
      "user-alice",
      5000,
    );
    expect(markGroupSettlementPaid).toHaveBeenCalledWith("gs-1");
  });

  it("records payment without marking paid for partial payment", async () => {
    const result = await handleMarkPaidLogic("gs-1", 2000, mockSettlements);

    expect(result.action).toBe("partial");
    expect(recordGroupSettlementPayment).toHaveBeenCalledWith(
      "gs-1",
      "user-bob",
      "user-alice",
      2000,
    );
    expect(markGroupSettlementPaid).not.toHaveBeenCalled();
  });

  it("considers existing paidAmountCents when determining full payment", async () => {
    // gs-2 has 2000 already paid of 5000 total, so 3000 remaining
    const result = await handleMarkPaidLogic("gs-2", 3000, mockSettlements);

    expect(result.action).toBe("full");
    expect(markGroupSettlementPaid).toHaveBeenCalledWith("gs-2");
  });

  it("treats partial payment on partially-paid settlement correctly", async () => {
    // gs-2 has 2000 already paid of 5000 total, paying 1000 more leaves 2000
    const result = await handleMarkPaidLogic("gs-2", 1000, mockSettlements);

    expect(result.action).toBe("partial");
    expect(markGroupSettlementPaid).not.toHaveBeenCalled();
  });

  it("returns not_found when settlement does not exist", async () => {
    const result = await handleMarkPaidLogic("gs-nonexistent", 1000, mockSettlements);

    expect(result.action).toBe("not_found");
    expect(recordGroupSettlementPayment).not.toHaveBeenCalled();
    expect(markGroupSettlementPaid).not.toHaveBeenCalled();
  });

  it("returns error and does not mark as paid when recording fails", async () => {
    vi.mocked(recordGroupSettlementPayment).mockResolvedValue({ error: "RLS violation" });

    const result = await handleMarkPaidLogic("gs-1", 5000, mockSettlements);

    expect(result.action).toBe("error");
    expect(result.error).toBe("RLS violation");
    expect(markGroupSettlementPaid).not.toHaveBeenCalled();
  });

  it("marks as full when payment covers more than remaining", async () => {
    // gs-2 has 3000 remaining, paying 4000 should still mark as full
    const result = await handleMarkPaidLogic("gs-2", 4000, mockSettlements);

    expect(result.action).toBe("full");
    expect(markGroupSettlementPaid).toHaveBeenCalledWith("gs-2");
  });
});
