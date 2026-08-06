import { describe, it, expect } from "vitest";
import { amountCallerOwesRecipient, computeMemberNetBalances } from "./group-balances";
import type { Balance } from "@/types";

// Canonical fixture: userA < userB, positive amountCents = userA owes userB.
function row(userA: string, userB: string, amountCents: number): Balance {
  return { groupId: "g1", userA, userB, amountCents, updatedAt: "2026-01-01T00:00:00Z" };
}

describe("amountCallerOwesRecipient", () => {
  it("returns the caller's debt when caller is userA and owes userB", () => {
    expect(amountCallerOwesRecipient(row("aaa", "bbb", 5000), "aaa", "bbb")).toBe(5000);
  });

  it("returns the caller's debt when caller is userB and owes userA", () => {
    // amountCents negative = userB owes userA; caller is userB owing userA
    expect(amountCallerOwesRecipient(row("aaa", "bbb", -5000), "bbb", "aaa")).toBe(5000);
  });

  it("returns 0 when the recipient owes the caller (caller is userA, amount negative)", () => {
    expect(amountCallerOwesRecipient(row("aaa", "bbb", -3000), "aaa", "bbb")).toBe(0);
  });

  it("returns 0 when the recipient owes the caller (caller is userB, amount positive)", () => {
    // amount positive = userA owes userB; caller is userB (the creditor)
    expect(amountCallerOwesRecipient(row("aaa", "bbb", 3000), "bbb", "aaa")).toBe(0);
  });

  it("returns 0 when the balance is settled at zero", () => {
    expect(amountCallerOwesRecipient(row("aaa", "bbb", 0), "aaa", "bbb")).toBe(0);
  });

  it("returns 0 when no balance row exists", () => {
    expect(amountCallerOwesRecipient(null, "aaa", "bbb")).toBe(0);
  });

  it("returns 0 when the row does not involve the caller", () => {
    expect(amountCallerOwesRecipient(row("aaa", "bbb", 5000), "ccc", "bbb")).toBe(0);
  });

  it("returns 0 when the row does not involve the recipient", () => {
    expect(amountCallerOwesRecipient(row("aaa", "bbb", 5000), "aaa", "ccc")).toBe(0);
  });
});

describe("computeMemberNetBalances", () => {
  it("orients balances relative to the viewer (positive = member owes viewer)", () => {
    // aaa owes bbb 5000 → viewer bbb is owed by aaa → +5000
    const map = computeMemberNetBalances([row("aaa", "bbb", 5000)], "bbb");
    expect(map.get("aaa")).toBe(5000);
  });

  it("orients balances relative to the viewer (negative = viewer owes member)", () => {
    // aaa owes bbb 5000 → viewer aaa owes bbb → -5000
    const map = computeMemberNetBalances([row("aaa", "bbb", 5000)], "aaa");
    expect(map.get("bbb")).toBe(-5000);
  });
});
