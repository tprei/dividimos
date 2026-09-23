import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  ROOM_TICKS_PER_MILLIUNIT,
  buildAssignmentDivision,
} from "@/lib/assignment-room-money";
import {
  previewClaimCents,
  projectAssignmentRoomMoney,
} from "@/lib/assignment-room-projection";
import {
  MAX_EXPENSE_CENTS,
  computeServiceFeeCents,
  type ExpenseCents,
} from "@/lib/expense-money";
import {
  computeExpenseLineTotalCents,
  type ExpenseQuantity,
} from "@/lib/expense-quantity";
import { propertyConfig } from "@/test/property";
import type {
  AssignmentRoomClaim,
  AssignmentRoomItem,
  AssignmentRoomParticipant,
  AssignmentRoomSnapshot,
  AssignmentRoomView,
} from "@/types/assignment-room";

type HostView = Extract<AssignmentRoomView, { role: "host" }>;

function makeParticipant(
  id: string,
  ordinal: number,
  removed = false,
): AssignmentRoomParticipant {
  return {
    id,
    ordinal,
    displayName: `Participant ${ordinal}`,
    avatarUrl: null,
    isGuest: ordinal % 2 === 1,
    removed,
  };
}

describe("projectAssignmentRoomMoney & previewClaimCents", () => {
  describe("(a) property test with PROPERTY_RUNS (>= 200)", () => {
    it("matches buildAssignmentDivision shares and total for random fully-claimed closed rooms", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 8 }), // activeCount
          fc.integer({ min: 0, max: 3 }), // removedCount
          fc.integer({ min: 1, max: 8 }), // itemCount
          fc.integer({ min: 0, max: 3000 }), // serviceFeeBasisPoints
          fc.integer({ min: 0, max: 2000 }), // fixedFeeCents
          fc.array(
            fc.record({
              quantityMilliunits: fc.oneof(
                fc.integer({ min: 1, max: 5 }).map((units) => units * 1000),
                fc.integer({ min: 100, max: 5000 }),
              ),
              unitPriceCents: fc.integer({ min: 1, max: 3000 }),
              weights: fc.array(fc.integer({ min: 0, max: 1000 }), {
                minLength: 1,
                maxLength: 8,
              }),
            }),
            { minLength: 1, maxLength: 8 },
          ),
          (
            activeCount,
            removedCount,
            rawItemCount,
            serviceFeeBasisPoints,
            fixedFeeCents,
            itemSeeds,
          ) => {
            const actualItemCount = Math.min(rawItemCount, itemSeeds.length);
            fc.pre(actualItemCount >= 1);

            const participants: AssignmentRoomParticipant[] = [];
            for (let i = 0; i < activeCount; i++) {
              participants.push(makeParticipant(`p-active-${i}`, i, false));
            }
            for (let i = 0; i < removedCount; i++) {
              participants.push(
                makeParticipant(`p-removed-${i}`, activeCount + i, true),
              );
            }

            const items: AssignmentRoomItem[] = [];
            const claims: AssignmentRoomClaim[] = [];
            let subtotal = 0;

            for (let j = 0; j < actualItemCount; j++) {
              const seed = itemSeeds[j];
              const quantityMilliunits = seed.quantityMilliunits;
              const unitPriceCents = seed.unitPriceCents;
              const lineTotal = computeExpenseLineTotalCents(
                quantityMilliunits as ExpenseQuantity,
                unitPriceCents as ExpenseCents,
              );
              fc.pre(lineTotal.ok);
              const totalPriceCents = lineTotal.value;
              fc.pre(totalPriceCents > 0);
              subtotal += totalPriceCents;

              const itemId = `item-${j}`;
              items.push({
                id: itemId,
                ordinal: j,
                revision: 1,
                description: `Item ${j}`,
                quantityMilliunits,
                unitPriceCents,
                totalPriceCents,
              });

              const capacity = quantityMilliunits * ROOM_TICKS_PER_MILLIUNIT;

              // Partition capacity across active participants
              const rawWeights = Array.from(
                { length: activeCount },
                (_, idx) => seed.weights[idx] ?? 0,
              );
              let sumW = rawWeights.reduce((a, b) => a + b, 0);
              if (sumW === 0) {
                rawWeights[0] = 1;
                sumW = 1;
              }

              let baseSum = 0;
              const bases: number[] = [];
              const remainders: { remainder: number; index: number }[] = [];

              for (let k = 0; k < activeCount; k++) {
                const prod = capacity * rawWeights[k];
                const base = Math.floor(prod / sumW);
                bases.push(base);
                remainders.push({ remainder: prod - base * sumW, index: k });
                baseSum += base;
              }

              const leftover = capacity - baseSum;
              remainders.sort((a, b) =>
                a.remainder === b.remainder
                  ? a.index - b.index
                  : b.remainder - a.remainder,
              );
              for (let k = 0; k < leftover; k++) {
                bases[remainders[k].index] += 1;
              }

              // Verify partition sums to capacity
              expect(bases.reduce((a, b) => a + b, 0)).toBe(capacity);

              for (let k = 0; k < activeCount; k++) {
                if (bases[k] > 0) {
                  claims.push({
                    itemId,
                    participantId: participants[k].id,
                    ticks: bases[k],
                  });
                }
              }

              // Optionally add a claim for a removed participant to verify it is ignored
              if (removedCount > 0) {
                claims.push({
                  itemId,
                  participantId: participants[activeCount].id,
                  ticks: 500,
                });
              }
            }

            fc.pre(subtotal <= (MAX_EXPENSE_CENTS as number));

            const serviceFee = computeServiceFeeCents(
              subtotal,
              serviceFeeBasisPoints,
            );
            fc.pre(serviceFee.ok);

            const grandTotal = subtotal + serviceFee.value + fixedFeeCents;
            fc.pre(grandTotal <= (MAX_EXPENSE_CENTS as number));

            const room: AssignmentRoomSnapshot = {
              id: "room-prop-test",
              revision: 1,
              status: "closed",
              title: "Property Test Room",
              occurredOn: "2026-09-23",
              serviceFeeBasisPoints,
              fixedFeeCents,
              totalCents: grandTotal,
              selfParticipantId: participants[0].id,
              items,
              participants,
              claims,
              topic: null,
              currentBill: null,
            };

            const activeParticipants = participants.filter((p) => !p.removed);
            const hostView: HostView = {
              role: "host",
              room,
              groupTarget: { kind: "new", name: "PropGroup" },
              participantRefs: activeParticipants.map((p) => ({
                participantId: p.id,
                ref: {
                  kind: "guest",
                  guestId: null,
                  displayName: p.displayName,
                },
              })),
            };

            const divisionResult = buildAssignmentDivision(hostView);
            expect(divisionResult.ok).toBe(true);
            if (!divisionResult.ok) return;

            const projectionResult = projectAssignmentRoomMoney(room);
            expect(projectionResult.ok).toBe(true);
            if (!projectionResult.ok) return;

            const division = divisionResult.value;
            const projection = projectionResult.value;

            // Grand total matches division payload total
            const divisionTotal = division.shares.reduce((a, b) => a + b, 0);
            expect(projection.totalCents).toBe(divisionTotal);
            expect(projection.itemsSubtotalCents).toBe(subtotal);
            expect(projection.claimedItemsCents).toBe(subtotal);
            expect(projection.unclaimedItemsCents).toBe(0);
            expect(projection.unownedLineCount).toBe(0);

            // Every active participant's withFeeCents equals their division share by index
            activeParticipants.forEach((p, idx) => {
              const money = projection.byParticipant[p.id];
              expect(money).toBeDefined();
              expect(money.withFeeCents).toBe(division.shares[idx]);
            });
          },
        ),
        propertyConfig(200),
      );
    });
  });

  describe("(b) partially claimed room", () => {
    it("satisfies claimedItemsCents + unclaimedItemsCents === itemsSubtotalCents and consistent byItem", () => {
      const room: AssignmentRoomSnapshot = {
        id: "room-partial-test",
        revision: 1,
        status: "open",
        title: "Partially Claimed Room",
        occurredOn: "2026-09-23",
        serviceFeeBasisPoints: 1000,
        fixedFeeCents: 100,
        totalCents: 1600,
        selfParticipantId: "p-alice",
        items: [
          {
            id: "item-2units",
            ordinal: 0,
            revision: 1,
            description: "2-unit item",
            quantityMilliunits: 2000,
            unitPriceCents: 500,
            totalPriceCents: 1000,
          },
          {
            id: "item-single",
            ordinal: 1,
            revision: 1,
            description: "1-unit item",
            quantityMilliunits: 1000,
            unitPriceCents: 300,
            totalPriceCents: 300,
          },
        ],
        participants: [
          makeParticipant("p-alice", 0),
          makeParticipant("p-bob", 1),
        ],
        claims: [
          // Alice owns exactly half of the 2-unit line (120,000 of 240,000 ticks)
          { itemId: "item-2units", participantId: "p-alice", ticks: 120_000 },
          // Bob owns 1/3 of the 1-unit line (40,000 of 120,000 ticks)
          { itemId: "item-single", participantId: "p-bob", ticks: 40_000 },
        ],
        topic: null,
        currentBill: null,
      };

      const result = projectAssignmentRoomMoney(room);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const proj = result.value;

      // Invariants
      expect(proj.itemsSubtotalCents).toBe(1300);
      expect(proj.claimedItemsCents + proj.unclaimedItemsCents).toBe(
        proj.itemsSubtotalCents,
      );
      expect(proj.unownedLineCount).toBe(2);

      // Participant owning half of a 2-unit line gets half its cents
      const item2Units = proj.byItem["item-2units"];
      expect(item2Units).toBeDefined();
      expect(item2Units.remainingTicks).toBe(120_000);
      expect(item2Units.unclaimedCents).toBe(500); // 1000 / 2 = 500
      expect(item2Units.claims).toHaveLength(1);
      expect(item2Units.claims[0].participantId).toBe("p-alice");
      expect(item2Units.claims[0].amountCents).toBe(500);

      // byItem consistency
      const itemSingle = proj.byItem["item-single"];
      expect(itemSingle).toBeDefined();
      expect(itemSingle.remainingTicks).toBe(80_000);
      expect(itemSingle.claims[0].amountCents + itemSingle.unclaimedCents).toBe(
        300,
      );

      const sumUnclaimed =
        item2Units.unclaimedCents + itemSingle.unclaimedCents;
      expect(sumUnclaimed).toBe(proj.unclaimedItemsCents);

      const sumClaimed =
        proj.byParticipant["p-alice"].itemsCents +
        proj.byParticipant["p-bob"].itemsCents;
      expect(sumClaimed).toBe(proj.claimedItemsCents);
    });
  });

  describe("(c) removed participants contribute nothing", () => {
    it("ignores removed participants claims, items, fees, and byParticipant entries", () => {
      const roomWithRemoved: AssignmentRoomSnapshot = {
        id: "room-removed-test",
        revision: 1,
        status: "open",
        title: "Removed Test",
        occurredOn: "2026-09-23",
        serviceFeeBasisPoints: 1000,
        fixedFeeCents: 200,
        totalCents: 1320,
        selfParticipantId: "p-host",
        items: [
          {
            id: "item-1",
            ordinal: 0,
            revision: 1,
            description: "Item 1",
            quantityMilliunits: 1000,
            unitPriceCents: 1000,
            totalPriceCents: 1000,
          },
        ],
        participants: [
          makeParticipant("p-host", 0, false),
          makeParticipant("p-guest", 1, false),
          makeParticipant("p-removed", 2, true),
        ],
        claims: [
          { itemId: "item-1", participantId: "p-host", ticks: 60_000 },
          // Removed participant has claims
          { itemId: "item-1", participantId: "p-removed", ticks: 60_000 },
        ],
        topic: null,
        currentBill: null,
      };

      const result = projectAssignmentRoomMoney(roomWithRemoved);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const proj = result.value;

      // Removed participant is not in byParticipant
      expect(proj.byParticipant["p-removed"]).toBeUndefined();
      expect(proj.byParticipant["p-host"]).toBeDefined();
      expect(proj.byParticipant["p-guest"]).toBeDefined();

      // Removed participant's claim is ignored on the item line
      const itemMoney = proj.byItem["item-1"];
      expect(itemMoney.claims).toHaveLength(1);
      expect(itemMoney.claims[0].participantId).toBe("p-host");
      expect(itemMoney.claims[0].amountCents).toBe(500);

      // The 60_000 ticks from removed are treated as unclaimed
      expect(itemMoney.remainingTicks).toBe(60_000);
      expect(itemMoney.unclaimedCents).toBe(500);

      // Fixed fee (200 cents) is split evenly between the 2 active participants (100 cents each)
      // Host: 500 items + 50 service fee + 100 fixed fee = 650
      // Guest: 0 items + 0 service fee + 100 fixed fee = 100
      expect(proj.byParticipant["p-host"].withFeeCents).toBe(650);
      expect(proj.byParticipant["p-guest"].withFeeCents).toBe(100);
      expect(proj.byParticipant["p-host"].lineCount).toBe(1);
      expect(proj.byParticipant["p-guest"].lineCount).toBe(0);
    });
  });

  describe("(d) previewClaimCents equals byItem amount after actually applying that claim", () => {
    it("matches the projected byItem amount across new, modified, and zero claims", () => {
      const baseRoom: AssignmentRoomSnapshot = {
        id: "room-preview-test",
        revision: 1,
        status: "open",
        title: "Preview Test Room",
        occurredOn: "2026-09-23",
        serviceFeeBasisPoints: 1000,
        fixedFeeCents: 50,
        totalCents: 1150,
        selfParticipantId: "p-ana",
        items: [
          {
            id: "item-shared",
            ordinal: 0,
            revision: 1,
            description: "Prato Principal",
            quantityMilliunits: 1000,
            unitPriceCents: 1000,
            totalPriceCents: 1000,
          },
        ],
        participants: [
          makeParticipant("p-ana", 0),
          makeParticipant("p-bruno", 1),
          makeParticipant("p-carla", 2),
        ],
        claims: [
          { itemId: "item-shared", participantId: "p-ana", ticks: 40_000 },
        ],
        topic: null,
        currentBill: null,
      };

      const item = baseRoom.items[0];

      // Scenario 1: New claim for Bruno on the item (40,000 ticks)
      const preview1 = previewClaimCents(baseRoom, item.id, "p-bruno", 40_000);
      expect(preview1.ok).toBe(true);

      const roomAfterBruno: AssignmentRoomSnapshot = {
        ...baseRoom,
        claims: [
          ...baseRoom.claims,
          { itemId: item.id, participantId: "p-bruno", ticks: 40_000 },
        ],
      };
      const projAfterBruno = projectAssignmentRoomMoney(roomAfterBruno);
      expect(projAfterBruno.ok).toBe(true);
      if (preview1.ok && projAfterBruno.ok) {
        const brunoClaim = projAfterBruno.value.byItem[item.id].claims.find(
          (c) => c.participantId === "p-bruno",
        );
        expect(preview1.value).toBe(brunoClaim?.amountCents);
      }

      // Scenario 2: Ana changes her claim from 40,000 to 60,000 ticks
      const preview2 = previewClaimCents(roomAfterBruno, item.id, "p-ana", 60_000);
      expect(preview2.ok).toBe(true);

      const roomAfterAnaUpdate: AssignmentRoomSnapshot = {
        ...roomAfterBruno,
        claims: [
          { itemId: item.id, participantId: "p-ana", ticks: 60_000 },
          { itemId: item.id, participantId: "p-bruno", ticks: 40_000 },
        ],
      };
      const projAfterAnaUpdate = projectAssignmentRoomMoney(roomAfterAnaUpdate);
      expect(projAfterAnaUpdate.ok).toBe(true);
      if (preview2.ok && projAfterAnaUpdate.ok) {
        const anaClaim = projAfterAnaUpdate.value.byItem[item.id].claims.find(
          (c) => c.participantId === "p-ana",
        );
        expect(preview2.value).toBe(anaClaim?.amountCents);
      }

      // Scenario 3: Bruno reduces his claim to 0 ticks
      const previewZero = previewClaimCents(roomAfterAnaUpdate, item.id, "p-bruno", 0);
      expect(previewZero.ok).toBe(true);
      if (previewZero.ok) {
        expect(previewZero.value).toBe(0);
      }

      const roomAfterBrunoZero: AssignmentRoomSnapshot = {
        ...roomAfterAnaUpdate,
        claims: [
          { itemId: item.id, participantId: "p-ana", ticks: 60_000 },
          { itemId: item.id, participantId: "p-bruno", ticks: 0 },
        ],
      };
      const projAfterBrunoZero = projectAssignmentRoomMoney(roomAfterBrunoZero);
      expect(projAfterBrunoZero.ok).toBe(true);
      if (projAfterBrunoZero.ok) {
        const brunoClaim = projAfterBrunoZero.value.byItem[item.id].claims.find(
          (c) => c.participantId === "p-bruno",
        );
        expect(brunoClaim?.amountCents).toBe(0);
      }

      // Scenario 4: Overclaiming returns allocation_exceeds_total
      const overclaim = previewClaimCents(roomAfterAnaUpdate, item.id, "p-carla", 80_000);
      expect(overclaim.ok).toBe(false);
      if (!overclaim.ok) {
        expect(overclaim.issue.code).toBe("allocation_exceeds_total");
      }
    });
  });
});
