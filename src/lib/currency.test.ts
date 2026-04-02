import { describe, expect, it, test } from "vitest";
import {
  centsToDecimal,
  decimalToCents,
  distributeEvenly,
  distributeProportionally,
  formatBillAmount,
  formatBRL,
  parseBRLInput,
  sanitizeDecimalInput,
} from "./currency";

describe("formatBRL", () => {
  it("formats zero", () => {
    expect(formatBRL(0)).toBe("R$\u00a00,00");
  });

  it("formats one centavo", () => {
    expect(formatBRL(1)).toBe("R$\u00a00,01");
  });

  it("formats R$1,00", () => {
    expect(formatBRL(100)).toBe("R$\u00a01,00");
  });

  it("formats with thousands separator", () => {
    expect(formatBRL(999999)).toBe("R$\u00a09.999,99");
  });

  it("formats negative values", () => {
    expect(formatBRL(-500)).toBe("-R$\u00a05,00");
  });
});

describe("centsToDecimal", () => {
  it("converts zero", () => {
    expect(centsToDecimal(0)).toBe("0.00");
  });

  it("converts 1050 to 10.50", () => {
    expect(centsToDecimal(1050)).toBe("10.50");
  });

  it("converts 1 centavo", () => {
    expect(centsToDecimal(1)).toBe("0.01");
  });

  it("converts 999 centavos", () => {
    expect(centsToDecimal(999)).toBe("9.99");
  });
});

describe("decimalToCents", () => {
  it("converts 10.5 to 1050", () => {
    expect(decimalToCents(10.5)).toBe(1050);
  });

  it("converts zero", () => {
    expect(decimalToCents(0)).toBe(0);
  });

  it("converts 0.01 to 1", () => {
    expect(decimalToCents(0.01)).toBe(1);
  });

  it("handles floating point precision for 19.99", () => {
    expect(decimalToCents(19.99)).toBe(1999);
  });

  it("handles floating point precision for 0.1 + 0.2", () => {
    expect(decimalToCents(0.1 + 0.2)).toBe(30);
  });

  it("1.005 rounds to 100 due to floating point (1.005 * 100 = 100.4999...)", () => {
    expect(decimalToCents(1.005)).toBe(100);
  });
});

describe("parseBRLInput", () => {
  it("parses comma decimal (Brazilian format)", () => {
    expect(parseBRLInput("10,50")).toBe(1050);
  });

  it("parses dot decimal", () => {
    expect(parseBRLInput("10.50")).toBe(1050);
  });

  it("parses with currency symbol", () => {
    expect(parseBRLInput("R$ 10,50")).toBe(1050);
  });

  it("returns 0 for empty string", () => {
    expect(parseBRLInput("")).toBe(0);
  });

  it("returns 0 for non-numeric input", () => {
    expect(parseBRLInput("abc")).toBe(0);
  });

  it("parses single centavo", () => {
    expect(parseBRLInput("0,01")).toBe(1);
  });

  it("parses large number without thousands separator", () => {
    expect(parseBRLInput("12345,67")).toBe(1234567);
  });

  // Known limitation: parseBRLInput does not handle thousands-separated Brazilian format.
  // "1.234,56" (meaning R$ 1,234.56 = 123456 cents) is incorrectly parsed as 123 cents
  // because the implementation strips the period, replaces only the first comma with a dot,
  // yielding "1.234.56" → parseFloat returns 1.234 → Math.round(1.234 * 100) = 123.
  test.fails("parses thousands-separated Brazilian format (known limitation)", () => {
    expect(parseBRLInput("1.234,56")).toBe(123456);
  });
});

describe("formatBillAmount", () => {
  it('shows "Em criação..." for draft bills', () => {
    expect(formatBillAmount("draft", 0)).toBe("Em criação...");
  });

  it('shows "Em criação..." for draft bills even with a non-zero amount', () => {
    expect(formatBillAmount("draft", 5000)).toBe("Em criação...");
  });

  it("shows formatted amount for active bills", () => {
    expect(formatBillAmount("active", 5000)).toBe("R$\u00a050,00");
  });

  it("shows formatted amount for finalized bills", () => {
    expect(formatBillAmount("finalized", 1050)).toBe("R$\u00a010,50");
  });

  it("shows R$ 0,00 for non-draft bills with zero amount", () => {
    expect(formatBillAmount("active", 0)).toBe("R$\u00a00,00");
  });
});

describe("modal input value roundtrip", () => {
  it("centsToDecimal with comma substitution roundtrips through sanitizeDecimalInput and decimalToCents", () => {
    const cents = 10050;
    const inputValue = centsToDecimal(cents).replace(".", ",");
    expect(inputValue).toBe("100,50");
    const sanitized = sanitizeDecimalInput(inputValue);
    expect(sanitized).toBe("100,50");
    expect(decimalToCents(parseFloat(sanitized.replace(",", ".")))).toBe(cents);
  });

  it("sanitizeDecimalInput preserves comma-format values produced by centsToDecimal", () => {
    for (const cents of [0, 1, 99, 1000, 9999, 100000]) {
      const input = centsToDecimal(cents).replace(".", ",");
      expect(sanitizeDecimalInput(input)).toBe(input);
    }
  });
});

