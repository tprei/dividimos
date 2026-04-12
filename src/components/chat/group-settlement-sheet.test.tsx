import { describe, it, expect } from "vitest";
import { computeGroupDebts } from "./group-settlement-sheet";
import type { Balance } from "@/types";

const USER_A = "aaa-aaa";
const USER_B = "bbb-bbb";

function makeBalance(groupId: string, amountCents: number): Balance {
  return {
    groupId,
    userA: USER_A,
    userB: USER_B,
    amountCents,
    updatedAt: new Date().toISOString(),
  };
}

describe("computeGroupDebts", () => {
  it("returns debts where currentUser owes (pay mode)", () => {
    const balances = [
      makeBalance("g1", 5000), // userA owes userB 5000
      makeBalance("g2", 3000), // userA owes userB 3000
    ];

    const result = computeGroupDebts(balances, USER_A, "pay");

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(
      expect.objectContaining({ groupId: "g1", debtCents: 5000 }),
    );
    expect(result[1]).toEqual(
      expect.objectContaining({ groupId: "g2", debtCents: 3000 }),
    );
  });

  it("sorts by largest debt first", () => {
    const balances = [
      makeBalance("g1", 1000),
      makeBalance("g2", 8000),
      makeBalance("g3", 3000),
    ];

    const result = computeGroupDebts(balances, USER_A, "pay");

    expect(result.map((r) => r.groupId)).toEqual(["g2", "g3", "g1"]);
  });

  it("filters out groups where debt goes the other direction (pay mode)", () => {
    const balances = [
      makeBalance("g1", 5000),  // userA owes userB
      makeBalance("g2", -3000), // userB owes userA
    ];

    const result = computeGroupDebts(balances, USER_A, "pay");

    expect(result).toHaveLength(1);
    expect(result[0].groupId).toBe("g1");
  });

  it("returns debts where counterparty owes (collect mode)", () => {
    const balances = [
      makeBalance("g1", -4000), // userB owes userA 4000
    ];

    const result = computeGroupDebts(balances, USER_A, "collect");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({ groupId: "g1", debtCents: 4000 }),
    );
  });

  it("handles collect mode when currentUser is userB", () => {
    const balances = [
      makeBalance("g1", 5000), // userA owes userB → userB collects
    ];

    const result = computeGroupDebts(balances, USER_B, "collect");

    expect(result).toHaveLength(1);
    expect(result[0].debtCents).toBe(5000);
  });

  it("returns empty array when no matching debts exist", () => {
    const balances = [
      makeBalance("g1", -5000), // userB owes userA
    ];

    const result = computeGroupDebts(balances, USER_A, "pay");

    expect(result).toEqual([]);
  });

  it("handles empty balances array", () => {
    const result = computeGroupDebts([], USER_A, "pay");
    expect(result).toEqual([]);
  });

  it("handles mixed debts across groups", () => {
    const balances = [
      makeBalance("g1", 5000),  // userA owes 5000
      makeBalance("g2", -3000), // userB owes 3000
      makeBalance("g3", 2000),  // userA owes 2000
    ];

    const payResult = computeGroupDebts(balances, USER_A, "pay");
    expect(payResult).toHaveLength(2);
    expect(payResult.map((r) => r.groupId)).toEqual(["g1", "g3"]);

    const collectResult = computeGroupDebts(balances, USER_A, "collect");
    expect(collectResult).toHaveLength(1);
    expect(collectResult[0].groupId).toBe("g2");
  });
});
