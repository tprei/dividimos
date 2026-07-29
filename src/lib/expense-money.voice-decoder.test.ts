import { describe, expect, it } from "vitest";
import {
  MAX_EXPENSE_SOURCE_MERCHANT_NAME_CODE_POINTS,
  MAX_EXPENSE_SOURCE_TITLE_CODE_POINTS,
  decodeExpenseResult,
  type ExpenseDecodeIssue,
} from "./expense-money";

const CONTEXT = { members: [{ handle: "bob", name: "Bob" }] };

function baseVoiceResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Uber",
    amountCents: 2500,
    expenseType: "single_amount",
    items: [],
    participants: [],
    merchantName: null,
    ...overrides,
  };
}

function decode(raw: unknown) {
  return decodeExpenseResult("voice", "source_parse", raw, CONTEXT);
}

function issueOf(r: { ok: false; issue: ExpenseDecodeIssue }): ExpenseDecodeIssue {
  return r.issue;
}

describe("decodeExpenseResult(voice) — happy paths", () => {
  it("decodes a valid single_amount result with no confidence/payer/splitType fields", () => {
    const r = decode(baseVoiceResult());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.source).toBe("voice");
    expect(r.value.title).toBe("Uber");
    expect("confidence" in r.value).toBe(false);
    expect("payerHandle" in r.value).toBe(false);
    expect("splitType" in r.value).toBe(false);
    expect("allocations" in r.value).toBe(false);
  });

  it("decodes a valid itemized result", () => {
    const r = decode(
      baseVoiceResult({
        title: "Bar",
        amountCents: 5500,
        expenseType: "itemized",
        items: [
          { description: "Cerveja", quantity: 2, unitPriceCents: 1500, totalCents: 3000 },
          { description: "Batata", quantity: 1, unitPriceCents: 2500, totalCents: 2500 },
        ],
        merchantName: "Bar do Zé",
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.merchantName).toBe("Bar do Zé");
    if (r.value.money.outcome === "complete") {
      expect(r.value.money.items).toHaveLength(2);
    }
  });

  it("decodes the edit-only zero-amount sentinel when items are empty", () => {
    const r = decode(baseVoiceResult({ title: "Almoço", amountCents: 0 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.money.outcome).toBe("edit_only_amount_incomplete");
  });

  it("returns a recursively frozen result", () => {
    const r = decode(baseVoiceResult());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(() => {
      (r.value as { title: string }).title = "hacked";
    }).toThrow();
  });
});

describe("decodeExpenseResult(voice) — exact root keys", () => {
  it("rejects a missing required root key", () => {
    const raw = baseVoiceResult();
    delete raw.merchantName;
    const r = decode(raw);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(issueOf(r)).toEqual({
      code: "invalid_structure",
      source: "voice",
      path: ["merchantName"],
      reason: "missing_key",
    });
  });

  it("rejects an unknown extra root key (e.g. a chat-only field)", () => {
    const r = decode(baseVoiceResult({ splitType: "equal" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(issueOf(r)).toEqual({
      code: "invalid_structure",
      source: "voice",
      path: [],
      reason: "unknown_key",
    });
  });

  it("rejects a null root", () => {
    const r = decode(null);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(issueOf(r)).toEqual({
      code: "invalid_structure",
      source: "voice",
      path: [],
      reason: "null",
    });
  });
});

describe("decodeExpenseResult(voice) — metadata", () => {
  it("rejects a blank title", () => {
    expect(decode(baseVoiceResult({ title: "   " })).ok).toBe(false);
  });

  it("accepts a title exactly at the code-point bound and rejects one over", () => {
    const at = "a".repeat(MAX_EXPENSE_SOURCE_TITLE_CODE_POINTS);
    const over = "a".repeat(MAX_EXPENSE_SOURCE_TITLE_CODE_POINTS + 1);
    expect(decode(baseVoiceResult({ title: at })).ok).toBe(true);
    expect(decode(baseVoiceResult({ title: over })).ok).toBe(false);
  });

  it("accepts a null merchantName and rejects a blank non-null one", () => {
    expect(decode(baseVoiceResult({ merchantName: null })).ok).toBe(true);
    expect(decode(baseVoiceResult({ merchantName: "  " })).ok).toBe(false);
  });

  it("accepts a merchantName exactly at the code-point bound and rejects one over", () => {
    const at = "a".repeat(MAX_EXPENSE_SOURCE_MERCHANT_NAME_CODE_POINTS);
    const over = "a".repeat(MAX_EXPENSE_SOURCE_MERCHANT_NAME_CODE_POINTS + 1);
    expect(decode(baseVoiceResult({ merchantName: at })).ok).toBe(true);
    expect(decode(baseVoiceResult({ merchantName: over })).ok).toBe(false);
  });

  it("rejects an invalid expenseType", () => {
    expect(decode(baseVoiceResult({ expenseType: "lump" })).ok).toBe(false);
  });
});

describe("decodeExpenseResult(voice) — items and money delegation", () => {
  it("rejects a line total that does not match quantity x unit price", () => {
    const r = decode(
      baseVoiceResult({
        expenseType: "itemized",
        amountCents: 3000,
        items: [{ description: "Pizza", quantity: 2, unitPriceCents: 1000, totalCents: 3000 }],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(issueOf(r).code).toBe("line_total_mismatch");
  });

  it("rejects nonempty items with zero top-level amount (never infers the sum)", () => {
    const r = decode(
      baseVoiceResult({
        expenseType: "itemized",
        amountCents: 0,
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

  it("rejects negative amountCents instead of clamping", () => {
    expect(decode(baseVoiceResult({ amountCents: -500 })).ok).toBe(false);
  });
});

describe("decodeExpenseResult(voice) — participants", () => {
  it("rejects an unknown participant key", () => {
    const r = decode(
      baseVoiceResult({
        participants: [{ spokenName: "Bob", matchedHandle: "bob", confidence: "high", extra: 1 }],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(issueOf(r)).toEqual({
      code: "invalid_structure",
      source: "voice",
      path: ["participants", 0],
      reason: "unknown_key",
    });
  });

  it("accepts a null matchedHandle", () => {
    const r = decode(
      baseVoiceResult({
        participants: [{ spokenName: "João", matchedHandle: null, confidence: "low" }],
      }),
    );
    expect(r.ok).toBe(true);
  });
});