describe("sanitizeDecimalInput", () => {
  it("preserves digits and commas", () => {
    expect(sanitizeDecimalInput("10,50")).toBe("10,50");
  });

  it("strips currency symbol and spaces, preserves comma", () => {
    expect(sanitizeDecimalInput("R$ 12,50")).toBe("12,50");
  });

  it("returns empty string unchanged", () => {
    expect(sanitizeDecimalInput("")).toBe("");
  });

  it("strips non-digit non-comma characters but keeps digits", () => {
    expect(sanitizeDecimalInput("abc123,45")).toBe("123,45");
  });

  it("strips dots (dots are not decimal separators in this format)", () => {
    expect(sanitizeDecimalInput("1.234,56")).toBe("1234,56");
  });
});

// --- Distribution function tests ---

/** Assert that returned shares sum to exactly the expected total */
function assertSumEquals(shares: number[], expectedTotal: number) {
  expect(shares.reduce((a, b) => a + b, 0)).toBe(expectedTotal);
}

describe("distributeProportionally", () => {
  it("distributes equally when all weights are equal", () => {
    const result = distributeProportionally(300, [1, 1, 1]);
    expect(result).toEqual([100, 100, 100]);
    assertSumEquals(result, 300);
  });

  it("handles indivisible split among 3 (100 / 3)", () => {
    const result = distributeProportionally(100, [1, 1, 1]);
    assertSumEquals(result, 100);
    // Each gets 33 or 34; largest remainder distributes the extra centavo
    expect(result.sort()).toEqual([33, 33, 34]);
  });

  it("handles 1 centavo among 3 participants", () => {
    const result = distributeProportionally(1, [1, 1, 1]);
    assertSumEquals(result, 1);
    // Only one person gets the centavo
    expect(result.filter((v) => v === 1)).toHaveLength(1);
    expect(result.filter((v) => v === 0)).toHaveLength(2);
  });

  it("handles zero total", () => {
    const result = distributeProportionally(0, [50, 30, 20]);
    expect(result).toEqual([0, 0, 0]);
  });

  it("handles all-zero weights", () => {
    const result = distributeProportionally(1000, [0, 0, 0]);
    expect(result).toEqual([0, 0, 0]);
  });

  it("handles single participant", () => {
    const result = distributeProportionally(9999, [1]);
    expect(result).toEqual([9999]);
  });

  it("distributes by weight ratio 50/30/20", () => {
    const result = distributeProportionally(10000, [50, 30, 20]);
    expect(result).toEqual([5000, 3000, 2000]);
    assertSumEquals(result, 10000);
  });

  it("distributes 10001 among 3 equal weights — remainder goes to first by largest frac", () => {
    const result = distributeProportionally(10001, [1, 1, 1]);
    assertSumEquals(result, 10001);
    // 10001/3 = 3333.666... each → floor 3333, remainder 2
    // All fracs equal (0.666...) so first two get extra centavo
    expect(result).toEqual([3334, 3334, 3333]);
  });

  it("distributes among 7 participants (worst-case remainder)", () => {
    const result = distributeProportionally(10000, [1, 1, 1, 1, 1, 1, 1]);
    assertSumEquals(result, 10000);
    // 10000/7 = 1428.571... → floor 1428, remainder 4
    // 4 participants get 1429, 3 get 1428
    expect(result.filter((v) => v === 1429)).toHaveLength(4);
    expect(result.filter((v) => v === 1428)).toHaveLength(3);
  });

  it("handles very skewed weights (1 vs 9999)", () => {
    const result = distributeProportionally(10000, [1, 9999]);
    assertSumEquals(result, 10000);
    expect(result[0]).toBe(1);
    expect(result[1]).toBe(9999);
  });

  it("handles large number of participants (100 splitting 1 real)", () => {
    const weights = new Array(100).fill(1);
    const result = distributeProportionally(100, weights);
    assertSumEquals(result, 100);
    expect(result.every((v) => v === 1)).toBe(true);
  });

  it("handles large number of participants with remainder (100 people, 101 cents)", () => {
    const weights = new Array(100).fill(1);
    const result = distributeProportionally(101, weights);
    assertSumEquals(result, 101);
    expect(result.filter((v) => v === 2)).toHaveLength(1);
    expect(result.filter((v) => v === 1)).toHaveLength(99);
  });

  it("preserves sum with prime total and coprime weights", () => {
    // 97 cents split by weights [3, 5, 7]
    const result = distributeProportionally(97, [3, 5, 7]);
    assertSumEquals(result, 97);
    // 3/15*97=19.4, 5/15*97=32.33, 7/15*97=45.27
    // Largest remainders: 0.4, 0.33, 0.27 → first gets +1
    expect(result[0]).toBe(20);
    expect(result[1]).toBe(32);
    expect(result[2]).toBe(45);
  });

  it("handles weight of zero for one participant among nonzero weights", () => {
    const result = distributeProportionally(1000, [0, 50, 50]);
    assertSumEquals(result, 1000);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(500);
    expect(result[2]).toBe(500);
  });

  it("stress test: sum invariant holds for many random-like splits", () => {
    const cases: [number, number[]][] = [
      [1, [1, 1]],
      [2, [1, 1, 1]],
      [99999, [33, 33, 34]],
      [50000, [10, 20, 30, 40]],
      [7, [2, 3, 5, 7, 11]],
      [123456, [1, 2, 3]],
    ];
    for (const [total, weights] of cases) {
      const result = distributeProportionally(total, weights);
      assertSumEquals(result, total);
      expect(result.length).toBe(weights.length);
      result.forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
    }
  });
});

