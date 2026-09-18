import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { propertyConfig } from "@/test/property";
import type { BalanceRow, Transfer } from "@/types/ledger";
import {
  type ExpenseFact,
  type LedgerFact,
  projectBalances,
  projectPairwiseEdges,
  projectTransfers,
  type SettlementFact,
} from "./model";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

function expense(
  id: string,
  rows: Array<[string, number, number]>,
  status: ExpenseFact["status"] = "active",
): ExpenseFact {
  return {
    kind: "expense",
    expenseId: id,
    clientId: `client-${id}`,
    status,
    versionNo: 1,
    rows: rows.map(([participantId, shareCents, paidCents]) => ({
      participantId,
      shareCents,
      paidCents,
    })),
  };
}

function settlement(
  id: string,
  fromUserId: string,
  toUserId: string,
  amountCents: number,
  status: SettlementFact["status"] = "confirmed",
): SettlementFact {
  return {
    kind: "settlement",
    settlementId: id,
    operationId: `op-${id}`,
    status,
    fromUserId,
    toUserId,
    amountCents,
  };
}

function netsFromEdges(edges: readonly Transfer[]): Record<string, number> {
  const nets: Record<string, number> = {};
  for (const edge of edges) {
    nets[edge.fromId] = (nets[edge.fromId] ?? 0) - edge.amountCents;
    nets[edge.toId] = (nets[edge.toId] ?? 0) + edge.amountCents;
  }
  // A participant can owe one pair and be owed by another, netting to zero
  // overall; the projection has no row for them either.
  return Object.fromEntries(Object.entries(nets).filter(([, net]) => net !== 0));
}

function netsFromBalances(balances: readonly BalanceRow[]): Record<string, number> {
  const nets: Record<string, number> = {};
  for (const row of balances) {
    nets[row.participantId] = row.netCents;
  }
  return nets;
}

describe("projectBalances", () => {
  it("nets two payers, uneven shares and a settlement", () => {
    const facts: LedgerFact[] = [
      // Ana and Bruno paid 7000/3000 of a 10000 bill split 5000/3000/2000.
      expense("e1", [
        [A, 5000, 7000],
        [B, 3000, 3000],
        [C, 2000, 0],
      ]),
      settlement("s1", C, A, 500),
    ];

    // Bruno paid exactly his share, so the projection has no row for him.
    expect(projectBalances(facts)).toEqual([
      { kind: "user", participantId: A, netCents: 1500 },
      { kind: "user", participantId: C, netCents: -1500 },
    ]);
  });

  it("omits participants whose net lands on zero", () => {
    const balances = projectBalances([
      expense("e1", [
        [A, 500, 1000],
        [B, 500, 0],
      ]),
      settlement("s1", B, A, 500),
    ]);

    expect(balances).toEqual([]);
  });

  it("ignores deleted expenses and voided settlements", () => {
    const facts: LedgerFact[] = [
      expense("e1", [
        [A, 500, 1000],
        [B, 500, 0],
      ]),
      expense(
        "e2",
        [
          [A, 900, 0],
          [B, 100, 1000],
        ],
        "deleted",
      ),
      settlement("s1", B, A, 200, "voided"),
    ];

    expect(projectBalances(facts)).toEqual([
      { kind: "user", participantId: A, netCents: 500 },
      { kind: "user", participantId: B, netCents: -500 },
    ]);
  });

  it("rejects non-integer cents", () => {
    expect(() =>
      projectBalances([
        expense("e1", [
          [A, 0.5, 1],
          [B, 0.5, 0],
        ]),
      ]),
    ).toThrow(RangeError);
  });
});

describe("projectPairwiseEdges", () => {
  it("keeps pair debts separate instead of netting the whole group", () => {
    // Ana covered Bruno, Bruno covered Carla: two pairs, no shortcut from
    // Carla straight to Ana.
    const facts: LedgerFact[] = [
      expense("e1", [
        [A, 0, 1000],
        [B, 1000, 0],
      ]),
      expense("e2", [
        [B, 0, 700],
        [C, 700, 0],
      ]),
    ];

    expect(projectPairwiseEdges(facts)).toEqual([
      { fromKind: "user", fromId: B, toId: A, amountCents: 1000 },
      { fromKind: "user", fromId: C, toId: B, amountCents: 700 },
    ]);
    expect(projectTransfers(facts)).toEqual([
      { fromKind: "user", fromId: C, toId: A, amountCents: 700 },
      { fromKind: "user", fromId: B, toId: A, amountCents: 300 },
    ]);
  });

  it("applies a settlement to the pair it touches and drops the settled pair", () => {
    const facts: LedgerFact[] = [
      expense("e1", [
        [A, 0, 1000],
        [B, 1000, 0],
      ]),
      settlement("s1", B, A, 1000),
    ];

    expect(projectPairwiseEdges(facts)).toEqual([]);
  });

  it("reverses a pair the payer overshot", () => {
    const facts: LedgerFact[] = [
      expense("e1", [
        [A, 0, 1000],
        [B, 1000, 0],
      ]),
      settlement("s1", B, A, 1200),
    ];

    expect(projectPairwiseEdges(facts)).toEqual([
      { fromKind: "user", fromId: A, toId: B, amountCents: 200 },
    ]);
  });
});

