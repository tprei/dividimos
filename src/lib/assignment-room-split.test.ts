import { describe, expect, it } from "vitest";

import { ROOM_TICKS_PER_UNIT } from "@/lib/assignment-room-money";
import {
  changedShares,
  isEvenSplit,
  percentToTicks,
  shareToPercent,
  splitDraftStatus,
  splitTicksEvenly,
} from "@/lib/assignment-room-split";
import type { AssignmentItemShare } from "@/types/assignment-room";

const CAPACITY = ROOM_TICKS_PER_UNIT;

function share(participantId: string, ticks: number): AssignmentItemShare {
  return { participantId, ticks };
}

describe("splitTicksEvenly", () => {
  it("splits one unit seven ways with the first remainder people one tick ahead", () => {
    const ids = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
    const shares = splitTicksEvenly(CAPACITY, ids);

    expect(shares.map((s) => s.participantId)).toEqual(ids);
    expect(shares.reduce((sum, s) => sum + s.ticks, 0)).toBe(120_000);
    expect(shares[6]).toEqual(share("p7", 17_142));
    for (let i = 0; i < 120_000 % 7; i++) {
      expect(shares[i].ticks).toBe(17_143);
    }
  });

  it("returns no shares for no people", () => {
    expect(splitTicksEvenly(CAPACITY, [])).toEqual([]);
  });

  it("rejects duplicate participant ids", () => {
    expect(() => splitTicksEvenly(CAPACITY, ["p1", "p1"])).toThrow(RangeError);
  });
});

describe("shareToPercent & percentToTicks", () => {
  it("round trips 0, 33, and 100 percent", () => {
    for (const percent of [0, 33, 100]) {
      expect(shareToPercent(CAPACITY, percentToTicks(CAPACITY, percent))).toBe(
        percent,
      );
    }
  });

  it("returns the exact capacity for 100 percent on an odd capacity", () => {
    expect(percentToTicks(999_999, 100)).toBe(999_999);
  });

  it("rejects non-integer and out-of-range percents", () => {
    expect(() => percentToTicks(CAPACITY, 33.5)).toThrow(RangeError);
    expect(() => percentToTicks(CAPACITY, -1)).toThrow(RangeError);
    expect(() => percentToTicks(CAPACITY, 101)).toThrow(RangeError);
  });
});

describe("splitDraftStatus", () => {
  it("reports remaining ticks while under capacity and over ticks beyond it", () => {
    expect(
      splitDraftStatus(CAPACITY, [share("a", 40_000), share("b", 40_000)]),
    ).toEqual({ assignedTicks: 80_000, remainingTicks: 40_000, overTicks: 0 });
    expect(
      splitDraftStatus(1_000, [share("a", 600), share("b", 500)]),
    ).toEqual({ assignedTicks: 1_100, remainingTicks: 0, overTicks: 100 });
  });
});

describe("changedShares", () => {
  it("zeroes a person dropped from the draft and omits unchanged people", () => {
    const saved = [share("ana", 40_000), share("bruno", 40_000), share("carla", 40_000)];
    const draft = [share("ana", 40_000), share("bruno", 40_000)];

    expect(changedShares(saved, draft)).toEqual([share("carla", 0)]);
  });

  it("reports new and retuned people in draft order first", () => {
    const saved = [share("bruno", 40_000)];
    const draft = [share("carla", 30_000), share("bruno", 90_000)];

    expect(changedShares(saved, draft)).toEqual([
      share("carla", 30_000),
      share("bruno", 90_000),
    ]);
  });
});

describe("isEvenSplit", () => {
  it("accepts the seven-way remainder split", () => {
    const shares = splitTicksEvenly(CAPACITY, ["p1", "p2", "p3", "p4", "p5", "p6", "p7"]);
    expect(isEvenSplit(CAPACITY, shares)).toBe(true);
  });

  it("rejects a 60/40 split and a partial split", () => {
    expect(isEvenSplit(1_000, [share("a", 600), share("b", 400)])).toBe(false);
    expect(isEvenSplit(CAPACITY, [share("a", 60_000)])).toBe(false);
  });
});