describe("distributeEvenly", () => {
  it("splits evenly when divisible", () => {
    expect(distributeEvenly(300, 3)).toEqual([100, 100, 100]);
  });

  it("splits 100 among 3 — sum preserved", () => {
    const result = distributeEvenly(100, 3);
    assertSumEquals(result, 100);
    expect(result.sort()).toEqual([33, 33, 34]);
  });

  it("returns empty array for count 0", () => {
    expect(distributeEvenly(1000, 0)).toEqual([]);
  });

  it("gives full amount to single participant", () => {
    expect(distributeEvenly(42, 1)).toEqual([42]);
  });

  it("splits 1 centavo among 5 — only one gets it", () => {
    const result = distributeEvenly(1, 5);
    assertSumEquals(result, 1);
    expect(result.filter((v) => v === 1)).toHaveLength(1);
    expect(result.filter((v) => v === 0)).toHaveLength(4);
  });

  it("splits 0 among any count", () => {
    expect(distributeEvenly(0, 5)).toEqual([0, 0, 0, 0, 0]);
  });

  it("splits 10001 among 7 — max difference is 1 centavo", () => {
    const result = distributeEvenly(10001, 7);
    assertSumEquals(result, 10001);
    const min = Math.min(...result);
    const max = Math.max(...result);
    expect(max - min).toBeLessThanOrEqual(1);
  });

  it("splits large amount among 2", () => {
    const result = distributeEvenly(999999, 2);
    assertSumEquals(result, 999999);
    expect(result.sort()).toEqual([499999, 500000]);
  });
});

describe("distributeProportionally — fee distribution scenarios", () => {
  it("service fee distributed by consumption: 3 users with 2000/3000/5000 consumption, 10% fee", () => {
    // Total consumption = 10000, fee = 1000
    const feeShares = distributeProportionally(1000, [2000, 3000, 5000]);
    expect(feeShares).toEqual([200, 300, 500]);
    assertSumEquals(feeShares, 1000);
  });

  it("service fee with awkward percentages: 15% on 333 cents among 3 equal", () => {
    // fee = Math.round(333 * 0.15) = 50 cents
    const fee = Math.round(333 * 0.15);
    expect(fee).toBe(50);
    const feeShares = distributeProportionally(fee, [1, 1, 1]);
    assertSumEquals(feeShares, 50);
    // 50/3 = 16.666 → [17, 17, 16]
    expect(feeShares.sort()).toEqual([16, 17, 17]);
  });

  it("fixed fee distributed evenly among 4 (99 cents)", () => {
    // Fixed fees are split evenly — use equal weights
    const shares = distributeProportionally(99, [1, 1, 1, 1]);
    assertSumEquals(shares, 99);
    // 99/4 = 24.75 → 3 get 25, 1 gets 24
    expect(shares.sort()).toEqual([24, 25, 25, 25]);
  });

  it("combined: item total + proportional service fee + even fixed fee, 5 users", () => {
    // 5 users consumed [1000, 2000, 3000, 1500, 2500] = 10000 total
    const consumption = [1000, 2000, 3000, 1500, 2500];
    const total = consumption.reduce((a, b) => a + b, 0);
    expect(total).toBe(10000);

    // Service fee 10% = 1000 cents, proportional
    const serviceFee = distributeProportionally(1000, consumption);
    assertSumEquals(serviceFee, 1000);
    expect(serviceFee).toEqual([100, 200, 300, 150, 250]);

    // Fixed fee 50 cents, even split
    const fixedFee = distributeEvenly(50, 5);
    assertSumEquals(fixedFee, 50);

    // Each user's total = consumption + service fee share + fixed fee share
    const userTotals = consumption.map(
      (c, i) => c + serviceFee[i] + fixedFee[i],
    );
    assertSumEquals(userTotals, 10000 + 1000 + 50);
  });
});
