import { describe, it, expect } from "vitest";
import { netAndMinimize, transfersFromBalances, transfersInvolving } from "./transfers";
import type { DebtEdge } from "../simplify";
import type { BalanceRow, Transfer } from "@/types/ledger";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function legacyNetAndMinimize(edges: DebtEdge[]): DebtEdge[] {
  const balances = new Map<string, number>();
  for (const e of edges) {
    balances.set(e.fromUserId, (balances.get(e.fromUserId) ?? 0) - e.amountCents);
    balances.set(e.toUserId, (balances.get(e.toUserId) ?? 0) + e.amountCents);
  }
  const debtors: { id: string; amount: number }[] = [];
  const creditors: { id: string; amount: number }[] = [];
  for (const [id, balance] of balances) {
    if (balance < 0) debtors.push({ id, amount: Math.abs(balance) });
    if (balance > 0) creditors.push({ id, amount: balance });
  }
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);
  const result: DebtEdge[] = [];
  let di = 0;
  let ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const transfer = Math.min(debtors[di].amount, creditors[ci].amount);
    if (transfer <= 0) break;
    result.push({ fromUserId: debtors[di].id, toUserId: creditors[ci].id, amountCents: transfer });
    debtors[di].amount -= transfer;
    creditors[ci].amount -= transfer;
    if (debtors[di].amount <= 0) di++;
    if (creditors[ci].amount <= 0) ci++;
  }
  return result;
}

function netConservation(balances: readonly BalanceRow[], transfers: readonly Transfer[]): boolean {
  const transferNet = new Map<string, number>();
  for (const t of transfers) {
    transferNet.set(t.fromId, (transferNet.get(t.fromId) ?? 0) - t.amountCents);
    transferNet.set(t.toId, (transferNet.get(t.toId) ?? 0) + t.amountCents);
  }
  for (const b of balances) {
    const fromTransfers = transferNet.get(b.participantId) ?? 0;
    if (fromTransfers !== b.netCents) {
      return false;
    }
  }
  return true;
}

describe("transfersFromBalances", () => {
  it("returns empty array for empty or zero-only balances", () => {
    expect(transfersFromBalances([])).toEqual([]);
    expect(
      transfersFromBalances([
        { kind: "user", participantId: "u1", netCents: 0 },
        { kind: "guest", participantId: "g1", netCents: 0 },
      ]),
    ).toEqual([]);
  });

  it("handles a single debtor and creditor", () => {
    const balances: BalanceRow[] = [
      { kind: "user", participantId: "u-debtor", netCents: -500 },
      { kind: "user", participantId: "u-creditor", netCents: 500 },
    ];
    expect(transfersFromBalances(balances)).toEqual([
      {
        fromKind: "user",
        fromId: "u-debtor",
        toId: "u-creditor",
        amountCents: 500,
      },
    ]);
  });

  it("preserves guest kind on fromKind when a guest is debtor", () => {
    const balances: BalanceRow[] = [
      { kind: "guest", participantId: "g-debtor", netCents: -300 },
      { kind: "user", participantId: "u-creditor", netCents: 300 },
    ];
    expect(transfersFromBalances(balances)).toEqual([
      {
        fromKind: "guest",
        fromId: "g-debtor",
        toId: "u-creditor",
        amountCents: 300,
      },
    ]);
  });

  it("breaks debtor ties by participantId ascending", () => {
    const balances: BalanceRow[] = [
      { kind: "user", participantId: "user-b", netCents: -100 },
      { kind: "user", participantId: "user-a", netCents: -100 },
      { kind: "user", participantId: "user-c", netCents: 200 },
    ];
    expect(transfersFromBalances(balances)).toEqual([
      { fromKind: "user", fromId: "user-a", toId: "user-c", amountCents: 100 },
      { fromKind: "user", fromId: "user-b", toId: "user-c", amountCents: 100 },
    ]);
  });

  it("breaks creditor ties by participantId ascending", () => {
    const balances: BalanceRow[] = [
      { kind: "user", participantId: "user-d", netCents: -200 },
      { kind: "user", participantId: "user-z", netCents: 100 },
      { kind: "user", participantId: "user-y", netCents: 100 },
    ];
    expect(transfersFromBalances(balances)).toEqual([
      { fromKind: "user", fromId: "user-d", toId: "user-y", amountCents: 100 },
      { fromKind: "user", fromId: "user-d", toId: "user-z", amountCents: 100 },
    ]);
  });

  it("advances both pointers when debtor and creditor match exactly", () => {
    const balances: BalanceRow[] = [
      { kind: "user", participantId: "d1", netCents: -100 },
      { kind: "user", participantId: "d2", netCents: -200 },
      { kind: "user", participantId: "c1", netCents: 100 },
      { kind: "user", participantId: "c2", netCents: 200 },
    ];
    const transfers = transfersFromBalances(balances);
    expect(transfers).toHaveLength(2);
    expect(transfers).toEqual([
      { fromKind: "user", fromId: "d2", toId: "c2", amountCents: 200 },
      { fromKind: "user", fromId: "d1", toId: "c1", amountCents: 100 },
    ]);
  });

  it("is deterministic: identical inputs produce identical outputs", () => {
    const balances: BalanceRow[] = [
      { kind: "user", participantId: "b", netCents: -350 },
      { kind: "user", participantId: "a", netCents: -150 },
      { kind: "user", participantId: "c", netCents: 500 },
    ];
    const first = transfersFromBalances(balances);
    const second = transfersFromBalances(balances);
    expect(first).toEqual(second);
  });

  it("conserves per-participant net across seeded random balances", () => {
    const rand = mulberry32(1337);
    for (let iteration = 0; iteration < 100; iteration++) {
      const k = 2 + Math.floor(rand() * 7);
      const nets: number[] = [];
      for (let i = 0; i < k - 1; i++) {
        nets.push(Math.floor(rand() * 20001) - 10000);
      }
      nets.push(-nets.reduce((sum, n) => sum + n, 0));

      const balances: BalanceRow[] = nets.map((netCents, i) => ({
        kind: rand() > 0.8 ? "guest" : "user",
        participantId: `p-${String(i).padStart(2, "0")}`,
        netCents,
      }));

      const transfers = transfersFromBalances(balances);
      expect(netConservation(balances, transfers)).toBe(true);

      const runAgain = transfersFromBalances(balances);
      expect(transfers).toEqual(runAgain);
    }
  });
});

