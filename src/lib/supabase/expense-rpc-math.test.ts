import { describe, it, expect } from "vitest";

/**
 * Pure unit tests for the balance computation math used by activate_expense.
 *
 * The actual logic runs in PL/pgSQL, but we validate the algorithm here
 * to ensure our expectations in integration tests are correct.
 *
 * Balance convention: positive = user_a owes user_b (user_a < user_b by UUID).
 */

interface Share {
  userId: string;
  amount: number;
}

interface Payment {
  userId: string;
  amount: number;
}

interface BalanceDelta {
  userA: string;
  userB: string;
  delta: number;
}

/**
 * Replicates the activate_expense balance computation.
 */
function computeBalanceDeltas(
  total: number,
  shares: Share[],
  payers: Payment[],
): BalanceDelta[] {
  const pairMap = new Map<string, number>();

  for (const share of shares) {
    for (const payer of payers) {
      if (share.userId === payer.userId) continue;

      const userA =
        share.userId < payer.userId ? share.userId : payer.userId;
      const userB =
        share.userId < payer.userId ? payer.userId : share.userId;
      const key = `${userA}|${userB}`;

      const debt = Math.round(
        (share.amount * payer.amount) / total,
      );
      const sign = share.userId < payer.userId ? 1 : -1;

      pairMap.set(key, (pairMap.get(key) ?? 0) + sign * debt);
    }
  }

  const result: BalanceDelta[] = [];
  for (const [key, delta] of pairMap) {
    if (delta === 0) continue;
    const [userA, userB] = key.split("|");
    result.push({ userA, userB, delta });
  }
  return result;
}

