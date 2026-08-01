import { describe, expect, it } from "vitest";
import {
  MAX_EXPENSE_SOURCE_MERCHANT_NAME_CODE_POINTS,
  decodeExpenseResult,
  type ExpenseDecodeIssue,
} from "./expense-money";

function baseReceiptResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    merchantName: null,
    expenseType: "single_amount",
    totalAmountCents: 2500,
    serviceFeeBasisPoints: 0,
    fixedFeesCents: 0,
    items: [],
    ...overrides,
  };
}

function decodeOcr(raw: unknown) {
  return decodeExpenseResult("ocr", "scan_review", raw);
}

function decodeSefaz(raw: unknown) {
  return decodeExpenseResult("sefaz", "scan_review", raw);
}

function issueOf(r: { ok: false; issue: ExpenseDecodeIssue }): ExpenseDecodeIssue {
  return r.issue;
}

describe("decodeExpenseResult(ocr) — happy paths", () => {
  it("decodes a valid single_amount result with no fee/items", () => {
    const r = decodeOcr(baseReceiptResult());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.source).toBe("ocr");
    expect(r.value.merchantName).toBeNull();
    expect(r.value.money.outcome).toBe("complete");
  });

  it("decodes a valid itemized result with a real service fee and fixed fee", () => {
    const r = decodeOcr(
      baseReceiptResult({
        merchantName: "Restaurante Novo",
        expenseType: "itemized",
        totalAmountCents: 6300,
        serviceFeeBasisPoints: 1000,
        fixedFeesCents: 0,
        items: [
          { description: "Cerveja", quantity: 2, unitPriceCents: 1500, totalCents: 3000 },
          { description: "Batata", quantity: 1, unitPriceCents: 2727, totalCents: 2727 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.merchantName).toBe("Restaurante Novo");
    if (r.value.money.outcome === "complete") {
      expect(r.value.money.items).toHaveLength(2);
      expect(r.value.money.summary.serviceFeeCents).toBe(573); // half-up 5730*1000/10000
    }
  });

  it("decodes the sefaz source with the same shape", () => {
    const r = decodeSefaz(baseReceiptResult());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.source).toBe("sefaz");
  });

  it("returns a recursively frozen result", () => {
    const r = decodeOcr(baseReceiptResult());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(() => {
      (r.value as { merchantName: string | null }).merchantName = "hacked";
    }).toThrow();
  });
});

describe("decodeExpenseResult(ocr) — exact root keys", () => {
  it("rejects a missing required root key", () => {
    const raw = baseReceiptResult();
    delete raw.fixedFeesCents;
    const r = decodeOcr(raw);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(issueOf(r)).toEqual({
      code: "invalid_structure",
      source: "ocr",
      path: ["fixedFeesCents"],
      reason: "missing_key",
    });
  });

  it("rejects an unknown extra root key (e.g. a chat-only field)", () => {
    const r = decodeOcr(baseReceiptResult({ title: "Jantar" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(issueOf(r)).toEqual({
      code: "invalid_structure",
      source: "ocr",
      path: [],
      reason: "unknown_key",
    });
  });

  it("rejects a null root", () => {
    const r = decodeOcr(null);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(issueOf(r)).toEqual({
      code: "invalid_structure",
      source: "ocr",
      path: [],
      reason: "null",
    });
  });
});

describe("decodeExpenseResult(ocr) — metadata", () => {
  it("accepts a null merchantName and rejects a blank non-null one", () => {
    expect(decodeOcr(baseReceiptResult({ merchantName: null })).ok).toBe(true);
    expect(decodeOcr(baseReceiptResult({ merchantName: "  " })).ok).toBe(false);
  });

  it("accepts a merchantName exactly at the code-point bound and rejects one over", () => {
    const at = "a".repeat(MAX_EXPENSE_SOURCE_MERCHANT_NAME_CODE_POINTS);
    const over = "a".repeat(MAX_EXPENSE_SOURCE_MERCHANT_NAME_CODE_POINTS + 1);
    expect(decodeOcr(baseReceiptResult({ merchantName: at })).ok).toBe(true);
    expect(decodeOcr(baseReceiptResult({ merchantName: over })).ok).toBe(false);
  });

  it("rejects an invalid expenseType", () => {
    expect(decodeOcr(baseReceiptResult({ expenseType: "lump" })).ok).toBe(false);
  });
});

describe("decodeExpenseResult(ocr) — never mounts an incomplete/zero/unreconciled receipt", () => {
  it("rejects a zero-total receipt outright (scan_review never tolerates edit-only empty)", () => {
    const r = decodeOcr(baseReceiptResult({ totalAmountCents: 0 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(issueOf(r)).toEqual({ code: "incomplete_expense" });
  });

  it("rejects a line total that does not match quantity x unit price (never repairs it)", () => {
    const r = decodeOcr(
      baseReceiptResult({
        expenseType: "itemized",
        totalAmountCents: 3000,
        items: [{ description: "Pizza", quantity: 2, unitPriceCents: 1000, totalCents: 3000 }],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(issueOf(r).code).toBe("line_total_mismatch");
  });

  it("rejects nonempty items with zero top-level amount (never infers the sum)", () => {
    const r = decodeOcr(
      baseReceiptResult({
        expenseType: "itemized",
        totalAmountCents: 0,
        items: [{ description: "X", quantity: 1, unitPriceCents: 1000, totalCents: 1000 }],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(issueOf(r)).toEqual({
      code: "itemized_shape_mismatch",
      reason: "nonempty_items_zero_total",
    });
  });

  it("rejects a single_amount receipt carrying a nonzero fee (fees require items to distribute against)", () => {
    const r = decodeOcr(
      baseReceiptResult({ expenseType: "single_amount", serviceFeeBasisPoints: 1000 }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(issueOf(r)).toEqual({
      code: "invalid_fee_configuration",
      reason: "single_amount_fee",
    });
  });

  it("rejects negative totalAmountCents instead of clamping", () => {
    expect(decodeOcr(baseReceiptResult({ totalAmountCents: -500 })).ok).toBe(false);
  });

  it("rejects an item missing unitPriceCents (never solves the inverse from quantity+total)", () => {
    const raw = baseReceiptResult({
      expenseType: "itemized",
      totalAmountCents: 1000,
      items: [{ description: "X", quantity: 2, totalCents: 1000 }],
    });
    const r = decodeOcr(raw);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(issueOf(r)).toEqual({
      code: "invalid_structure",
      source: "ocr",
      path: ["items", 0],
      reason: "missing_key",
    });
  });

  it("rejects an item missing totalCents (never derives it from quantity x unit price)", () => {
    const raw = baseReceiptResult({
      expenseType: "itemized",
      totalAmountCents: 2000,
      items: [{ description: "X", quantity: 2, unitPriceCents: 1000 }],
    });
    const r = decodeOcr(raw);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(issueOf(r)).toEqual({
      code: "invalid_structure",
      source: "ocr",
      path: ["items", 0],
      reason: "missing_key",
    });
  });
});