describe("transfersInvolving", () => {
  const transfers: Transfer[] = [
    { fromKind: "user", fromId: "alice", toId: "bob", amountCents: 100 },
    { fromKind: "user", fromId: "charlie", toId: "alice", amountCents: 250 },
    { fromKind: "user", fromId: "alice", toId: "david", amountCents: 75 },
  ];

  it("partitions into owes and owed for a specific user", () => {
    const result = transfersInvolving(transfers, "alice");
    expect(result.owes).toHaveLength(2);
    expect(result.owes.map((t) => t.toId)).toEqual(["bob", "david"]);
    expect(result.owed).toHaveLength(1);
    expect(result.owed[0].fromId).toBe("charlie");
  });

  it("returns empty arrays for a uninvolved user", () => {
    const result = transfersInvolving(transfers, "nobody");
    expect(result.owes).toEqual([]);
    expect(result.owed).toEqual([]);
  });
});

describe("netAndMinimize", () => {
  it("matches previous behaviour for non-tie inputs", () => {
    const rand = mulberry32(4242);
    let tested = 0;
    while (tested < 50) {
      const userCount = 4 + Math.floor(rand() * 4);
      const edgeCount = userCount + Math.floor(rand() * 6);
      const edges: DebtEdge[] = [];
      for (let e = 0; e < edgeCount; e++) {
        const from = Math.floor(rand() * userCount);
        let to = Math.floor(rand() * userCount);
        while (to === from) {
          to = Math.floor(rand() * userCount);
        }
        edges.push({
          fromUserId: `u-${from}`,
          toUserId: `u-${to}`,
          amountCents: 10 + Math.floor(rand() * 5000),
        });
      }

      const nets = new Map<string, number>();
      for (const edge of edges) {
        nets.set(edge.fromUserId, (nets.get(edge.fromUserId) ?? 0) - edge.amountCents);
        nets.set(edge.toUserId, (nets.get(edge.toUserId) ?? 0) + edge.amountCents);
      }
      const debtorAmounts = [...nets.values()].filter((n) => n < 0).map(Math.abs);
      const creditorAmounts = [...nets.values()].filter((n) => n > 0);
      const hasDebtorTie = new Set(debtorAmounts).size !== debtorAmounts.length;
      const hasCreditorTie = new Set(creditorAmounts).size !== creditorAmounts.length;

      if (hasDebtorTie || hasCreditorTie) {
        continue;
      }

      const current = netAndMinimize(edges);
      const legacy = legacyNetAndMinimize(edges);
      expect(current).toEqual(legacy);
      tested++;
    }
  });
});