describe("activate_expense balance math", () => {
  // Use alphabetically-ordered fake UUIDs for determinism
  const alice = "aaaa";
  const bob = "bbbb";
  const carol = "cccc";

  it("single payer, equal split among 3", () => {
    const deltas = computeBalanceDeltas(
      9000,
      [
        { userId: alice, amount: 3000 },
        { userId: bob, amount: 3000 },
        { userId: carol, amount: 3000 },
      ],
      [{ userId: alice, amount: 9000 }],
    );

    // alice < bob, alice < carol. Alice paid, so:
    // bob→alice: bob consumed 3000, alice paid 9000 → 3000*9000/9000 = 3000
    //   bob < alice? no, alice < bob. So share=bob, payer=alice → userA=alice, userB=bob
    //   sign for share.userId(bob) < payer.userId(alice)? bob > alice? no, alice < bob
    //   share.userId=bob, payer.userId=alice → bob > alice → sign = -1
    //   Wait, let me re-check: if share.userId < payer.userId → sign = +1
    //   bob vs alice: "bbbb" > "aaaa" → share.userId > payer.userId → sign = -1
    //   delta = -3000 → means user_b(bob) owes user_a(alice) = negative convention
    //   Hmm, that means alice is the creditor. Positive = userA owes userB.
    //   Negative = userB owes userA. So -3000 means bob owes alice. Correct!

    const aliceBob = deltas.find(
      (d) => d.userA === alice && d.userB === bob,
    );
    const aliceCarol = deltas.find(
      (d) => d.userA === alice && d.userB === carol,
    );

    expect(aliceBob).toBeDefined();
    expect(aliceBob!.delta).toBe(-3000); // bob owes alice (negative = userB owes userA)

    expect(aliceCarol).toBeDefined();
    expect(aliceCarol!.delta).toBe(-3000); // carol owes alice

    // No bob-carol edge
    const bobCarol = deltas.find(
      (d) => d.userA === bob && d.userB === carol,
    );
    expect(bobCarol).toBeUndefined();
  });

  it("two payers, unequal shares", () => {
    // Alice pays 6000, Bob pays 4000. Total 10000.
    // Shares: Alice 3000, Bob 3000, Carol 4000
    const deltas = computeBalanceDeltas(
      10000,
      [
        { userId: alice, amount: 3000 },
        { userId: bob, amount: 3000 },
        { userId: carol, amount: 4000 },
      ],
      [
        { userId: alice, amount: 6000 },
        { userId: bob, amount: 4000 },
      ],
    );

    const aliceBob = deltas.find(
      (d) => d.userA === alice && d.userB === bob,
    );
    const aliceCarol = deltas.find(
      (d) => d.userA === alice && d.userB === carol,
    );
    const bobCarol = deltas.find(
      (d) => d.userA === bob && d.userB === carol,
    );

    // alice-bob pair:
    //   bob consumed 3000, alice paid 6000: debt = 1800, sign=-1 (bob owes alice)
    //   alice consumed 3000, bob paid 4000: debt = 1200, sign=+1 (alice owes bob)
    //   net = -1800 + 1200 = -600 → bob owes alice 600
    expect(aliceBob!.delta).toBe(-600);

    // alice-carol pair:
    //   carol consumed 4000, alice paid 6000: debt = 2400, sign=-1 (carol owes alice)
    //   alice consumed 3000: alice didn't pay carol (carol isn't a payer), skip
    //   Actually carol isn't a payer at all, so only one direction
    expect(aliceCarol!.delta).toBe(-2400);

    // bob-carol pair:
    //   carol consumed 4000, bob paid 4000: debt = 1600, sign=-1 (carol owes bob)
    expect(bobCarol!.delta).toBe(-1600);
  });

  it("self-owe is excluded (no balance change for payer's own share)", () => {
    // Alice pays 10000, Alice's share is 10000 (only consumer)
    const deltas = computeBalanceDeltas(
      10000,
      [{ userId: alice, amount: 10000 }],
      [{ userId: alice, amount: 10000 }],
    );

    expect(deltas).toHaveLength(0);
  });

  it("handles rounding correctly for odd splits", () => {
    // 10000 split 3 ways = 3333, 3333, 3334
    // Alice pays all
    const deltas = computeBalanceDeltas(
      10000,
      [
        { userId: alice, amount: 3333 },
        { userId: bob, amount: 3333 },
        { userId: carol, amount: 3334 },
      ],
      [{ userId: alice, amount: 10000 }],
    );

    const aliceBob = deltas.find(
      (d) => d.userA === alice && d.userB === bob,
    );
    const aliceCarol = deltas.find(
      (d) => d.userA === alice && d.userB === carol,
    );

    // bob owes alice: round(3333 * 10000 / 10000) = 3333
    expect(aliceBob!.delta).toBe(-3333);
    // carol owes alice: round(3334 * 10000 / 10000) = 3334
    expect(aliceCarol!.delta).toBe(-3334);
  });
});

describe("confirm_settlement balance math", () => {
  it("settlement reduces debt correctly (from < to)", () => {
    // from=alice(aaaa), to=bob(bbbb) → alice < bob
    // user_a=alice, user_b=bob
    // from is paying to → from owes to → positive balance decreases
    // delta = -amount
    const fromUser = "aaaa";
    const toUser = "bbbb";
    const amount = 3000;

    const userA = fromUser < toUser ? fromUser : toUser;
    const userB = fromUser < toUser ? toUser : fromUser;
    const delta =
      fromUser < toUser ? -amount : amount;

    expect(userA).toBe("aaaa");
    expect(userB).toBe("bbbb");
    expect(delta).toBe(-3000);
  });

  it("settlement reduces debt correctly (from > to)", () => {
    // from=bob(bbbb), to=alice(aaaa) → bob > alice
    // user_a=alice, user_b=bob
    // bob is paying alice → bob owes alice → negative balance (user_b owes user_a)
    // Payment moves toward zero → delta = +amount
    const fromUser = "bbbb";
    const toUser = "aaaa";
    const amount = 3000;

    const userA = fromUser < toUser ? fromUser : toUser;
    const userB = fromUser < toUser ? toUser : fromUser;
    const delta =
      fromUser < toUser ? -amount : amount;

    expect(userA).toBe("aaaa");
    expect(userB).toBe("bbbb");
    expect(delta).toBe(3000);
  });
});
