import { describe, it, expect } from "vitest";
import { applyExpenseDelta, applySettlementDelta } from "./apply";
import type { BalanceRow, ExpensePayload } from "@/types/ledger";

describe("applyExpenseDelta", () => {
  const baseBalances: BalanceRow[] = [
    { kind: "user", participantId: "alice", netCents: -500 },
    { kind: "user", participantId: "bob", netCents: 500 },
  ];

  const samplePayload: ExpensePayload = {
    items: [],
    participants: [
      { kind: "user", userId: "alice" },
      { kind: "user", userId: "bob" },
      { kind: "guest", guestId: "guest-persisted-1", displayName: "Guest One" },
      { kind: "guest", guestId: "guest-persisted-2", displayName: "Guest Two" },
    ],
    shares: [2000, 3000, 1000, 1000],
    payers: [{ participantIndex: 0, amountCents: 7000 }],
    itemAssignments: null,
  };

  it("applies forward expense delta correctly", () => {
    // alice paid 7000, share 2000 => delta +5000; net was -500 => +4500
    // bob paid 0, share 3000 => delta -3000; net was +500 => -2500
    // guest-persisted-1 paid 0, share 1000 => delta -1000; new row -1000
    // guest-persisted-2 paid 0, share 1000 => delta -1000; new row -1000
    // sorted by (kind, participantId): guest rows first, then user rows
    const result = applyExpenseDelta(baseBalances, samplePayload, 1);
    expect(result).toEqual([
      { kind: "guest", participantId: "guest-persisted-1", netCents: -1000 },
      { kind: "guest", participantId: "guest-persisted-2", netCents: -1000 },
      { kind: "user", participantId: "alice", netCents: 4500 },
      { kind: "user", participantId: "bob", netCents: -2500 },
    ]);
  });

  it("reversing an applied expense delta restores the original balances", () => {
    const afterExpense = applyExpenseDelta(baseBalances, samplePayload, 1);
    const afterReversal = applyExpenseDelta(afterExpense, samplePayload, -1);
    expect(afterReversal).toEqual(baseBalances);
  });

  it("skips the whole patch while a guest id is unassigned, keeping the set zero-sum", () => {
    // materialize_participants assigns the guest UUID server-side; until the
    // next snapshot lands the guest cannot be represented, and applying only
    // the resolved participants would show balances that cannot be real.
    const pendingGuestPayload: ExpensePayload = {
      items: [],
      participants: [
        { kind: "user", userId: "alice" },
        { kind: "guest", guestId: null, displayName: "Convidado" },
      ],
      shares: [3000, 7000],
      payers: [{ participantIndex: 0, amountCents: 10000 }],
      itemAssignments: null,
    };

    const forward = applyExpenseDelta(baseBalances, pendingGuestPayload, 1);
    expect(forward).toEqual(baseBalances);
    expect(forward.reduce((sum, row) => sum + row.netCents, 0)).toBe(0);

    const reversed = applyExpenseDelta(baseBalances, pendingGuestPayload, -1);
    expect(reversed).toEqual(baseBalances);
  });

  it("drops zero-net rows after delta application", () => {
    // Alice owes 500. She pays 1000 with a 500 share => delta +500 => new net 0 (removed).
    const zeroingPayload: ExpensePayload = {
      items: [],
      participants: [
        { kind: "user", userId: "alice" },
        { kind: "user", userId: "bob" },
      ],
      shares: [500, 500],
      payers: [{ participantIndex: 0, amountCents: 1000 }],
      itemAssignments: null,
    };
    const result = applyExpenseDelta(baseBalances, zeroingPayload, 1);
    // alice: -500 + (1000 - 500) = 0 (dropped)
    // bob: 500 + (0 - 500) = 0 (dropped)
    expect(result).toEqual([]);
  });

  it("never mutates input arrays or objects", () => {
    const copy = structuredClone(baseBalances);
    const payloadCopy = structuredClone(samplePayload);
    applyExpenseDelta(baseBalances, samplePayload, 1);
    expect(baseBalances).toEqual(copy);
    expect(samplePayload).toEqual(payloadCopy);
  });
});

describe("applySettlementDelta", () => {
  const baseBalances: BalanceRow[] = [
    { kind: "user", participantId: "alice", netCents: -1000 },
    { kind: "user", participantId: "bob", netCents: 1000 },
  ];

  it("raises payer net and lowers payee net on confirm (sign 1)", () => {
    // alice pays bob 400: alice net becomes -600, bob becomes 600
    const result = applySettlementDelta(
      baseBalances,
      { fromUserId: "alice", toUserId: "bob", amountCents: 400 },
      1,
    );
    expect(result).toEqual([
      { kind: "user", participantId: "alice", netCents: -600 },
      { kind: "user", participantId: "bob", netCents: 600 },
    ]);
  });

  it("confirm and void are symmetric", () => {
    const settlement = { fromUserId: "alice", toUserId: "bob", amountCents: 400 };
    const confirmed = applySettlementDelta(baseBalances, settlement, 1);
    const voided = applySettlementDelta(confirmed, settlement, -1);
    expect(voided).toEqual(baseBalances);
  });

  it("removes rows that hit zero net from settlement", () => {
    // alice pays full debt of 1000: both become 0, both removed
    const result = applySettlementDelta(
      baseBalances,
      { fromUserId: "alice", toUserId: "bob", amountCents: 1000 },
      1,
    );
    expect(result).toEqual([]);
  });

  it("adds new participant rows when participants were not previously in balances", () => {
    const result = applySettlementDelta(
      [],
      { fromUserId: "carol", toUserId: "david", amountCents: 250 },
      1,
    );
    expect(result).toEqual([
      { kind: "user", participantId: "carol", netCents: 250 },
      { kind: "user", participantId: "david", netCents: -250 },
    ]);
  });

  it("never mutates input balances", () => {
    const copy = structuredClone(baseBalances);
    applySettlementDelta(baseBalances, { fromUserId: "alice", toUserId: "bob", amountCents: 100 }, 1);
    expect(baseBalances).toEqual(copy);
  });
});
