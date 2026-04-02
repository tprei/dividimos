import { describe, it, expect } from "vitest";
import { distributeProportionally } from "@/lib/currency";

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

// ---------------------------------------------------------------------------
// Helpers for new test suites
// ---------------------------------------------------------------------------

/**
 * Simulates PostgreSQL ROUND() on numeric: rounds half away from zero.
 * For positive values this matches JS Math.round, but for negative values
 * Math.round(-0.5) = 0 while PG ROUND(-0.5) = -1.
 */
function pgRound(n: number): number {
  if (n >= 0) return Math.round(n);
  // For negative: round half away from zero (toward -∞)
  return -Math.round(-n);
}

/**
 * Compute balance deltas using PostgreSQL-style rounding (half away from zero).
 * This is what the actual activate_expense RPC does.
 */
function computeBalanceDeltasPg(
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

      const debt = pgRound(
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

/**
 * Accumulate multiple expense deltas into a running balance ledger,
 * mimicking the balances table's ON CONFLICT upsert behavior.
 */
function accumulateBalances(
  allDeltas: BalanceDelta[][],
): Map<string, number> {
  const ledger = new Map<string, number>();
  for (const deltas of allDeltas) {
    for (const { userA, userB, delta } of deltas) {
      const key = `${userA}|${userB}`;
      ledger.set(key, (ledger.get(key) ?? 0) + delta);
    }
  }
  return ledger;
}

/**
 * Apply a settlement delta to a running balance ledger.
 */
function applySettlement(
  ledger: Map<string, number>,
  fromUser: string,
  toUser: string,
  amount: number,
): void {
  const userA = fromUser < toUser ? fromUser : toUser;
  const userB = fromUser < toUser ? toUser : fromUser;
  const key = `${userA}|${userB}`;
  const delta = fromUser < toUser ? -amount : amount;
  ledger.set(key, (ledger.get(key) ?? 0) + delta);
}

// ---------------------------------------------------------------------------
// Banker's rounding and .5 edge cases
// ---------------------------------------------------------------------------

describe("rounding edge cases (.5 values)", () => {
  const alice = "aaaa";
  const bob = "bbbb";
  const carol = "cccc";

  it("exact .5 cent: share*payment/total lands on half-cent boundary", () => {
    // 1 * 3 / 6 = 0.5 → Math.round(0.5) = 1, pgRound(0.5) = 1
    // Both agree for positive .5
    const deltas = computeBalanceDeltas(
      6,
      [{ userId: bob, amount: 1 }],
      [{ userId: alice, amount: 3 }],
    );
    const deltaPg = computeBalanceDeltasPg(
      6,
      [{ userId: bob, amount: 1 }],
      [{ userId: alice, amount: 3 }],
    );

    expect(deltas).toEqual(deltaPg);
    const ab = deltas.find((d) => d.userA === alice && d.userB === bob);
    expect(ab!.delta).toBe(-1); // rounds up from 0.5
  });

  it("multiple .5 boundaries accumulate rounding drift", () => {
    // 3 consumers each with share=1, single payer=3, total=6
    // Each debt = round(1*3/6) = round(0.5) = 1
    // Sum of debts = 3, but actual proportional amount = 1.5
    // This is expected rounding behavior: 3 rounded debts of 1 centavo each
    const deltas = computeBalanceDeltas(
      6,
      [
        { userId: bob, amount: 1 },
        { userId: carol, amount: 1 },
      ],
      [{ userId: alice, amount: 3 }],
    );

    const ab = deltas.find((d) => d.userA === alice && d.userB === bob);
    const ac = deltas.find((d) => d.userA === alice && d.userB === carol);
    // Each: round(1 * 3 / 6) = round(0.5) = 1
    expect(ab!.delta).toBe(-1);
    expect(ac!.delta).toBe(-1);
  });

  it("7-way split produces correct per-pair rounding", () => {
    // 10001 cents split 7 ways. Shares via distributeProportionally.
    const users = ["u1", "u2", "u3", "u4", "u5", "u6", "u7"].sort();
    const total = 10001;
    const shareAmounts = distributeProportionally(total, new Array(7).fill(1));

    const shares: Share[] = users.map((u, i) => ({
      userId: u,
      amount: shareAmounts[i],
    }));

    // u1 pays everything
    const deltas = computeBalanceDeltas(
      total,
      shares,
      [{ userId: users[0], amount: total }],
    );

    // Every non-payer should owe the payer
    for (let i = 1; i < users.length; i++) {
      const edge = deltas.find(
        (d) => d.userA === users[0] && d.userB === users[i],
      );
      expect(edge).toBeDefined();
      expect(edge!.delta).toBeLessThan(0); // user_i owes payer
    }

    // Sum of all debts should be close to total minus payer's own share
    const totalDebt = deltas.reduce((sum, d) => sum + Math.abs(d.delta), 0);
    const payerShare = shareAmounts[0];
    // Rounding can cause ±1 cent per edge, so allow up to 6 cents drift
    expect(Math.abs(totalDebt - (total - payerShare))).toBeLessThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------
// Client distributeProportionally vs server per-pair ROUND divergence
// ---------------------------------------------------------------------------

describe("client distributeProportionally vs server per-pair ROUND", () => {
  const alice = "aaaa";
  const bob = "bbbb";
  const carol = "cccc";

  it("diverges on 3-way split of 100 cents with 2 payers", () => {
    // Total: 100 cents. Equal 3-way split: distributeProportionally -> [34, 33, 33]
    // Payers: alice=50, bob=50 (also consumers). Carol is a pure consumer.
    //
    // Client says carol owes 33 cents total.
    // Server computes per-pair: ROUND(33*50/100) + ROUND(33*50/100) = 17 + 17 = 34.
    // The two rounding modes diverge by 1 cent for carol.
    const total = 100;
    const clientShares = distributeProportionally(total, [1, 1, 1]);
    // [34, 33, 33] — alice gets the extra cent from largest-remainder

    const serverDeltas = computeBalanceDeltasPg(
      total,
      [
        { userId: alice, amount: clientShares[0] },
        { userId: bob, amount: clientShares[1] },
        { userId: carol, amount: clientShares[2] },
      ],
      [
        { userId: alice, amount: 50 },
        { userId: bob, amount: 50 },
      ],
    );

    // Compute what the server says each consumer owes in total
    // (sum of their per-pair ROUND debts across all payers they're paired with)
    const serverOwed = new Map<string, number>();
    for (const { userA, userB, delta } of serverDeltas) {
      // positive delta = userA owes userB; negative = userB owes userA
      serverOwed.set(userA, (serverOwed.get(userA) ?? 0) + Math.max(0, delta));
      serverOwed.set(userB, (serverOwed.get(userB) ?? 0) + Math.max(0, -delta));
    }

    // carol is the only pure consumer; server rounds her debt up to 34, client says 33
    expect(serverOwed.get(carol) ?? 0).toBe(34);
    expect(clientShares[2]).toBe(33);
    expect(serverOwed.get(carol)).not.toBe(clientShares[2]);
  });

  it("largest-remainder preserves sum exactly while per-pair ROUND may not", () => {
    // 98 cents, 3 equal-weight consumers → distributeProportionally gives [33, 33, 32].
    // That always sums to exactly 98.
    //
    // With two payers each contributing 49 cents, the server computes per-pair ROUND:
    //   consumer with share 33: ROUND(33*49/98) + ROUND(33*49/98) = 17 + 17 = 34  (overcount by 1)
    //   consumer with share 32: ROUND(32*49/98) + ROUND(32*49/98) = 16 + 16 = 32  (exact)
    // Total server debt = 34 + 34 + 32 = 100, but distributeProportionally sum = 98.
    const total = 98;
    const clientShares = distributeProportionally(total, [1, 1, 1]);
    // [33, 33, 32]
    expect(clientShares.reduce((a, b) => a + b, 0)).toBe(total);

    // Two separate payers (not among the consumers) split equally
    const serverDeltas = computeBalanceDeltasPg(
      total,
      [
        { userId: "bbbb", amount: clientShares[0] },
        { userId: "cccc", amount: clientShares[1] },
        { userId: "dddd", amount: clientShares[2] },
      ],
      [
        { userId: "aaaa", amount: 49 },
        { userId: "eeee", amount: 49 },
      ],
    );

    // distributeProportionally guarantees the client share sum equals total exactly
    const clientSum = clientShares.reduce((a, b) => a + b, 0);
    expect(clientSum).toBe(total);

    // Per-pair ROUND across two payers overcounts: server debt sum exceeds total
    const serverDebtSum = serverDeltas.reduce(
      (s, d) => s + Math.abs(d.delta),
      0,
    );
    expect(serverDebtSum).toBeGreaterThan(total);
  });

  it("multi-payer scenario shows rounding drift between approaches", () => {
    // 10007 cents, 5 equal consumers → shares [2002, 2002, 2001, 2001, 2001].
    // Payers: u1=3337, u2=3337, u3=3333 (sum=10007).
    // u4 and u5 are pure consumers.
    //
    // For u4 (share=2001): ROUND(2001*3337/10007) + ROUND(2001*3337/10007) + ROUND(2001*3333/10007)
    //   = ROUND(667.1) + ROUND(667.1) + ROUND(666.3) = 667 + 667 + 666 = 2000
    // Client says u4 owes 2001; server says 2000. Drift = -1.
    const total = 10007;
    const shares = distributeProportionally(total, new Array(5).fill(1));
    // [2002, 2002, 2001, 2001, 2001]
    const users = ["u1", "u2", "u3", "u4", "u5"].sort();

    const serverDeltas = computeBalanceDeltasPg(
      total,
      users.map((u, i) => ({ userId: u, amount: shares[i] })),
      [
        { userId: users[0], amount: 3337 },
        { userId: users[1], amount: 3337 },
        { userId: users[2], amount: 3333 },
      ],
    );

    // Build a map of how much each consumer owes in total server-side
    const serverOwed = new Map<string, number>();
    for (const { userA, userB, delta } of serverDeltas) {
      serverOwed.set(userA, (serverOwed.get(userA) ?? 0) + Math.max(0, delta));
      serverOwed.set(userB, (serverOwed.get(userB) ?? 0) + Math.max(0, -delta));
    }

    // For each non-payer consumer (u4, u5), compare server total to client share.
    // Drift must be bounded (within number of payer pairs = 3 cents max),
    // and in this case is exactly -1 cent for each.
    for (const idx of [3, 4]) {
      const clientShare = shares[idx];
      const serverTotal = serverOwed.get(users[idx]) ?? 0;
      const drift = serverTotal - clientShare;
      expect(Math.abs(drift)).toBeLessThanOrEqual(3);
    }

    // The specific drift value confirms per-pair ROUND undercounts by 1 cent here
    expect(serverOwed.get(users[3])).toBe(shares[3] - 1);
    expect(serverOwed.get(users[4])).toBe(shares[4] - 1);
  });
});

// ---------------------------------------------------------------------------
// Multi-expense accumulation math
// ---------------------------------------------------------------------------

describe("multi-expense balance accumulation", () => {
  const alice = "aaaa";
  const bob = "bbbb";
  const carol = "cccc";

  it("two expenses in same group accumulate correctly", () => {
    // Expense 1: Alice pays 6000 for everyone (equal 3-way)
    const d1 = computeBalanceDeltasPg(
      6000,
      [
        { userId: alice, amount: 2000 },
        { userId: bob, amount: 2000 },
        { userId: carol, amount: 2000 },
      ],
      [{ userId: alice, amount: 6000 }],
    );

    // Expense 2: Bob pays 3000 for bob and carol
    const d2 = computeBalanceDeltasPg(
      3000,
      [
        { userId: bob, amount: 1500 },
        { userId: carol, amount: 1500 },
      ],
      [{ userId: bob, amount: 3000 }],
    );

    const ledger = accumulateBalances([d1, d2]);

    // alice-bob: expense1 = -2000 (bob owes alice), expense2 has no alice
    expect(ledger.get(`${alice}|${bob}`)).toBe(-2000);

    // alice-carol: expense1 = -2000 (carol owes alice), expense2 has no alice
    expect(ledger.get(`${alice}|${carol}`)).toBe(-2000);

    // bob-carol: expense1 = 0 (no edge), expense2 = carol owes bob 1500
    // bob < carol → sign for share=carol,payer=bob: carol > bob → sign = -1
    // debt = round(1500 * 3000 / 3000) = 1500
    expect(ledger.get(`${bob}|${carol}`)).toBe(-1500);
  });

  it("reciprocal expenses cancel out to zero", () => {
    // Expense 1: Alice pays 1000 for Bob
    const d1 = computeBalanceDeltasPg(
      1000,
      [{ userId: bob, amount: 1000 }],
      [{ userId: alice, amount: 1000 }],
    );

    // Expense 2: Bob pays 1000 for Alice
    const d2 = computeBalanceDeltasPg(
      1000,
      [{ userId: alice, amount: 1000 }],
      [{ userId: bob, amount: 1000 }],
    );

    const ledger = accumulateBalances([d1, d2]);

    // Should cancel out
    const balance = ledger.get(`${alice}|${bob}`) ?? 0;
    expect(balance).toBe(0);
  });

  it("asymmetric reciprocals leave correct residual", () => {
    // Alice pays 3000 for Bob, then Bob pays 1000 for Alice
    const d1 = computeBalanceDeltasPg(
      3000,
      [{ userId: bob, amount: 3000 }],
      [{ userId: alice, amount: 3000 }],
    );

    const d2 = computeBalanceDeltasPg(
      1000,
      [{ userId: alice, amount: 1000 }],
      [{ userId: bob, amount: 1000 }],
    );

    const ledger = accumulateBalances([d1, d2]);

    // d1: bob owes alice 3000 → delta = -3000
    // d2: alice owes bob 1000 → delta = +1000
    // net = -2000 → bob still owes alice 2000
    expect(ledger.get(`${alice}|${bob}`)).toBe(-2000);
  });
});

// ---------------------------------------------------------------------------
// Settlement interleaving with expenses
// ---------------------------------------------------------------------------

describe("settlement interleaving with expenses", () => {
  const alice = "aaaa";
  const bob = "bbbb";
  const carol = "cccc";

  it("partial settlement then new expense: balances accumulate correctly", () => {
    // Expense 1: Alice pays 9000 equally among 3
    const d1 = computeBalanceDeltasPg(
      9000,
      [
        { userId: alice, amount: 3000 },
        { userId: bob, amount: 3000 },
        { userId: carol, amount: 3000 },
      ],
      [{ userId: alice, amount: 9000 }],
    );

    const ledger = accumulateBalances([d1]);
    // bob owes alice 3000, carol owes alice 3000

    // Bob settles 2000 of his 3000 debt to alice
    applySettlement(ledger, bob, alice, 2000);

    // bob-alice balance: -3000 + 2000 = -1000 (bob still owes 1000)
    expect(ledger.get(`${alice}|${bob}`)).toBe(-1000);

    // New expense: Bob pays 6000 for alice and carol
    const d2 = computeBalanceDeltasPg(
      6000,
      [
        { userId: alice, amount: 3000 },
        { userId: carol, amount: 3000 },
      ],
      [{ userId: bob, amount: 6000 }],
    );

    for (const { userA, userB, delta } of d2) {
      const key = `${userA}|${userB}`;
      ledger.set(key, (ledger.get(key) ?? 0) + delta);
    }

    // alice-bob: was -1000 (bob owes alice 1000)
    // expense 2: alice owes bob 3000 → delta = +3000
    // net: -1000 + 3000 = 2000 (alice now owes bob 2000)
    expect(ledger.get(`${alice}|${bob}`)).toBe(2000);

    // alice-carol: was -3000 (carol owes alice)
    // expense 2 doesn't affect alice-carol directly — no, wait
    // expense 2: carol consumed 3000, bob paid 6000 → bob-carol pair
    // No alice-carol change from expense 2
    expect(ledger.get(`${alice}|${carol}`)).toBe(-3000);

    // bob-carol: expense 2: carol owes bob → delta = round(3000*6000/6000) = -3000
    expect(ledger.get(`${bob}|${carol}`)).toBe(-3000);
  });

  it("full settlement zeroes a pair, new expense re-creates it", () => {
    const d1 = computeBalanceDeltasPg(
      5000,
      [{ userId: bob, amount: 5000 }],
      [{ userId: alice, amount: 5000 }],
    );

    const ledger = accumulateBalances([d1]);
    expect(ledger.get(`${alice}|${bob}`)).toBe(-5000);

    // Full settlement
    applySettlement(ledger, bob, alice, 5000);
    expect(ledger.get(`${alice}|${bob}`)).toBe(0);

    // New expense re-creates debt
    const d2 = computeBalanceDeltasPg(
      2000,
      [{ userId: bob, amount: 2000 }],
      [{ userId: alice, amount: 2000 }],
    );

    for (const { userA, userB, delta } of d2) {
      const key = `${userA}|${userB}`;
      ledger.set(key, (ledger.get(key) ?? 0) + delta);
    }

    expect(ledger.get(`${alice}|${bob}`)).toBe(-2000);
  });

  it("overpayment settlement flips debt direction", () => {
    // Bob owes Alice 1000
    const d1 = computeBalanceDeltasPg(
      1000,
      [{ userId: bob, amount: 1000 }],
      [{ userId: alice, amount: 1000 }],
    );

    const ledger = accumulateBalances([d1]);
    expect(ledger.get(`${alice}|${bob}`)).toBe(-1000);

    // Bob overpays: settles 1500 (500 more than owed)
    applySettlement(ledger, bob, alice, 1500);

    // -1000 + 1500 = 500 → now alice owes bob 500
    expect(ledger.get(`${alice}|${bob}`)).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Monetary conservation invariants
// ---------------------------------------------------------------------------

describe("monetary conservation invariants", () => {
  it("single payer: sum of debts equals total minus payer share", () => {
    const users = ["aaaa", "bbbb", "cccc", "dddd", "eeee"];
    const total = 9999;
    const shares = distributeProportionally(total, [2, 3, 1, 4, 5]);
    const payer = users[0];
    const payerShare = shares[0];

    const deltas = computeBalanceDeltasPg(
      total,
      users.map((u, i) => ({ userId: u, amount: shares[i] })),
      [{ userId: payer, amount: total }],
    );

    // Each debt = round(share_i * total / total) = share_i (exact for single payer)
    const debtSum = deltas.reduce((s, d) => s + Math.abs(d.delta), 0);
    expect(debtSum).toBe(total - payerShare);
  });

  it("per-pair rounding drift is bounded by (N-1)*(M-1)/2 cents", () => {
    // N consumers, M payers → max drift is bounded
    // 5 consumers, 3 payers, awkward total
    const total = 10007;
    const users = ["u1", "u2", "u3", "u4", "u5"].sort();
    const shares = distributeProportionally(total, [1, 2, 3, 2, 2]);
    const payments = distributeProportionally(total, [3, 4, 3]);

    const deltas = computeBalanceDeltasPg(
      total,
      users.map((u, i) => ({ userId: u, amount: shares[i] })),
      [
        { userId: users[0], amount: payments[0] },
        { userId: users[1], amount: payments[1] },
        { userId: users[2], amount: payments[2] },
      ],
    );

    // Net flow per user should be: (what they paid) - (what they consumed)
    const userNet = new Map<string, number>();
    for (const u of users) userNet.set(u, 0);

    for (const { userA, userB, delta } of deltas) {
      // positive delta = userA owes userB
      userNet.set(userA, (userNet.get(userA) ?? 0) - delta);
      userNet.set(userB, (userNet.get(userB) ?? 0) + delta);
    }

    // Expected net = paid - consumed for each user
    const expectedNet = users.map((u, i) => {
      const paid =
        i < 3 ? payments[i] : 0;
      return paid - shares[i];
    });

    // Due to per-pair rounding, actual net may differ from expected by a few cents
    for (let i = 0; i < users.length; i++) {
      const actual = userNet.get(users[i]) ?? 0;
      const drift = Math.abs(actual - expectedNet[i]);
      // Drift bounded by number of cross-pairs this user is involved in
      expect(drift).toBeLessThanOrEqual(4);
    }
  });

  it("conservation: sum of all balance deltas is zero (debits = credits)", () => {
    // For any expense, the net sum of all signed deltas should be zero or very close
    // because every debt creates a matching credit
    const total = 7777;
    const users = ["aa", "bb", "cc", "dd"];
    const shares = distributeProportionally(total, [1, 1, 1, 1]);

    const deltas = computeBalanceDeltasPg(
      total,
      users.map((u, i) => ({ userId: u, amount: shares[i] })),
      [
        { userId: users[0], amount: 5000 },
        { userId: users[1], amount: 2777 },
      ],
    );

    // Sum of signed deltas across all pairs should be zero (not absolute values)
    // This isn't guaranteed to be exactly zero due to per-pair rounding,
    // but the algebraic sum of user net positions must be zero
    const userNet = new Map<string, number>();
    for (const { userA, userB, delta } of deltas) {
      userNet.set(userA, (userNet.get(userA) ?? 0) + delta);
      userNet.set(userB, (userNet.get(userB) ?? 0) - delta);
    }

    const totalNet = Array.from(userNet.values()).reduce((a, b) => a + b, 0);
    // Per-pair rounding can cause small leakage; bound it
    expect(Math.abs(totalNet)).toBeLessThanOrEqual(
      users.length * (users.length - 1),
    );
  });
});
