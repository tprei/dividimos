import { describe, expect, it } from "vitest";
import {
  MAX_EXPENSE_CENTS,
  allocateByBasisPoints,
  allocateByWeights,
  allocateEvenly,
  computeServiceFeeCents,
  formatServiceFeeBasisPoints,
  parseAllocationPercentText,
  parseExpenseCents,
  parseExpenseCentsText,
  parseGraphRevision,
  parseServiceFeeBasisPoints,
  parseServiceFeeBasisPointsText,
  parseSignedExpenseCents,
  sumExpenseCents,
  validateActivationAllocationTotals,
  validateDraftAllocationBounds,
  type AllocationBasisPoints,
  type ExpenseCents,
  type ServiceFeeBasisPoints,
} from "./expense-money";
// Local helpers: tests obtain branded values only through the parsers, the way
// production code must. `c`/`bp` assume a valid literal and unwrap the result.
function c(value: number): ExpenseCents {
  const r = parseExpenseCents(value, "allow");
  if (!r.ok) throw new Error(`test fixture: invalid cents ${value}`);
  return r.value;
}
function bp(value: number): ServiceFeeBasisPoints {
  const r = parseServiceFeeBasisPoints(value);
  if (!r.ok) throw new Error(`test fixture: invalid bps ${value}`);
  return r.value;
}
function pct(text: string): AllocationBasisPoints {
  const r = parseAllocationPercentText(text);
  if (!r.ok) throw new Error(`test fixture: invalid percent ${text}`);
  return r.value;
}

describe("parseExpenseCents", () => {
  it("accepts [0, MAX] under allow policy", () => {
    expect(parseExpenseCents(0, "allow")).toEqual({ ok: true, value: 0 });
    expect(parseExpenseCents(MAX_EXPENSE_CENTS, "allow")).toEqual({
      ok: true,
      value: MAX_EXPENSE_CENTS,
    });
  });

  it("rejects zero under positive policy", () => {
    expect(parseExpenseCents(0, "positive").ok).toBe(false);
    expect(parseExpenseCents(1, "positive")).toEqual({ ok: true, value: 1 });
  });

  it("rejects above the cap and below zero", () => {
    expect(parseExpenseCents(MAX_EXPENSE_CENTS + 1, "allow").ok).toBe(false);
    expect(parseExpenseCents(-1, "allow").ok).toBe(false);
    expect(parseExpenseCents(1.5, "allow").ok).toBe(false);
    expect(parseExpenseCents("1" as unknown, "allow").ok).toBe(false);
  });
});

describe("parseSignedExpenseCents", () => {
  it("accepts [-MAX, MAX]", () => {
    expect(parseSignedExpenseCents(-MAX_EXPENSE_CENTS)).toEqual({
      ok: true,
      value: -MAX_EXPENSE_CENTS,
    });
    expect(parseSignedExpenseCents(MAX_EXPENSE_CENTS)).toEqual({
      ok: true,
      value: MAX_EXPENSE_CENTS,
    });
  });

  it("rejects outside the symmetric bound", () => {
    expect(parseSignedExpenseCents(MAX_EXPENSE_CENTS + 1).ok).toBe(false);
    expect(parseSignedExpenseCents(-(MAX_EXPENSE_CENTS + 1)).ok).toBe(false);
  });
});

describe("parseGraphRevision", () => {
  it("accepts [0, 2_147_483_647]", () => {
    expect(parseGraphRevision(0)).toEqual({ ok: true, value: 0 });
    expect(parseGraphRevision(2_147_483_647)).toEqual({
      ok: true,
      value: 2_147_483_647,
    });
  });

  it("rejects negative, fractional, and exhausted revisions", () => {
    expect(parseGraphRevision(-1).ok).toBe(false);
    expect(parseGraphRevision(2_147_483_648).ok).toBe(false);
    expect(parseGraphRevision(1.5).ok).toBe(false);
  });
});

describe("parseServiceFeeBasisPoints", () => {
  it("accepts [0, 10_000]", () => {
    expect(parseServiceFeeBasisPoints(0)).toEqual({ ok: true, value: 0 });
    expect(parseServiceFeeBasisPoints(10_000)).toEqual({ ok: true, value: 10_000 });
  });

  it("rejects outside the 0–100% range", () => {
    expect(parseServiceFeeBasisPoints(10_001).ok).toBe(false);
    expect(parseServiceFeeBasisPoints(-1).ok).toBe(false);
    expect(parseServiceFeeBasisPoints(10.5).ok).toBe(false);
  });
});

