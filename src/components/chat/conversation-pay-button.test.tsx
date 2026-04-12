import { describe, it, expect } from "vitest";
import { distributeSettlement } from "./conversation-pay-button";
import type { Balance } from "@/types";

const USER_A = "aaa-aaa"; // canonical first (a < b)
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

describe("distributeSettlement", () => {
  it("settles a single group debt fully (pay mode)", () => {
    // amountCents > 0 → userA owes userB
    const balances = [makeBalance("g1", 5000)];

    const result = distributeSettlement(balances, USER_A, USER_B, 5000, "pay");

    expect(result).toEqual([
      { groupId: "g1", fromUserId: USER_A, toUserId: USER_B, amountCents: 5000 },
    ]);
  });

  it("settles a single group debt fully (collect mode)", () => {
    // amountCents > 0 → userA owes userB → userB collects from userA
    const balances = [makeBalance("g1", 5000)];

    const result = distributeSettlement(balances, USER_B, USER_A, 5000, "collect");

    expect(result).toEqual([
      { groupId: "g1", fromUserId: USER_A, toUserId: USER_B, amountCents: 5000 },
    ]);
  });

  it("distributes across multiple groups, largest first", () => {
    const balances = [
      makeBalance("g1", 2000), // userA owes 2000
      makeBalance("g2", 8000), // userA owes 8000
      makeBalance("g3", 3000), // userA owes 3000
    ];

    const result = distributeSettlement(balances, USER_A, USER_B, 10000, "pay");

    // Should settle g2 (8000) first, then g3 (3000) partially (2000)
    expect(result).toEqual([
      { groupId: "g2", fromUserId: USER_A, toUserId: USER_B, amountCents: 8000 },
      { groupId: "g3", fromUserId: USER_A, toUserId: USER_B, amountCents: 2000 },
    ]);
  });

  it("handles partial payment within a single group", () => {
    const balances = [makeBalance("g1", 10000)];

    const result = distributeSettlement(balances, USER_A, USER_B, 3000, "pay");

    expect(result).toEqual([
      { groupId: "g1", fromUserId: USER_A, toUserId: USER_B, amountCents: 3000 },
    ]);
  });

  it("skips groups where the debt goes the other direction", () => {
    const balances = [
      makeBalance("g1", 5000),  // userA owes userB
      makeBalance("g2", -3000), // userB owes userA (negative)
    ];

    // userA paying → only g1 applies
    const result = distributeSettlement(balances, USER_A, USER_B, 5000, "pay");

    expect(result).toEqual([
      { groupId: "g1", fromUserId: USER_A, toUserId: USER_B, amountCents: 5000 },
    ]);
  });

  it("returns empty array when no matching debts exist", () => {
    const balances = [makeBalance("g1", -5000)]; // userB owes userA

    // userA trying to pay → no debt from A to B
    const result = distributeSettlement(balances, USER_A, USER_B, 5000, "pay");

    expect(result).toEqual([]);
  });

  it("handles collect mode with reversed user positions", () => {
    // amountCents = -3000 → userB owes userA 3000
    const balances = [makeBalance("g1", -3000)];

    // userA collecting from userB
    const result = distributeSettlement(balances, USER_A, USER_B, 3000, "collect");

    expect(result).toEqual([
      { groupId: "g1", fromUserId: USER_B, toUserId: USER_A, amountCents: 3000 },
    ]);
  });

  it("caps settlement at available debt", () => {
    const balances = [makeBalance("g1", 2000)];

    // Trying to pay more than owed
    const result = distributeSettlement(balances, USER_A, USER_B, 5000, "pay");

    expect(result).toEqual([
      { groupId: "g1", fromUserId: USER_A, toUserId: USER_B, amountCents: 2000 },
    ]);
  });
});
