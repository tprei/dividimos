import { describe, expect, it } from "vitest";
import {
  MAX_EXPENSE_CENTS,
  MAX_EXPENSE_SOURCE_MERCHANT_NAME_CODE_POINTS,
  MAX_EXPENSE_SOURCE_TITLE_CODE_POINTS,
  decodeExpenseResult,
  toModelContractIssue,
  type ExpenseDecodeIssue,
} from "./expense-money";

const CONTEXT = { members: [{ handle: "bob", name: "Bob" }] };

function baseChatResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Uber",
    amountCents: 2500,
    expenseType: "single_amount",
    splitType: "equal",
    items: [],
    participants: [],
    payerHandle: "SELF",
    merchantName: null,
    confidence: "high",
    allocations: [],
    ...overrides,
  };
}

function decode(raw: unknown) {
  return decodeExpenseResult("chat", "source_parse", raw, CONTEXT);
}

function issueOf(r: { ok: false; issue: ExpenseDecodeIssue }): ExpenseDecodeIssue {
  return r.issue;
}

describe("decodeExpenseResult(chat) — happy paths", () => {
  it("decodes a valid equal-split single_amount result", () => {
    const r = decode(baseChatResult());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.source).toBe("chat");
    expect(r.value.title).toBe("Uber");
    expect(r.value.splitType).toBe("equal");
    expect(r.value.allocations).toEqual([]);
    expect(r.value.money.outcome).toBe("complete");
    if (r.value.money.outcome === "complete") {
      expect(r.value.money.totalAmountCents).toBe(2500);
    }
  });

  it("decodes a valid custom-split result with exact two allocation rows", () => {
    const r = decode(
      baseChatResult({
        title: "Conta",
        amountCents: 10000,
        splitType: "custom",
        payerHandle: "SELF",
        allocations: [
          { participantHandle: "SELF", shareAmountCents: 6000 },
          { participantHandle: "bob", shareAmountCents: 4000 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.splitType).toBe("custom");
    expect(r.value.allocations).toEqual([
      { participantHandle: "SELF", shareAmountCents: 6000 },
      { participantHandle: "bob", shareAmountCents: 4000 },
    ]);
  });

  it("decodes an itemized result with reconciled items", () => {
    const r = decode(
      baseChatResult({
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
      expect(r.value.money.items[0].description).toBe("Cerveja");
    }
  });

  it("decodes the edit-only zero-amount sentinel when items are empty", () => {
    const r = decode(baseChatResult({ title: "Almoço", amountCents: 0, confidence: "low" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.money.outcome).toBe("edit_only_amount_incomplete");
  });

  it("returns a recursively frozen result that cannot be mutated", () => {
    const r = decode(baseChatResult());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(() => {
      (r.value as { title: string }).title = "hacked";
    }).toThrow();
    expect(() => {
      (r.value.participants as unknown[]).push({});
    }).toThrow();
  });

  it("does not mutate the raw input object", () => {
    const raw = baseChatResult();
    const snapshot = JSON.parse(JSON.stringify(raw));
    decode(raw);
    expect(raw).toEqual(snapshot);
  });
});

describe("decodeExpenseResult(chat) — exact root keys", () => {
  it("rejects a missing required root key", () => {
    const raw = baseChatResult();
    delete raw.confidence;
    const r = decode(raw);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(issueOf(r)).toEqual({
      code: "invalid_structure",
      source: "chat",
      path: ["confidence"],
      reason: "missing_key",
    });
  });

  it("rejects an unknown extra root key", () => {
    const r = decode(baseChatResult({ extraField: 1 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(issueOf(r)).toEqual({
      code: "invalid_structure",
      source: "chat",
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
      source: "chat",
      path: [],
      reason: "null",
    });
  });

  it("rejects an array root", () => {
    const r = decode([]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(issueOf(r).code).toBe("invalid_structure");
  });

  it("rejects a canonical (non-source) key name at the raw boundary", () => {
    // The canonical wire key is `totalAmountCents`; the raw chat provider key
    // is `amountCents`. A canonical name here must not be silently accepted.
    const raw = baseChatResult();
    delete raw.amountCents;
    (raw as Record<string, unknown>).totalAmountCents = 2500;
    const r = decode(raw);
    expect(r.ok).toBe(false);
  });
});

describe("decodeExpenseResult(chat) — metadata", () => {
  it("rejects a blank title", () => {
    const r = decode(baseChatResult({ title: "   " }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(issueOf(r)).toEqual({
      code: "invalid_source_contract",
      source: "chat",
      reason: "metadata",
    });
  });

  it("accepts a title exactly at the code-point bound and rejects one over", () => {
    const at = "a".repeat(MAX_EXPENSE_SOURCE_TITLE_CODE_POINTS);
    const over = "a".repeat(MAX_EXPENSE_SOURCE_TITLE_CODE_POINTS + 1);
    expect(decode(baseChatResult({ title: at })).ok).toBe(true);
    expect(decode(baseChatResult({ title: over })).ok).toBe(false);
  });

  it("accepts a null merchantName", () => {
    expect(decode(baseChatResult({ merchantName: null })).ok).toBe(true);
  });

  it("rejects a blank non-null merchantName", () => {
    expect(decode(baseChatResult({ merchantName: "  " })).ok).toBe(false);
  });

  it("accepts a merchantName exactly at the code-point bound and rejects one over", () => {
    const at = "a".repeat(MAX_EXPENSE_SOURCE_MERCHANT_NAME_CODE_POINTS);
    const over = "a".repeat(MAX_EXPENSE_SOURCE_MERCHANT_NAME_CODE_POINTS + 1);
    expect(decode(baseChatResult({ merchantName: at })).ok).toBe(true);
    expect(decode(baseChatResult({ merchantName: over })).ok).toBe(false);
  });

  it("rejects an invalid confidence value", () => {
    for (const bad of ["HIGH", "", null, undefined, 1]) {
      expect(decode(baseChatResult({ confidence: bad })).ok).toBe(false);
    }
  });

  it("rejects a blank non-null payerHandle", () => {
    expect(decode(baseChatResult({ payerHandle: "" })).ok).toBe(false);
  });

  it("accepts a null payerHandle", () => {
    expect(decode(baseChatResult({ payerHandle: null })).ok).toBe(true);
  });
});

describe("decodeExpenseResult(chat) — splitType, never defaults", () => {
  it("rejects a missing/null splitType instead of defaulting to equal", () => {
    for (const bad of [null, undefined, "", "unequal", 1]) {
      const r = decode(baseChatResult({ splitType: bad }));
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(issueOf(r)).toEqual({
        code: "invalid_source_contract",
        source: "chat",
        reason: "allocations",
      });
    }
  });

  it("rejects a nonempty allocations array for an equal split", () => {
    const r = decode(
      baseChatResult({
        splitType: "equal",
        allocations: [{ participantHandle: "SELF", shareAmountCents: 1 }],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(issueOf(r)).toEqual({
      code: "invalid_source_contract",
      source: "chat",
      reason: "allocations",
    });
  });

  it("rejects a malformed (non-array) allocations field for an equal split", () => {
    const r = decode(baseChatResult({ splitType: "equal", allocations: null }));
    expect(r.ok).toBe(false);
  });
});

describe("decodeExpenseResult(chat) — custom allocations never fall back to equal", () => {
  const cases: Array<[string, unknown]> = [
    ["missing/null", null],
    ["empty array (undetermined)", []],
    ["one row", [{ participantHandle: "SELF", shareAmountCents: 6000 }]],
    [
      "three rows",
      [
        { participantHandle: "SELF", shareAmountCents: 3000 },
        { participantHandle: "bob", shareAmountCents: 3000 },
        { participantHandle: "carol", shareAmountCents: 4000 },
      ],
    ],
    [
      "negative cents",
      [
        { participantHandle: "SELF", shareAmountCents: -100 },
        { participantHandle: "bob", shareAmountCents: 10100 },
      ],
    ],
    [
      "fractional cents",
      [
        { participantHandle: "SELF", shareAmountCents: 60.5 },
        { participantHandle: "bob", shareAmountCents: 4000 },
      ],
    ],
    [
      "blank handle",
      [
        { participantHandle: "", shareAmountCents: 6000 },
        { participantHandle: "bob", shareAmountCents: 4000 },
      ],
    ],
    [
      "extra row key",
      [
        { participantHandle: "SELF", shareAmountCents: 6000, extra: 1 },
        { participantHandle: "bob", shareAmountCents: 4000 },
      ],
    ],
    [
      "missing row key",
      [{ participantHandle: "SELF" }, { participantHandle: "bob", shareAmountCents: 4000 }],
    ],
  ];

  it.each(cases)("collapses %s to an empty edit-only sentinel, never an error and never equal", (_label, allocations) => {
    const r = decode(baseChatResult({ splitType: "custom", amountCents: 10000, allocations }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.splitType).toBe("custom");
    expect(r.value.allocations).toEqual([]);
  });

  it("preserves an exact two-row custom allocation byte-for-byte", () => {
    const r = decode(
      baseChatResult({
        splitType: "custom",
        amountCents: 10000,
        allocations: [
          { participantHandle: "bob", shareAmountCents: 4000 },
          { participantHandle: "SELF", shareAmountCents: 6000 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Order is preserved exactly as supplied; resolving/reordering is #476's
    // adapter's job, not this structural decoder's.
    expect(r.value.allocations).toEqual([
      { participantHandle: "bob", shareAmountCents: 4000 },
      { participantHandle: "SELF", shareAmountCents: 6000 },
    ]);
  });

  it("accepts a zero-cent row (one participant owes nothing)", () => {
    const r = decode(
      baseChatResult({
        splitType: "custom",
        amountCents: 10000,
        allocations: [
          { participantHandle: "SELF", shareAmountCents: 0 },
          { participantHandle: "bob", shareAmountCents: 10000 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.allocations).toEqual([
      { participantHandle: "SELF", shareAmountCents: 0 },
      { participantHandle: "bob", shareAmountCents: 10000 },
    ]);
  });

  it("accepts cents exactly at MAX_EXPENSE_CENTS and rejects (collapses) one cent over", () => {
    const atMax = decode(
      baseChatResult({
        splitType: "custom",
        amountCents: MAX_EXPENSE_CENTS,
        allocations: [
          { participantHandle: "SELF", shareAmountCents: MAX_EXPENSE_CENTS },
          { participantHandle: "bob", shareAmountCents: 0 },
        ],
      }),
    );
    expect(atMax.ok).toBe(true);
    if (atMax.ok) expect(atMax.value.allocations).toHaveLength(2);

    const overMax = decode(
      baseChatResult({
        splitType: "custom",
        amountCents: 10000,
        allocations: [
          { participantHandle: "SELF", shareAmountCents: MAX_EXPENSE_CENTS + 1 },
          { participantHandle: "bob", shareAmountCents: 0 },
        ],
      }),
    );
    expect(overMax.ok).toBe(true);
    if (overMax.ok) expect(overMax.value.allocations).toEqual([]);
  });
});

describe("decodeExpenseResult(chat) — items", () => {
  it("rejects an unknown item key using the source-only totalCents field name", () => {
    const r = decode(
      baseChatResult({
        expenseType: "itemized",
        amountCents: 1000,
        items: [{ description: "X", quantity: 1, unitPriceCents: 1000, totalPriceCents: 1000 }],
      }),
    );
    // `totalPriceCents` is the canonical key; raw chat items use `totalCents`.
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(issueOf(r).code).toBe("invalid_structure");
  });

  it("rejects a line total that does not match quantity x unit price", () => {
    const r = decode(
      baseChatResult({
        expenseType: "itemized",
        amountCents: 3000,
        items: [{ description: "Pizza", quantity: 2, unitPriceCents: 1000, totalCents: 3000 }],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(issueOf(r).code).toBe("line_total_mismatch");
  });

  it("rejects a blank item description", () => {
    const r = decode(
      baseChatResult({
        expenseType: "itemized",
        amountCents: 1000,
        items: [{ description: "  ", quantity: 1, unitPriceCents: 1000, totalCents: 1000 }],
      }),
    );
    expect(r.ok).toBe(false);
  });

  it("rejects nonempty items with zero top-level amount (never infers the sum)", () => {
    const r = decode(
      baseChatResult({
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

  it("rejects a positive itemized total with no items", () => {
    const r = decode(baseChatResult({ expenseType: "itemized", amountCents: 500, items: [] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(issueOf(r)).toEqual({
      code: "itemized_shape_mismatch",
      reason: "empty_items_positive_total",
    });
  });
});

describe("decodeExpenseResult(chat) — participants", () => {
  it("rejects an unknown participant key", () => {
    const r = decode(
      baseChatResult({
        participants: [{ spokenName: "Bob", matchedHandle: "bob", confidence: "high", extra: 1 }],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(issueOf(r)).toEqual({
      code: "invalid_structure",
      source: "chat",
      path: ["participants", 0],
      reason: "unknown_key",
    });
  });

  it("accepts a null matchedHandle", () => {
    const r = decode(
      baseChatResult({
        participants: [{ spokenName: "João", matchedHandle: null, confidence: "low" }],
      }),
    );
    expect(r.ok).toBe(true);
  });

  it("rejects an invalid participant confidence", () => {
    const r = decode(
      baseChatResult({
        participants: [{ spokenName: "Bob", matchedHandle: "bob", confidence: "certain" }],
      }),
    );
    expect(r.ok).toBe(false);
  });
});

describe("toModelContractIssue", () => {
  it("maps a structural issue to category structure", () => {
    const r = decode(baseChatResult({ extraField: 1 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(toModelContractIssue(r.issue)).toEqual({
      code: "MODEL_CONTRACT_INVALID",
      category: "structure",
      path: [],
    });
  });

  it("maps an item issue to category item", () => {
    const r = decode(
      baseChatResult({
        expenseType: "itemized",
        amountCents: 3000,
        items: [{ description: "Pizza", quantity: 2, unitPriceCents: 1000, totalCents: 3000 }],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(toModelContractIssue(r.issue).category).toBe("item");
  });

  it("maps a money issue (itemized_shape_mismatch) to category item per the exhaustive switch", () => {
    const r = decode(baseChatResult({ expenseType: "itemized", amountCents: 500, items: [] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(toModelContractIssue(r.issue).category).toBe("item");
  });
});