describe("parseExpenseCentsText", () => {
  it("minor_unit_digits interprets digits as cents", () => {
    expect(parseExpenseCentsText("12345", { format: "minor_unit_digits", zeroPolicy: "allow" })).toEqual({
      ok: true,
      value: 12345,
    });
    expect(parseExpenseCentsText("0", { format: "minor_unit_digits", zeroPolicy: "allow" })).toEqual({
      ok: true,
      value: 0,
    });
  });

  it("brl_decimal accepts grouped/ungrouped/prefixed", () => {
    expect(parseExpenseCentsText("42,50", { format: "brl_decimal", zeroPolicy: "allow" })).toEqual({
      ok: true,
      value: 4250,
    });
    expect(parseExpenseCentsText("1.234,56", { format: "brl_decimal", zeroPolicy: "allow" })).toEqual({
      ok: true,
      value: 123456,
    });
    expect(parseExpenseCentsText("R$ 1.234,56", { format: "brl_decimal", zeroPolicy: "allow" })).toEqual({
      ok: true,
      value: 123456,
    });
  });

  it("plain_decimal accepts comma and dot separators", () => {
    expect(parseExpenseCentsText("99,99", { format: "plain_decimal", zeroPolicy: "allow" })).toEqual({
      ok: true,
      value: 9999,
    });
    expect(parseExpenseCentsText("99.99", { format: "plain_decimal", zeroPolicy: "allow" })).toEqual({
      ok: true,
      value: 9999,
    });
    expect(parseExpenseCentsText("100", { format: "plain_decimal", zeroPolicy: "allow" })).toEqual({
      ok: true,
      value: 10000,
    });
    expect(parseExpenseCentsText("1,5", { format: "plain_decimal", zeroPolicy: "allow" })).toEqual({
      ok: true,
      value: 150,
    });
  });

  it("rejects empty, signs, whitespace, wrong shape", () => {
    const opt = { format: "plain_decimal" as const, zeroPolicy: "allow" as const };
    expect(parseExpenseCentsText("", opt)).toEqual({ ok: false, issue: { code: "required" } });
    expect(parseExpenseCentsText("-5", opt).ok).toBe(false);
    expect(parseExpenseCentsText(" 5", opt).ok).toBe(false);
    expect(parseExpenseCentsText("abc", opt).ok).toBe(false);
  });

  it("classifies excess fractional digits as excess_precision", () => {
    const opt = { format: "plain_decimal" as const, zeroPolicy: "allow" as const };
    expect(parseExpenseCentsText("1,234", opt)).toEqual({
      ok: false,
      issue: { code: "excess_precision" },
    });
  });

  it("enforces zeroPolicy and maxCents", () => {
    expect(parseExpenseCentsText("0", { format: "plain_decimal", zeroPolicy: "positive" })).toEqual({
      ok: false,
      issue: { code: "out_of_range" },
    });
    expect(
      parseExpenseCentsText("500", {
        format: "plain_decimal",
        zeroPolicy: "allow",
        maxCents: c(400),
      }),
    ).toEqual({ ok: false, issue: { code: "out_of_range" } });
  });
});

describe("parseServiceFeeBasisPointsText", () => {
  it("converts percent text exactly to basis points", () => {
    expect(parseServiceFeeBasisPointsText("10")).toEqual({ ok: true, value: 1000 });
    expect(parseServiceFeeBasisPointsText("10,55")).toEqual({ ok: true, value: 1055 });
    expect(parseServiceFeeBasisPointsText("10,5")).toEqual({ ok: true, value: 1050 });
    expect(parseServiceFeeBasisPointsText("0,01")).toEqual({ ok: true, value: 1 });
    expect(parseServiceFeeBasisPointsText("100")).toEqual({ ok: true, value: 10_000 });
  });

  it("rejects over-100% and excess precision", () => {
    expect(parseServiceFeeBasisPointsText("100,01")).toEqual({
      ok: false,
      issue: { code: "out_of_range" },
    });
    expect(parseServiceFeeBasisPointsText("10,555")).toEqual({
      ok: false,
      issue: { code: "excess_precision" },
    });
  });
});

describe("parseAllocationPercentText", () => {
  it("returns AllocationBasisPoints in [0, 10_000]", () => {
    expect(parseAllocationPercentText("33,33")).toEqual({ ok: true, value: 3333 });
    expect(parseAllocationPercentText("66,67")).toEqual({ ok: true, value: 6667 });
  });
});

describe("formatServiceFeeBasisPoints", () => {
  it("formats integer quotient/remainder", () => {
    expect(formatServiceFeeBasisPoints(bp(1055))).toBe("10,55%");
    expect(formatServiceFeeBasisPoints(bp(1000))).toBe("10%");
    expect(formatServiceFeeBasisPoints(bp(1))).toBe("0,01%");
    expect(formatServiceFeeBasisPoints(bp(0))).toBe("0%");
  });
});

describe("sumExpenseCents", () => {
  it("sums exactly", () => {
    expect(sumExpenseCents([c(1), c(2), c(3)])).toEqual({ ok: true, value: 6 });
  });

  it("rejects a derived sum above the cap", () => {
    expect(sumExpenseCents([c(MAX_EXPENSE_CENTS), c(1)]).ok).toBe(false);
  });
});

