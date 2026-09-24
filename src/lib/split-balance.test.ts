import { describe, expect, it } from "vitest";
import {
  evenSplitBalance,
  setSplitShare,
  splitBalanceFromShares,
  splitRemainder,
  withSplitPeople,
  withSplitTotal,
  type SplitBalance,
} from "./split-balance";

const FULL = 10_000;

function sharesOf(balance: SplitBalance): number[] {
  return balance.ids.map((id) => balance.shares[id]);
}

describe("evenSplitBalance", () => {
  it("gives the uneven remainder to the earliest people, one unit each", () => {
    expect(sharesOf(evenSplitBalance(FULL, ["a", "b", "c"]))).toEqual([3334, 3333, 3333]);
    expect(sharesOf(evenSplitBalance(1001, ["a", "b", "c", "d"]))).toEqual([251, 250, 250, 250]);
  });

  it("starts with nobody set by the user", () => {
    expect(evenSplitBalance(FULL, ["a", "b"]).setByUser).toEqual([]);
  });

  it("splits a zero total into zeros", () => {
    expect(sharesOf(evenSplitBalance(0, ["a", "b"]))).toEqual([0, 0]);
  });

  it("leaves the whole total as remainder when nobody takes part", () => {
    expect(splitRemainder(evenSplitBalance(500, []))).toBe(500);
  });
});

describe("setSplitShare with two people", () => {
  it("sets the other person to the complement immediately", () => {
    const next = setSplitShare(evenSplitBalance(FULL, ["a", "b"]), "a", 4000);
    expect(sharesOf(next)).toEqual([4000, 6000]);
  });

  it("keeps complementing when the edits alternate", () => {
    let balance = evenSplitBalance(18_000, ["a", "b"]);
    balance = setSplitShare(balance, "a", 5000);
    balance = setSplitShare(balance, "b", 12_345);
    expect(sharesOf(balance)).toEqual([5655, 12_345]);
    balance = setSplitShare(balance, "a", 18_000);
    expect(sharesOf(balance)).toEqual([18_000, 0]);
  });
});

describe("setSplitShare with three or more people", () => {
  it("spreads the remainder evenly over the people not yet set", () => {
    const next = setSplitShare(evenSplitBalance(FULL, ["a", "b", "c"]), "a", 5000);
    expect(sharesOf(next)).toEqual([5000, 2500, 2500]);
    expect(next.setByUser).toEqual(["a"]);
  });

  it("rounds the spread remainder to whole units, earliest first", () => {
    const next = setSplitShare(evenSplitBalance(FULL, ["a", "b", "c", "d"]), "a", 1);
    expect(sharesOf(next)).toEqual([1, 3333, 3333, 3333]);
    const cents = setSplitShare(evenSplitBalance(1000, ["a", "b", "c"]), "c", 1);
    expect(sharesOf(cents)).toEqual([500, 499, 1]);
  });

  it("gives the remainder to the last unset person once the others are set", () => {
    let balance = evenSplitBalance(FULL, ["a", "b", "c"]);
    balance = setSplitShare(balance, "a", 5000);
    balance = setSplitShare(balance, "b", 3000);
    expect(sharesOf(balance)).toEqual([5000, 3000, 2000]);
  });

  it("gives the remainder to the least recently set person when everyone is set", () => {
    let balance = evenSplitBalance(FULL, ["a", "b", "c"]);
    balance = setSplitShare(balance, "a", 5000);
    balance = setSplitShare(balance, "b", 3000);
    balance = setSplitShare(balance, "c", 1000);
    expect(sharesOf(balance)).toEqual([6000, 3000, 1000]);
    expect(balance.setByUser).toEqual(["a", "b", "c"]);

    balance = setSplitShare(balance, "a", 2000);
    expect(sharesOf(balance)).toEqual([2000, 7000, 1000]);
    expect(balance.setByUser).toEqual(["b", "c", "a"]);
  });

  it("takes an overshoot back from the least recently set people, never below zero", () => {
    let balance = evenSplitBalance(FULL, ["a", "b", "c"]);
    balance = setSplitShare(balance, "a", 3000);
    balance = setSplitShare(balance, "b", 3000);
    balance = setSplitShare(balance, "c", 9000);
    expect(sharesOf(balance)).toEqual([0, 1000, 9000]);
  });

  it("zeroes the unset people before touching anyone the user set", () => {
    let balance = evenSplitBalance(FULL, ["a", "b", "c"]);
    balance = setSplitShare(balance, "b", 3000);
    balance = setSplitShare(balance, "a", 9000);
    expect(sharesOf(balance)).toEqual([9000, 1000, 0]);
  });
});

