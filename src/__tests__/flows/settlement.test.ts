import { describe, it, expect, beforeEach } from "vitest";
import { useBillStore, computeEdgesFromShares } from "@/stores/bill-store";
import { userAlice, userBob, userCarlos } from "@/test/fixtures";
import type { LedgerEntry } from "@/types";

/** Helper: convert DebtEdge[] into LedgerEntry[] for settlement tests. */
function edgesToLedger(
  edges: ReturnType<typeof computeEdgesFromShares>,
  billId: string,
): LedgerEntry[] {
  const now = new Date().toISOString();
  return edges.map((e, i) => ({
    id: `ledger-${billId}-${i}`,
    billId,
    entryType: "debt" as const,
    fromUserId: e.fromUserId,
    toUserId: e.toUserId,
    amountCents: e.amountCents,
    paidAmountCents: 0,
    status: "pending" as const,
    createdAt: now,
  }));
}

describe("Settlement flows", () => {
  beforeEach(() => {
    useBillStore.getState().reset();
    const store = useBillStore.getState();
    store.setCurrentUser(userAlice);
    store.createBill("Test", "single_amount");
    store.updateBill({ totalAmountInput: 9000 });
    store.addParticipant(userBob);
    store.addParticipant(userCarlos);
    store.splitBillEqually(["user-alice", "user-bob", "user-carlos"]);
    store.setPayerFull("user-alice");
    store.computeShares();

    // Build ledger entries from shares so markPaid/recordPayment still work
    const { shares, bill } = useBillStore.getState();
    const edges = computeEdgesFromShares(shares);
    useBillStore.setState({ ledger: edgesToLedger(edges, bill!.id) });
  });

  it("full settlement lifecycle: pending -> settled", () => {
    const { ledger } = useBillStore.getState();
    const bobEntry = ledger.find((e) => e.fromUserId === "user-bob")!;

    expect(bobEntry.status).toBe("pending");
    expect(bobEntry.paidAt).toBeUndefined();

    useBillStore.getState().markPaid(bobEntry.id);
    const updated = useBillStore.getState().ledger.find((e) => e.id === bobEntry.id)!;
    expect(updated.status).toBe("settled");
    expect(updated.paidAt).toBeDefined();

    expect(useBillStore.getState().bill!.status).toBe("partially_settled");
  });

  it("settling all entries -> bill settled", () => {
    const { ledger } = useBillStore.getState();

    for (const entry of ledger) {
      useBillStore.getState().markPaid(entry.id);
    }

    expect(useBillStore.getState().bill!.status).toBe("settled");
  });

  it("settling first entry only -> partially_settled", () => {
    const { ledger } = useBillStore.getState();
    useBillStore.getState().markPaid(ledger[0].id);

    expect(useBillStore.getState().bill!.status).toBe("partially_settled");
  });

  it("ledger entries have correct bill reference", () => {
    const { ledger, bill } = useBillStore.getState();
    for (const entry of ledger) {
      expect(entry.billId).toBe(bill!.id);
    }
  });
});
