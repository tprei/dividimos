import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { projectBalances } from "@/lib/ledger/model";
import { factsAfter, planEpisode } from "@/lib/ledger/walk";
import { propertyConfig } from "@/test/property";

const MEMBER_IDS = ["m0", "m1", "m2", "m3", "m4"];

function idsFor(memberCount: number): string[] {
  return MEMBER_IDS.slice(0, memberCount);
}

describe("planEpisode", () => {
  it("plans the same journey for the same seed", () => {
    const first = planEpisode({ seed: 4242, memberCount: 4, steps: 10 });
    const second = planEpisode({ seed: 4242, memberCount: 4, steps: 10 });
    const other = planEpisode({ seed: 4243, memberCount: 4, steps: 10 });

    expect(second).toEqual(first);
    expect(other).not.toEqual(first);
  });

  it("refuses a journey with nobody to split with", () => {
    expect(() => planEpisode({ seed: 1, memberCount: 1, steps: 4 })).toThrow(
      /at least two members/,
    );
  });

  it("closes every journey at zero and proposes only legal actions", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2 ** 31 - 1 }),
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 1, max: 14 }),
        (seed, memberCount, steps) => {
          const plan = planEpisode({ seed, memberCount, steps });
          const ids = idsFor(memberCount);

          // Nothing is owed once the journey ends: that is what lets the
          // group be reused and what makes "reset" mean something.
          expect(projectBalances(factsAfter(plan, plan.actions.length, ids))).toEqual([]);

          const seenExpenses = new Map<string, { active: boolean; participants: number[] }>();
          const seenSettlements = new Map<string, { confirmed: boolean; from: number; to: number }>();

          plan.actions.forEach((action, index) => {
            const before = factsAfter(plan, index, ids);
            const balances = projectBalances(before);
            const netOf = (member: number) =>
              balances.find((row) => row.participantId === ids[member])?.netCents ?? 0;

            switch (action.kind) {
              case "create": {
                const { participants, shares, payers, totalCents, serviceFeeBps } = action.plan;
                expect(new Set(participants).size).toBe(participants.length);
                expect(participants.length).toBeGreaterThanOrEqual(2);
                // create_expense rejects a creator who is not a participant.
                expect(participants[0]).toBe(action.actor);
                expect(totalCents).toBeGreaterThanOrEqual(1);
                expect(totalCents).toBeLessThanOrEqual(99_999_999);
                expect(shares.reduce((sum, value) => sum + value, 0)).toBe(totalCents);
                expect(payers.reduce((sum, payer) => sum + payer.amountCents, 0)).toBe(totalCents);
                expect(payers.every((payer) => payer.amountCents > 0)).toBe(true);
                expect(new Set(payers.map((payer) => payer.participantIndex)).size).toBe(
                  payers.length,
                );
                expect(serviceFeeBps).toBeGreaterThanOrEqual(0);
                expect(serviceFeeBps).toBeLessThanOrEqual(10_000);
                seenExpenses.set(action.key, { active: true, participants });
                break;
              }
              case "edit": {
                const target = seenExpenses.get(action.targetKey);
                expect(target?.active).toBe(true);
                expect(action.shares.length).toBe(target?.participants.length);
                break;
              }
              case "delete": {
                expect(seenExpenses.get(action.targetKey)?.active).toBe(true);
                seenExpenses.set(action.targetKey, {
                  ...(seenExpenses.get(action.targetKey) ?? { participants: [] }),
                  active: false,
                });
                break;
              }
              case "restore": {
                expect(seenExpenses.get(action.targetKey)?.active).toBe(false);
                seenExpenses.set(action.targetKey, {
                  ...(seenExpenses.get(action.targetKey) ?? { participants: [] }),
                  active: true,
                });
                break;
              }
              case "settle": {
                expect(action.from).not.toBe(action.to);
                expect(action.actor === action.from || action.actor === action.to).toBe(true);
                expect(action.amountCents).toBeGreaterThanOrEqual(1);
                expect(action.amountCents).toBeLessThanOrEqual(99_999_999);
                if (!action.allowOverpay) {
                  // record_settlement raises amount_exceeds_debt otherwise.
                  expect(netOf(action.from)).toBeLessThan(0);
                  expect(netOf(action.to)).toBeGreaterThan(0);
                  expect(action.amountCents).toBeLessThanOrEqual(-netOf(action.from));
                  expect(action.amountCents).toBeLessThanOrEqual(netOf(action.to));
                }
                seenSettlements.set(action.key, {
                  confirmed: true,
                  from: action.from,
                  to: action.to,
                });
                break;
              }
              case "void": {
                const target = seenSettlements.get(action.targetKey);
                expect(target?.confirmed).toBe(true);
                expect(action.actor === target?.from || action.actor === target?.to).toBe(true);
                seenSettlements.set(action.targetKey, { ...target!, confirmed: false });
                break;
              }
            }
          });
        },
      ),
      propertyConfig(200),
    );
  });

  it("keeps the ledger closed at every point of the journey", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2 ** 31 - 1 }), (seed) => {
        const plan = planEpisode({ seed, memberCount: 4, steps: 12 });
        const ids = idsFor(4);
        for (let count = 0; count <= plan.actions.length; count++) {
          const balances = projectBalances(factsAfter(plan, count, ids));
          expect(balances.reduce((sum, row) => sum + row.netCents, 0)).toBe(0);
        }
      }),
      propertyConfig(100),
    );
  });
});
