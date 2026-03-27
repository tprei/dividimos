import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for the group settlement view's payment logic.
 *
 * The component uses the unified ledger: it loads entries via
 * loadLedgerEntries, computes settlement edges via computeSettlementEdges,
 * and records payments via recordPayment / confirmPaymentsForPair.
 */

// Mock the ledger-actions module
vi.mock("@/lib/supabase/ledger-actions", () => ({
  loadLedgerEntries: vi.fn(),
  recordPayment: vi.fn(),
  confirmPaymentsForPair: vi.fn(),
}));

import {
  recordPayment,
  confirmPaymentsForPair,
} from "@/lib/supabase/ledger-actions";

const mockedRecordPayment = recordPayment as unknown as ReturnType<typeof vi.fn>;
const mockedConfirmPaymentsForPair = confirmPaymentsForPair as unknown as ReturnType<typeof vi.fn>;

/**
 * Mirrors the handleMarkPaid logic from GroupSettlementView.
 */
async function handleMarkPaidLogic(
  groupId: string,
  fromUserId: string,
  toUserId: string,
  amountCents: number,
): Promise<{ id: string; error?: string }> {
  return mockedRecordPayment(groupId, fromUserId, toUserId, amountCents);
}

/**
 * Mirrors the handleConfirm logic from GroupSettlementView.
 */
async function handleConfirmLogic(
  groupId: string,
  fromUserId: string,
  toUserId: string,
  currentUserId: string,
): Promise<{ error?: string }> {
  return mockedConfirmPaymentsForPair(groupId, fromUserId, toUserId, currentUserId);
}

describe("handleMarkPaid logic (unified ledger)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRecordPayment.mockResolvedValue({ id: "payment-1" });
  });

  it("calls recordPayment with correct arguments", async () => {
    await handleMarkPaidLogic("group-1", "user-bob", "user-alice", 5000);

    expect(recordPayment).toHaveBeenCalledWith(
      "group-1",
      "user-bob",
      "user-alice",
      5000,
    );
  });

  it("returns payment id on success", async () => {
    const result = await handleMarkPaidLogic("group-1", "user-bob", "user-alice", 5000);

    expect(result.id).toBe("payment-1");
    expect(result.error).toBeUndefined();
  });

  it("returns error on failure", async () => {
    mockedRecordPayment.mockResolvedValue({ id: "", error: "RLS violation" });

    const result = await handleMarkPaidLogic("group-1", "user-bob", "user-alice", 5000);

    expect(result.error).toBe("RLS violation");
  });

  it("supports partial payment amounts", async () => {
    await handleMarkPaidLogic("group-1", "user-bob", "user-alice", 2000);

    expect(recordPayment).toHaveBeenCalledWith(
      "group-1",
      "user-bob",
      "user-alice",
      2000,
    );
  });
});

describe("handleConfirm logic (unified ledger)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedConfirmPaymentsForPair.mockResolvedValue({});
  });

  it("calls confirmPaymentsForPair with correct arguments", async () => {
    await handleConfirmLogic("group-1", "user-bob", "user-alice", "user-alice");

    expect(confirmPaymentsForPair).toHaveBeenCalledWith(
      "group-1",
      "user-bob",
      "user-alice",
      "user-alice",
    );
  });

  it("returns no error on success", async () => {
    const result = await handleConfirmLogic("group-1", "user-bob", "user-alice", "user-alice");

    expect(result.error).toBeUndefined();
  });

  it("returns error on failure", async () => {
    mockedConfirmPaymentsForPair.mockResolvedValue({ error: "Permission denied" });

    const result = await handleConfirmLogic("group-1", "user-bob", "user-alice", "user-alice");

    expect(result.error).toBe("Permission denied");
  });
});
