import { describe, expect, it } from "vitest";
import {
  attributeItem,
  attributePayers,
  shareBasisPoints,
} from "./expense-attribution";
import type { ExpenseItemAssignmentPayload } from "@/types/ledger";

function assignment(
  itemIndex: number,
  participantIndex: number,
  amountCents: number,
): ExpenseItemAssignmentPayload {
  return { itemIndex, participantIndex, amountCents };
}

describe("shareBasisPoints", () => {
  it("returns 0 when the whole is not positive", () => {
    expect(shareBasisPoints(5000, 0)).toBe(0);
    expect(shareBasisPoints(5000, -100)).toBe(0);
  });

  it("rounds the ratio to basis points", () => {
    expect(shareBasisPoints(1, 3)).toBe(3333);
    expect(shareBasisPoints(7000, 12000)).toBe(5833);
    expect(shareBasisPoints(5000, 10000)).toBe(5000);
  });
});

describe("attributeItem", () => {
  it("sums exact consumers to an unassignedCents of zero", () => {
    const result = attributeItem(0, 12000, [
      assignment(0, 0, 7000),
      assignment(0, 1, 5000),
    ]);

    expect(result.consumers).toHaveLength(2);
    expect(result.assignedCents).toBe(12000);
    expect(result.unassignedCents).toBe(0);
    expect(result.consumers[0]).toEqual({
      participantIndex: 0,
      amountCents: 7000,
      basisPoints: 5833,
    });
    expect(result.consumers[1].basisPoints).toBe(4167);
  });

  it("reports the leftover cents when assignments only cover part of the item", () => {
    const result = attributeItem(0, 10000, [assignment(0, 2, 4000)]);

    expect(result.assignedCents).toBe(4000);
    expect(result.unassignedCents).toBe(6000);
    expect(result.unassignedCents).toBeGreaterThan(0);
  });

  it("reports negative cents when assignments exceed the item total", () => {
    const result = attributeItem(0, 1000, [
      assignment(0, 0, 700),
      assignment(0, 1, 500),
    ]);

    expect(result.assignedCents).toBe(1200);
    expect(result.unassignedCents).toBe(-200);
    expect(result.unassignedCents).toBeLessThan(0);
  });

  it("returns no consumers when the item has no assignments", () => {
    const none = attributeItem(0, 5000, null);
    expect(none.consumers).toEqual([]);
    expect(none.assignedCents).toBe(0);
    expect(none.unassignedCents).toBe(5000);

    const otherItemOnly = attributeItem(0, 5000, [assignment(1, 0, 2000)]);
    expect(otherItemOnly.consumers).toEqual([]);
    expect(otherItemOnly.unassignedCents).toBe(5000);
  });

  it("sorts consumers by cents descending with participantIndex as the tiebreak", () => {
    const result = attributeItem(0, 9000, [
      assignment(0, 2, 1000),
      assignment(0, 0, 4000),
      assignment(0, 1, 4000),
    ]);

    expect(result.consumers.map((c) => c.participantIndex)).toEqual([0, 1, 2]);
  });
});

describe("attributePayers", () => {
  it("drops zero-cent payers", () => {
    const result = attributePayers(
      [
        { participantIndex: 0, amountCents: 0 },
        { participantIndex: 1, amountCents: 3000 },
      ],
      3000,
    );

    expect(result).toEqual([
      { participantIndex: 1, amountCents: 3000, basisPoints: 10000 },
    ]);
  });

  it("sorts payers by cents descending with participantIndex as the tiebreak", () => {
    const result = attributePayers(
      [
        { participantIndex: 2, amountCents: 1000 },
        { participantIndex: 1, amountCents: 4000 },
        { participantIndex: 0, amountCents: 4000 },
      ],
      9000,
    );

    expect(result.map((p) => p.participantIndex)).toEqual([0, 1, 2]);
    expect(result.map((p) => p.amountCents)).toEqual([4000, 4000, 1000]);
    expect(result[2].basisPoints).toBe(1111);
  });
});