describe("setSplitShare input handling", () => {
  it("clamps above the total and below zero", () => {
    const base = evenSplitBalance(FULL, ["a", "b"]);
    expect(sharesOf(setSplitShare(base, "a", 12_000))).toEqual([FULL, 0]);
    expect(sharesOf(setSplitShare(base, "a", -5))).toEqual([0, FULL]);
  });

  it("ignores fractional values and unknown people", () => {
    const base = evenSplitBalance(FULL, ["a", "b"]);
    expect(setSplitShare(base, "a", 33.3)).toBe(base);
    expect(setSplitShare(base, "z", 100)).toBe(base);
  });

  it("pins a lone person to the whole total", () => {
    const next = setSplitShare(evenSplitBalance(FULL, ["a"]), "a", 2500);
    expect(sharesOf(next)).toEqual([FULL]);
  });
});

describe("the sum always holds", () => {
  it("keeps the remainder at zero across random edit sequences", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let run = 0; run < 200; run++) {
      const count = 1 + Math.floor(random() * 6);
      const ids = Array.from({ length: count }, (_, index) => `p${index}`);
      const total = random() < 0.5 ? FULL : Math.floor(random() * 99_999_999);
      let balance = evenSplitBalance(total, ids);
      for (let edit = 0; edit < 12; edit++) {
        const id = ids[Math.floor(random() * count)];
        const value = Math.floor(random() * (total + 2)) - 1;
        balance = setSplitShare(balance, id, value);
        expect(splitRemainder(balance)).toBe(0);
        for (const share of sharesOf(balance)) {
          expect(Number.isInteger(share)).toBe(true);
          expect(share).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe("withSplitPeople", () => {
  it("keeps the user's shares and re-spreads the rest over newcomers", () => {
    let balance = evenSplitBalance(FULL, ["a", "b"]);
    balance = setSplitShare(balance, "a", 4000);
    balance = withSplitPeople(balance, ["a", "b", "c"]);
    expect(sharesOf(balance)).toEqual([4000, 3000, 3000]);
  });

  it("drops people who left and hands their share back", () => {
    let balance = evenSplitBalance(FULL, ["a", "b", "c"]);
    balance = setSplitShare(balance, "c", 2000);
    balance = setSplitShare(balance, "a", 5000);
    balance = withSplitPeople(balance, ["a", "b"]);
    expect(sharesOf(balance)).toEqual([5000, 5000]);
    expect(balance.setByUser).toEqual(["a"]);
  });

  it("gives everything to the least recently set when only set people remain", () => {
    let balance = evenSplitBalance(FULL, ["a", "b", "c"]);
    balance = setSplitShare(balance, "a", 2000);
    balance = setSplitShare(balance, "b", 3000);
    balance = withSplitPeople(balance, ["a", "b"]);
    expect(sharesOf(balance)).toEqual([7000, 3000]);
  });
});

describe("withSplitTotal", () => {
  it("keeps set amounts that still fit and re-spreads the rest", () => {
    let balance = evenSplitBalance(10_000, ["a", "b", "c"]);
    balance = setSplitShare(balance, "a", 4000);
    balance = withSplitTotal(balance, 16_000);
    expect(sharesOf(balance)).toEqual([4000, 6000, 6000]);
  });

  it("takes back from the least recently set amounts when the total shrinks", () => {
    let balance = evenSplitBalance(10_000, ["a", "b"]);
    balance = setSplitShare(balance, "a", 7000);
    balance = setSplitShare(balance, "b", 3000);
    balance = withSplitTotal(balance, 5000);
    expect(sharesOf(balance)).toEqual([2000, 3000]);
  });

  it("ignores invalid totals", () => {
    const base = evenSplitBalance(FULL, ["a", "b"]);
    expect(withSplitTotal(base, -1)).toBe(base);
    expect(withSplitTotal(base, 1.5)).toBe(base);
  });
});

describe("splitBalanceFromShares", () => {
  it("reopens an even split as untouched", () => {
    const balance = splitBalanceFromShares(FULL, ["a", "b", "c"], { a: 3334, b: 3333, c: 3333 });
    expect(balance.setByUser).toEqual([]);
    expect(sharesOf(setSplitShare(balance, "a", 4000))).toEqual([4000, 3000, 3000]);
  });

  it("reopens a custom exact split as set by the user in order", () => {
    const balance = splitBalanceFromShares(FULL, ["a", "b", "c"], { a: 5000, b: 3000, c: 2000 });
    expect(balance.setByUser).toEqual(["a", "b", "c"]);
    expect(sharesOf(setSplitShare(balance, "c", 1000))).toEqual([6000, 3000, 1000]);
  });

  it("falls back to even when saved shares do not add up", () => {
    expect(sharesOf(splitBalanceFromShares(FULL, ["a", "b"], { a: 5000, b: 4000 }))).toEqual([5000, 5000]);
    expect(sharesOf(splitBalanceFromShares(FULL, ["a", "b"], { a: 5000 }))).toEqual([5000, 5000]);
    expect(sharesOf(splitBalanceFromShares(FULL, ["a", "b"], { a: 10_001, b: -1 }))).toEqual([5000, 5000]);
  });
});
