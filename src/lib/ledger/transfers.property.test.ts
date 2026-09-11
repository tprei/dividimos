import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { transfersFromBalances } from "@/lib/ledger/transfers";
import type { BalanceRow } from "@/types/ledger";
import { propertyConfig } from "@/test/property";

const MAX_MAGNITUDE = 1_000_000_000;

const zeroSumBalances = fc
  .array(
    fc.record({
      participantId: fc.uuid(),
      kind: fc.constantFrom<BalanceRow["kind"]>("user", "guest"),
      netCents: fc.integer({ min: -MAX_MAGNITUDE, max: MAX_MAGNITUDE }),
    }),
    { minLength: 2, maxLength: 10 },
  )
  .map((rows): BalanceRow[] => {
    const head = rows.slice(0, -1);
    const closing = 0 - head.reduce((sum, row) => sum + row.netCents, 0);
    return [...head, { ...rows[rows.length - 1], netCents: closing }];
  })
  .filter((rows) => {
    const ids = rows.map((row) => row.participantId);
    return (
      new Set(ids).size === ids.length &&
      Math.abs(rows[rows.length - 1].netCents) <= MAX_MAGNITUDE
    );
  });

describe("transfersFromBalances", () => {
  it("settles every participant with at most n-1 transfers", () => {
    fc.assert(
      fc.property(zeroSumBalances, (balances) => {
        const transfers = transfersFromBalances(balances);
        const debtors = new Set(
          balances.filter((row) => row.netCents < 0).map((row) => row.participantId),
        );
        const creditors = new Set(
          balances.filter((row) => row.netCents > 0).map((row) => row.participantId),
        );

        for (const transfer of transfers) {
          expect(transfer.amountCents).toBeGreaterThanOrEqual(1);
          expect(transfer.fromId).not.toBe(transfer.toId);
          expect(debtors.has(transfer.fromId)).toBe(true);
          expect(creditors.has(transfer.toId)).toBe(true);
        }

        const nonZero = balances.filter((row) => row.netCents !== 0).length;
        expect(transfers.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));

        const remaining = new Map(balances.map((row) => [row.participantId, row.netCents]));
        for (const transfer of transfers) {
          remaining.set(transfer.fromId, remaining.get(transfer.fromId)! + transfer.amountCents);
          remaining.set(transfer.toId, remaining.get(transfer.toId)! - transfer.amountCents);
        }
        for (const net of remaining.values()) {
          expect(net).toBe(0);
        }
      }),
      propertyConfig(500),
    );
  });

  it("does not depend on the order the balances arrive in", () => {
    fc.assert(
      fc.property(
        zeroSumBalances,
        fc.array(fc.nat(), { minLength: 10, maxLength: 10 }),
        (balances, swaps) => {
          const shuffled = [...balances];
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = swaps[i % swaps.length] % (i + 1);
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          expect(transfersFromBalances(shuffled)).toEqual(transfersFromBalances(balances));
        },
      ),
      propertyConfig(500),
    );
  });
});
