import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { applyExpenseDelta, applySettlementDelta } from "@/lib/ledger/apply";
import type { BalanceRow, ExpensePayload } from "@/types/ledger";
import { propertyConfig } from "@/test/property";

const MAX_MAGNITUDE = 1_000_000;

function sortRows(rows: BalanceRow[]): BalanceRow[] {
  return [...rows].sort((a, b) =>
    a.kind === b.kind ? a.participantId.localeCompare(b.participantId) : a.kind < b.kind ? -1 : 1,
  );
}

function evenSplit(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  const rest = total % count;
  return Array.from({ length: count }, (_, index) => (index < rest ? base + 1 : base));
}

const distinctIds = fc
  .array(fc.uuid(), { minLength: 4, maxLength: 12 })
  .filter((ids) => new Set(ids).size === ids.length);

function balancesFrom(ids: readonly string[]): fc.Arbitrary<BalanceRow[]> {
  return fc
    .array(
      fc.record({
        index: fc.nat({ max: Math.min(6, ids.length) - 1 }),
        kind: fc.constantFrom<BalanceRow["kind"]>("user", "user", "guest"),
        netCents: fc.integer({ min: -MAX_MAGNITUDE, max: MAX_MAGNITUDE }).filter((n) => n !== 0),
      }),
      { maxLength: 8 },
    )
    .map((rows) => {
      const seen = new Set<string>();
      const unique: BalanceRow[] = [];
      for (const row of rows) {
        const key = `${row.kind}:${ids[row.index]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push({ kind: row.kind, participantId: ids[row.index], netCents: row.netCents });
      }
      return sortRows(unique);
    });
}

function zeroSumFrom(ids: readonly string[]): fc.Arbitrary<BalanceRow[]> {
  return fc
    .array(fc.integer({ min: -MAX_MAGNITUDE, max: MAX_MAGNITUDE }), {
      minLength: 2,
      maxLength: Math.min(6, ids.length),
    })
    .map((nets): BalanceRow[] => {
      const head = nets.slice(0, -1);
      const closing = 0 - head.reduce((sum, net) => sum + net, 0);
      return sortRows(
        [...head, closing]
          .map((netCents, index) => ({
            kind: "user" as const,
            participantId: ids[index],
            netCents,
          }))
          .filter((row) => row.netCents !== 0),
      );
    });
}

function payloadFrom(ids: readonly string[]): fc.Arbitrary<ExpensePayload> {
  return fc
    .record({
      size: fc.integer({ min: 2, max: Math.min(6, ids.length) }),
      total: fc.integer({ min: 1, max: 99_999_999 }),
      payerCount: fc.integer({ min: 1, max: 3 }),
    })
    .map(({ size, total, payerCount }): ExpensePayload => {
      const chosen = ids.slice(0, size);
      const payers = Math.min(payerCount, size);
      return {
        items: [],
        participants: chosen.map((userId) => ({ kind: "user", userId })),
        shares: evenSplit(total, size),
        payers: evenSplit(total, payers).map((amountCents, participantIndex) => ({
          participantIndex,
          amountCents,
        })),
        itemAssignments: null,
      };
    });
}

/**
 * Balances and a payload drawn from one shared pool of participant ids, so the
 * delta lands on existing rows, creates new ones, and drives some rows to zero
 * where mergeDeltas drops them.
 */
const overlappingLedger = distinctIds.chain((ids) =>
  fc.record({ balances: balancesFrom(ids), payload: payloadFrom(ids) }),
);

const zeroSumLedger = distinctIds.chain((ids) =>
  fc.record({ balances: zeroSumFrom(ids), payload: payloadFrom(ids) }),
);

describe("applyExpenseDelta", () => {
  it("is reversed exactly by the opposite sign", () => {
    fc.assert(
      fc.property(overlappingLedger, ({ balances, payload }) => {
        const applied = applyExpenseDelta(balances, payload, 1);
        expect(applyExpenseDelta(applied, payload, -1)).toEqual(balances);
      }),
      propertyConfig(500),
    );
  });

  it("keeps a zero-sum ledger at zero", () => {
    fc.assert(
      fc.property(zeroSumLedger, ({ balances, payload }) => {
        const applied = applyExpenseDelta(balances, payload, 1);
        expect(applied.reduce((sum, row) => sum + row.netCents, 0)).toBe(0);
      }),
      propertyConfig(500),
    );
  });

  it("never leaves a zero row behind", () => {
    fc.assert(
      fc.property(overlappingLedger, ({ balances, payload }) => {
        const applied = applyExpenseDelta(balances, payload, 1);
        expect(applied.filter((row) => row.netCents === 0)).toEqual([]);
      }),
      propertyConfig(500),
    );
  });
});

describe("applySettlementDelta", () => {
  it("is reversed exactly by the opposite sign", () => {
    fc.assert(
      fc.property(
        overlappingLedger,
        fc.nat({ max: 100 }),
        fc.nat({ max: 100 }),
        fc.integer({ min: 1, max: 99_999_999 }),
        ({ balances, payload }, fromPick, toPick, amountCents) => {
          const users = payload.participants.flatMap((participant) =>
            participant.kind === "user" ? [participant.userId] : [],
          );
          const fromUserId = users[fromPick % users.length];
          const toUserId = users[toPick % users.length];
          fc.pre(fromUserId !== toUserId);

          const settlement = { fromUserId, toUserId, amountCents };
          const applied = applySettlementDelta(balances, settlement, 1);
          expect(applySettlementDelta(applied, settlement, -1)).toEqual(balances);
        },
      ),
      propertyConfig(500),
    );
  });
});
