import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase, type MockSupabase } from "@/test/mock-supabase";
import {
  userAlice,
  userBob,
  makeItemizedBill,
  makeSingleAmountBill,
  makeBillItem,
  makeExpenseShare,
} from "@/test/fixtures";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/client";
import { syncBillToSupabase } from "./sync-bill";

let mock: MockSupabase;

beforeEach(() => {
  mock = createMockSupabase();
  vi.mocked(createClient).mockReturnValue(mock.client);
});

describe("syncBillToSupabase", () => {
  it("returns error when not authenticated", async () => {
    const result = await syncBillToSupabase({
      bill: makeItemizedBill(),
      participants: [userAlice],
      items: [],
      splits: [],
      billSplits: [],
      shares: [],
    });

    expect(result).toEqual({ error: "Nao autenticado" });
  });

  it("inserts a new itemized bill with all related data including expense_shares", async () => {
    mock.setUser({ id: "user-alice" });

    // bills.insert → returns new bill id
    mock.onTable("bills", { data: { id: "new-bill-1" } });
    // bill_participants.insert
    mock.onTable("bill_participants", { error: null });
    // bill_items.insert (1 item)
    mock.onTable("bill_items", { data: { id: "db-item-1" } });
    // item_splits.insert
    mock.onTable("item_splits", { error: null });
    // bill_payers.insert
    mock.onTable("bill_payers", { error: null });
    // expense_shares.insert
    mock.onTable("expense_shares", { error: null });

    const item = makeBillItem({ id: "local-item-1" });
    const bill = makeItemizedBill({
      status: "active",
      totalAmount: 5500,
      payers: [{ userId: "user-alice", amountCents: 5500 }],
    });

    const result = await syncBillToSupabase({
      bill,
      participants: [userAlice, userBob],
      items: [item],
      splits: [
        {
          id: "split-1",
          itemId: "local-item-1",
          userId: "user-bob",
          splitType: "equal",
          value: 1,
          computedAmountCents: 5000,
        },
      ],
      billSplits: [],
      shares: [
        makeExpenseShare({ userId: "user-alice", paidCents: 5500, owedCents: 500, netCents: 5000 }),
        makeExpenseShare({ userId: "user-bob", paidCents: 0, owedCents: 5000, netCents: -5000 }),
      ],
    });

    expect(result).toEqual({ billId: "new-bill-1" });

    // Verify bill was inserted with correct fields
    const billInserts = mock.findCalls("bills", "insert");
    expect(billInserts).toHaveLength(1);
    expect(billInserts[0].args[0]).toMatchObject({
      creator_id: "user-alice",
      title: "Jantar",
      status: "active",
      total_amount: 5500,
      bill_type: "itemized",
    });

    // Verify participants inserted
    const participantInserts = mock.findCalls("bill_participants", "insert");
    expect(participantInserts).toHaveLength(1);
    expect(participantInserts[0].args[0]).toHaveLength(2);

    // Verify items were batch-inserted
    const itemInserts = mock.findCalls("bill_items", "insert");
    expect(itemInserts).toHaveLength(1);
    const insertedItems = itemInserts[0].args[0] as Record<string, unknown>[];
    expect(insertedItems).toHaveLength(1);
    expect(insertedItems[0]).toMatchObject({
      description: "Pizza",
      unit_price_cents: 5000,
    });

    // Verify item splits
    const splitInserts = mock.findCalls("item_splits", "insert");
    expect(splitInserts).toHaveLength(1);

    // Verify payers
    const payerInserts = mock.findCalls("bill_payers", "insert");
    expect(payerInserts).toHaveLength(1);

    // Verify expense_shares inserted instead of ledger
    const shareInserts = mock.findCalls("expense_shares", "insert");
    expect(shareInserts).toHaveLength(1);
    const insertedShares = shareInserts[0].args[0] as Record<string, unknown>[];
    expect(insertedShares).toHaveLength(2);

    // No ledger inserts
    expect(mock.findCalls("ledger", "insert")).toHaveLength(0);
  });

  it("inserts a new single_amount bill with bill splits and expense_shares", async () => {
    mock.setUser({ id: "user-alice" });

    mock.onTable("bills", { data: { id: "new-bill-2" } });
    mock.onTable("bill_participants", { error: null });
    mock.onTable("bill_splits", { error: null });
    mock.onTable("bill_payers", { error: null });
    mock.onTable("expense_shares", { error: null });

    const bill = makeSingleAmountBill({
      status: "active",
      totalAmount: 10000,
      payers: [{ userId: "user-alice", amountCents: 10000 }],
    });

    const result = await syncBillToSupabase({
      bill,
      participants: [userAlice, userBob],
      items: [],
      splits: [],
      billSplits: [
        {
          userId: "user-bob",
          splitType: "equal",
          value: 1,
          computedAmountCents: 5000,
        },
      ],
      shares: [
        makeExpenseShare({ userId: "user-alice", paidCents: 10000, owedCents: 5000, netCents: 5000 }),
        makeExpenseShare({ userId: "user-bob", paidCents: 0, owedCents: 5000, netCents: -5000 }),
      ],
    });

    expect(result).toEqual({ billId: "new-bill-2" });
    expect(mock.findCalls("bill_splits", "insert")).toHaveLength(1);
    // No item-related inserts for single_amount
    expect(mock.findCalls("bill_items", "insert")).toHaveLength(0);
    // expense_shares inserted
    expect(mock.findCalls("expense_shares", "insert")).toHaveLength(1);
    expect(mock.findCalls("ledger", "insert")).toHaveLength(0);
  });

  it("updates an existing bill when existingBillId is provided", async () => {
    mock.setUser({ id: "user-alice" });

    // Check pending participants → none
    mock.onTable("bill_participants", { data: [] });
    // expense_shares.delete (cleanup)
    mock.onTable("expense_shares", { error: null });
    // bill_items.delete, bill_splits.delete, bill_payers.delete (cleanup)
    mock.onTable("bill_items", { error: null });
    mock.onTable("bill_splits", { error: null });
    mock.onTable("bill_payers", { error: null });
    // bill_payers.insert
    mock.onTable("bill_payers", { error: null });
    // expense_shares.insert
    mock.onTable("expense_shares", { error: null });
    // bills.update
    mock.onTable("bills", { error: null });

    const bill = makeItemizedBill({
      status: "active",
      totalAmount: 5000,
      payers: [{ userId: "user-alice", amountCents: 5000 }],
    });

    const result = await syncBillToSupabase({
      bill,
      participants: [userAlice],
      items: [],
      splits: [],
      billSplits: [],
      shares: [makeExpenseShare()],
      existingBillId: "existing-bill-1",
    });

    expect(result).toEqual({ billId: "existing-bill-1" });
    // Should update, not insert
    expect(mock.findCalls("bills", "update")).toHaveLength(1);
    expect(mock.findCalls("bills", "insert")).toHaveLength(0);
    // Should cleanup expense_shares, not ledger
    expect(mock.findCalls("expense_shares", "delete")).toHaveLength(1);
    expect(mock.findCalls("ledger", "delete")).toHaveLength(0);
  });

  it("returns error when non-group bill has pending participants", async () => {
    mock.setUser({ id: "user-alice" });

    // Pending participants exist
    mock.onTable("bill_participants", {
      data: [{ user_id: "user-bob", status: "invited" }],
    });

    const result = await syncBillToSupabase({
      bill: makeItemizedBill({ status: "active" }),
      participants: [userAlice, userBob],
      items: [],
      splits: [],
      billSplits: [],
      shares: [],
      existingBillId: "existing-bill-1",
    });

    expect(result).toEqual({
      error: "Nem todos os participantes aceitaram o convite",
    });
  });

  it("skips pending check for group bills", async () => {
    mock.setUser({ id: "user-alice" });

    // expense_shares.delete (cleanup)
    mock.onTable("expense_shares", { error: null });
    // bill_items.delete, bill_splits.delete, bill_payers.delete (cleanup)
    mock.onTable("bill_items", { error: null });
    mock.onTable("bill_splits", { error: null });
    mock.onTable("bill_payers", { error: null });
    // bill_payers.insert (empty, no payers in the test bill)
    // expense_shares.insert (empty)
    // bills.update
    mock.onTable("bills", { error: null });

    const result = await syncBillToSupabase({
      bill: makeItemizedBill({ status: "active" }),
      participants: [userAlice],
      items: [],
      splits: [],
      billSplits: [],
      shares: [],
      existingBillId: "existing-bill-1",
      groupId: "group-1",
    });

    expect(result).toEqual({ billId: "existing-bill-1" });
    // Should NOT query bill_participants for pending check
    expect(mock.findCalls("bill_participants", "select")).toHaveLength(0);
  });

  it("returns error when bill insert fails", async () => {
    mock.setUser({ id: "user-alice" });

    mock.onTable("bills", {
      data: null,
      error: { message: "DB constraint violated" },
    });

    const result = await syncBillToSupabase({
      bill: makeItemizedBill(),
      participants: [userAlice],
      items: [],
      splits: [],
      billSplits: [],
      shares: [],
    });

    expect(result).toEqual({ error: "DB constraint violated" });
  });

  it("handles multiple items with their splits", async () => {
    mock.setUser({ id: "user-alice" });

    mock.onTable("bills", { data: { id: "new-bill-3" } });
    mock.onTable("bill_participants", { error: null });
    mock.onTable("bill_items", { error: null });
    mock.onTable("item_splits", { error: null });
    mock.onTable("bill_payers", { error: null });
    mock.onTable("expense_shares", { error: null });

    const item1 = makeBillItem({ id: "item-1", description: "Pizza" });
    const item2 = makeBillItem({
      id: "item-2",
      description: "Cerveja",
      unitPriceCents: 2000,
      totalPriceCents: 2000,
    });

    const result = await syncBillToSupabase({
      bill: makeItemizedBill({
        status: "active",
        totalAmount: 7000,
        payers: [{ userId: "user-alice", amountCents: 7000 }],
      }),
      participants: [userAlice, userBob],
      items: [item1, item2],
      splits: [
        {
          id: "s1",
          itemId: "item-1",
          userId: "user-bob",
          splitType: "equal",
          value: 1,
          computedAmountCents: 5000,
        },
        {
          id: "s2",
          itemId: "item-2",
          userId: "user-bob",
          splitType: "equal",
          value: 1,
          computedAmountCents: 2000,
        },
      ],
      billSplits: [],
      shares: [
        makeExpenseShare({ userId: "user-alice", paidCents: 7000, owedCents: 0, netCents: 7000 }),
        makeExpenseShare({ userId: "user-bob", paidCents: 0, owedCents: 7000, netCents: -7000 }),
      ],
    });

    expect(result).toEqual({ billId: "new-bill-3" });
    const itemInserts = mock.findCalls("bill_items", "insert");
    expect(itemInserts).toHaveLength(1);
    expect(itemInserts[0].args[0] as unknown[]).toHaveLength(2);
    const splitInserts = mock.findCalls("item_splits", "insert");
    expect(splitInserts).toHaveLength(1);
    expect(splitInserts[0].args[0] as unknown[]).toHaveLength(2);
    // Verify expense_shares
    const shareInserts = mock.findCalls("expense_shares", "insert");
    expect(shareInserts).toHaveLength(1);
    expect(shareInserts[0].args[0] as unknown[]).toHaveLength(2);
  });
});
