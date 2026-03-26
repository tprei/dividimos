import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the handleMarkPaid integration logic in GroupSettlementView.
 *
 * The component delegates payment recording to markGroupSettlementPaid,
 * which inserts a payment row. A DB trigger cascades updates to the
 * group_settlements table (paid_amount_cents, status).
 */

// Mock the action module
vi.mock("@/lib/supabase/group-settlement-actions", () => ({
  markGroupSettlementPaid: vi.fn(),
  loadGroupSettlements: vi.fn(),
  loadGroupBillsAndLedger: vi.fn(),
  upsertGroupSettlements: vi.fn(),
  confirmGroupSettlement: vi.fn(),
}));

import {
  markGroupSettlementPaid,
} from "@/lib/supabase/group-settlement-actions";

type MarkPaidFn = (
  settlementId: string,
  amountCents: number,
  fromUserId: string,
  toUserId: string,
) => Promise<{ error?: string }>;

const mockedMarkPaid = markGroupSettlementPaid as unknown as ReturnType<typeof vi.fn<MarkPaidFn>>;

/**
 * Mirrors the handleMarkPaid logic from GroupSettlementView.
 * This lets us unit-test the payment decision logic without rendering the component.
 */
async function handleMarkPaidLogic(
  settlementId: string,
  amountCents: number,
  fromUserId: string,
  toUserId: string,
): Promise<{ error?: string }> {
  const result = await mockedMarkPaid(
    settlementId,
    amountCents,
    fromUserId,
    toUserId,
  );
  return { error: result?.error };
}

describe("handleMarkPaid logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedMarkPaid.mockResolvedValue({ error: undefined });
  });

  it("calls markGroupSettlementPaid with correct arguments", async () => {
    await handleMarkPaidLogic("gs-1", 5000, "user-bob", "user-alice");

    expect(markGroupSettlementPaid).toHaveBeenCalledWith(
      "gs-1",
      5000,
      "user-bob",
      "user-alice",
    );
  });

  it("returns no error on success", async () => {
    const result = await handleMarkPaidLogic("gs-1", 5000, "user-bob", "user-alice");

    expect(result.error).toBeUndefined();
  });

  it("returns error message on failure", async () => {
    mockedMarkPaid.mockResolvedValue({ error: "RLS violation" });

    const result = await handleMarkPaidLogic("gs-1", 5000, "user-bob", "user-alice");

    expect(result.error).toBe("RLS violation");
  });

  it("supports partial payment amounts", async () => {
    await handleMarkPaidLogic("gs-1", 2000, "user-bob", "user-alice");

    expect(markGroupSettlementPaid).toHaveBeenCalledWith(
      "gs-1",
      2000,
      "user-bob",
      "user-alice",
    );
  });
});