describe("computeServiceFeeCents", () => {
  it("rounds half up at the centavo boundary", () => {
    // 1 cent at 50%: floor((1*5000 + 5000)/10000) = 1
    expect(computeServiceFeeCents(c(1), bp(5000))).toEqual({ ok: true, value: 1 });
    // 1 cent at 1bp: floor((1 + 5000)/10000) = 0 (small rate rounds to zero)
    expect(computeServiceFeeCents(c(1), bp(1))).toEqual({ ok: true, value: 0 });
    // 12345 cents at 10%: floor((12345*1000 + 5000)/10000) = 1235
    expect(computeServiceFeeCents(c(12345), bp(1000))).toEqual({ ok: true, value: 1235 });
  });

  it("handles zero rate and zero subtotal", () => {
    expect(computeServiceFeeCents(c(100), bp(0))).toEqual({ ok: true, value: 0 });
    expect(computeServiceFeeCents(c(0), bp(1000))).toEqual({ ok: true, value: 0 });
  });
});

describe("allocateByWeights", () => {
  it("returns an exact-sum vector", () => {
    const result = allocateByWeights(c(100), [c(1), c(1), c(2)]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const sum = result.value.reduce((a, b) => a + (b as number), 0);
      expect(sum).toBe(100);
      expect(result.value[0]).toBe(result.value[1]);
    }
  });

  it("distributes the one-cent remainder by index tie-break", () => {
    const result = allocateByWeights(c(100), [c(1), c(1), c(1)]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value as readonly number[]).toEqual([34, 33, 33]);
    }
  });

  it("returns an explicit zero vector for total zero", () => {
    const result = allocateByWeights(c(0), [c(5), c(5)]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value as readonly number[]).toEqual([0, 0]);
    }
  });

  it("rejects no entities and zero total weight for nonzero total", () => {
    expect(allocateByWeights(c(100), []).ok).toBe(false);
    expect(allocateByWeights(c(100), [c(0), c(0)]).ok).toBe(false);
  });
});

describe("allocateEvenly", () => {
  it("uses quotient and remainder in participant order", () => {
    const result = allocateEvenly(c(100), 3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value as readonly number[]).toEqual([34, 33, 33]);
    }
  });

  it("handles exact division and zero total", () => {
    const exact = allocateEvenly(c(99), 3);
    const zero = allocateEvenly(c(0), 3);
    expect(exact.ok && (exact.value as readonly number[])).toEqual([33, 33, 33]);
    expect(zero.ok && (zero.value as readonly number[])).toEqual([0, 0, 0]);
  });
});

describe("allocateByBasisPoints", () => {
  it("allocates by percentage and rejects a non-100% sum", () => {
    const r = allocateByBasisPoints(c(100), [pct("33,33"), pct("66,67")]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const sum = r.value.reduce((a, b) => a + (b as number), 0);
      expect(sum).toBe(100);
    }
    const bad = allocateByBasisPoints(c(100), [pct("40"), pct("40")]);
    expect(bad.ok).toBe(false);
  });
});

describe("validateDraftAllocationBounds", () => {
  const total = c(100);

  it("accepts incomplete allocations within the total", () => {
    expect(
      validateDraftAllocationBounds({
        totalAmountCents: total,
        userShareCents: [c(30)],
        guestShareCents: [],
        payerCents: [c(40)],
      }).ok,
    ).toBe(true);
  });

  it("reports combined_shares before payer when user+guest exceed total", () => {
    expect(
      validateDraftAllocationBounds({
        totalAmountCents: total,
        userShareCents: [c(60)],
        guestShareCents: [c(60)],
        payerCents: [],
      }),
    ).toEqual({
      ok: false,
      issue: { code: "allocation_exceeds_total", kind: "combined_shares" },
    });
  });

  it("reports payer over total", () => {
    expect(
      validateDraftAllocationBounds({
        totalAmountCents: total,
        userShareCents: [],
        guestShareCents: [],
        payerCents: [c(60), c(60)],
      }),
    ).toEqual({
      ok: false,
      issue: { code: "allocation_exceeds_total", kind: "payers" },
    });
  });
});

describe("validateActivationAllocationTotals", () => {
  const total = c(100);

  it("requires exact share and payer sums", () => {
    expect(
      validateActivationAllocationTotals({
        totalAmountCents: total,
        userShareCents: [c(60), c(40)],
        guestShareCents: [],
        payerCents: [c(100)],
      }).ok,
    ).toBe(true);
  });

  it("rejects a one-cent share delta with no tolerance", () => {
    expect(
      validateActivationAllocationTotals({
        totalAmountCents: total,
        userShareCents: [c(60), c(39)],
        guestShareCents: [],
        payerCents: [c(100)],
      }),
    ).toEqual({ ok: false, issue: { code: "share_total_mismatch" } });
  });

  it("rejects a one-cent payer delta with no tolerance", () => {
    expect(
      validateActivationAllocationTotals({
        totalAmountCents: total,
        userShareCents: [c(100)],
        guestShareCents: [],
        payerCents: [c(99)],
      }),
    ).toEqual({ ok: false, issue: { code: "payer_total_mismatch" } });
  });
});