const participantPool = [A, B, C, "44444444-4444-4444-8444-444444444444"];

const factsArbitrary = fc.array(
  fc.oneof(
    fc
      .record({
        size: fc.integer({ min: 2, max: 4 }),
        shares: fc.array(fc.integer({ min: 0, max: 40_000 }), { minLength: 2, maxLength: 4 }),
        payerIndex: fc.nat({ max: 3 }),
        secondPayerIndex: fc.nat({ max: 3 }),
        status: fc.constantFrom<ExpenseFact["status"]>("active", "deleted"),
      })
      .map(({ size, shares, payerIndex, secondPayerIndex, status }, index = 0) => {
        const ids = participantPool.slice(0, size);
        const shareList = ids.map((_, position) => shares[position] ?? 0);
        const total = shareList.reduce((sum, value) => sum + value, 0);
        const first = payerIndex % ids.length;
        const second = secondPayerIndex % ids.length;
        const firstPaid = Math.floor(total / 2);
        const paid = ids.map(() => 0);
        paid[first] += firstPaid;
        paid[second] += total - firstPaid;
        return expense(
          `e${index}-${ids.length}-${total}`,
          ids.map((id, position): [string, number, number] => [id, shareList[position], paid[position]]),
          status,
        );
      }),
    fc
      .record({
        from: fc.nat({ max: 3 }),
        to: fc.nat({ max: 3 }),
        amountCents: fc.integer({ min: 1, max: 20_000 }),
        status: fc.constantFrom<SettlementFact["status"]>("confirmed", "voided"),
      })
      .map(({ from, to, amountCents, status }) => {
        const fromIndex = from % participantPool.length;
        const fromId = participantPool[fromIndex];
        // record_settlement rejects from == to, so the model never sees one.
        const toId = participantPool[(fromIndex + 1 + (to % (participantPool.length - 1))) % participantPool.length];
        return settlement(`s-${fromId}-${toId}-${amountCents}`, fromId, toId, amountCents, status);
      }),
  ),
  { maxLength: 8 },
);

describe("ledger model invariants", () => {
  it("keeps the ledger closed, transfers positive and edges reconciled", () => {
    fc.assert(
      fc.property(factsArbitrary, (facts) => {
        const uniqueFacts = facts.filter(
          (fact, index) =>
            facts.findIndex((other) =>
              other.kind === "expense" && fact.kind === "expense"
                ? other.expenseId === fact.expenseId
                : other.kind === "settlement" && fact.kind === "settlement"
                  ? other.settlementId === fact.settlementId
                  : false,
            ) === index,
        );
        const balances = projectBalances(uniqueFacts);

        expect(balances.reduce((sum, row) => sum + row.netCents, 0)).toBe(0);
        expect(balances.every((row) => row.netCents !== 0)).toBe(true);

        const transfers = projectTransfers(uniqueFacts);
        expect(transfers.every((transfer) => transfer.amountCents > 0)).toBe(true);
        expect(netsFromEdges(transfers)).toEqual(netsFromBalances(balances));
        expect(netsFromEdges(projectPairwiseEdges(uniqueFacts))).toEqual(
          netsFromBalances(balances),
        );
      }),
      propertyConfig(200),
    );
  });

  it("treats delete then restore as a no-op", () => {
    fc.assert(
      fc.property(factsArbitrary, (facts) => {
        const target = facts.find((fact) => fact.kind === "expense" && fact.status === "active");
        if (!target) return;
        const deleted = facts.map((fact) =>
          fact === target ? { ...(fact as ExpenseFact), status: "deleted" as const } : fact,
        );
        const restored = deleted.map((fact) =>
          fact.kind === "expense" && fact.expenseId === (target as ExpenseFact).expenseId
            ? { ...fact, status: "active" as const }
            : fact,
        );

        expect(projectBalances(restored)).toEqual(projectBalances(facts));
        expect(projectPairwiseEdges(restored)).toEqual(projectPairwiseEdges(facts));
      }),
      propertyConfig(200),
    );
  });
});
