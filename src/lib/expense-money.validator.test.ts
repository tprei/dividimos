import { describe, expect, it } from "vitest";
import {
  MAX_EXPENSE_CENTS,
  MAX_EXPENSE_ITEMS,
  MAX_EXPENSE_SOURCE_ITEM_DESCRIPTION_CODE_POINTS,
  computeServiceFeeCents,
  parseExpenseCents,
  sumExpenseCents,
  validateExpenseMoney,
  type CompleteExpenseMoney,
  type EditOnlyParsedExpenseMoney,
  type EmptyPersistableDraftMoney,
  type ExpenseMoneyInput,
  type ExpenseMoneyMode,
} from "./expense-money";
import {
  computeExpenseLineTotalCents,
  parseExpenseQuantity,
} from "./expense-quantity";

// ---------------------------------------------------------------------------
// Fixture builders. Valid items are assembled with the real parsers and the
// real line-total function so fixtures stay cent-exact and consistent; the
// validator under test never sees an internally-inconsistent happy-path input.
// ---------------------------------------------------------------------------

function validItem(
  description: string,
  quantity: unknown,
  unitCents: number,
): Record<string, unknown> {
  const q = parseExpenseQuantity(quantity);
  if (!q.ok) throw new Error(`fixture: bad quantity ${String(quantity)}`);
  const u = parseExpenseCents(unitCents, "positive");
  if (!u.ok) throw new Error(`fixture: bad unit ${unitCents}`);
  const lt = computeExpenseLineTotalCents(q.value, u.value);
  if (!lt.ok) throw new Error(`fixture: bad line total`);
  return {
    description,
    quantity,
    unitPriceCents: unitCents,
    totalPriceCents: lt.value as number,
  };
}

function singleAmount(
  total: unknown,
  overrides: Partial<ExpenseMoneyInput> = {},
): ExpenseMoneyInput {
  return {
    expenseType: "single_amount",
    totalAmountCents: total,
    serviceFeeBasisPoints: 0,
    fixedFeesCents: 0,
    items: [],
    ...overrides,
  };
}

function itemized(
  opts: {
    total?: unknown;
    bps?: unknown;
    fixedFees?: unknown;
    items?: unknown;
  } = {},
): ExpenseMoneyInput {
  return {
    expenseType: "itemized",
    totalAmountCents: opts.total ?? 0,
    serviceFeeBasisPoints: opts.bps ?? 0,
    fixedFeesCents: opts.fixedFees ?? 0,
    items: opts.items ?? [],
  };
}

function issueOf(r: { ok: false; issue: Record<string, unknown> }) {
  return r.issue;
}

// One exact positive line: 0,5 x 101 = 51 (half-up).
const LINE_HALF = validItem("half", "0,5", 101);
// An itemized expense that reconciles to 51 with no fees.
function itemized51(): ExpenseMoneyInput {
  return itemized({ total: 51, bps: 0, items: [LINE_HALF] });
}

describe("validateExpenseMoney — structural decode", () => {
  it("rejects an unknown expenseType", () => {
    const r = validateExpenseMoney(
      { ...singleAmount(0), expenseType: "lump" },
      "source_parse",
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issue).toEqual({
      code: "invalid_expense_shape",
      reason: "expense_type",
    });
  });

  it("rejects a non-number serviceFeeBasisPoints", () => {
    const r = validateExpenseMoney(
      itemized({ bps: "5", total: 0 }),
      "draft",
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issue).toEqual({
      code: "invalid_service_fee",
      path: ["serviceFeeBasisPoints"],
    });
  });

  it("rejects a non-integer fixedFeesCents", () => {
    const r = validateExpenseMoney(
      itemized({ fixedFees: 1.5, total: 0 }),
      "draft",
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issue).toEqual({
      code: "invalid_cents",
      path: ["fixedFeesCents"],
    });
  });

  it("rejects a non-array items collection", () => {
    const r = validateExpenseMoney(
      itemized({ items: { not: "array" } }),
      "source_parse",
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issue).toEqual({
      code: "invalid_item_collection",
      reason: "not_array",
    });
  });

  it("rejects more than MAX_EXPENSE_ITEMS items", () => {
    const items = new Array(MAX_EXPENSE_ITEMS + 1).fill(LINE_HALF);
    const r = validateExpenseMoney(itemized({ items, total: 0 }), "source_parse");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issue).toEqual({
      code: "invalid_item_collection",
      reason: "count",
    });
  });
});

describe("validateExpenseMoney — totalAmountCents boundaries", () => {
  it("accepts 1 and MAX_EXPENSE_CENTS for a single amount", () => {
    expect(validateExpenseMoney(singleAmount(1), "activation").ok).toBe(true);
    expect(
      validateExpenseMoney(singleAmount(MAX_EXPENSE_CENTS), "activation").ok,
    ).toBe(true);
  });

  it("rejects zero where a positive total is required only by mode, not by decode", () => {
    // decode itself accepts zero; mode rejects it. Here we assert decode-level
    // rejection for clearly invalid scalar totals.
    expect(
      issueOf(
        validateExpenseMoney(singleAmount(-1), "source_parse") as {
          ok: false;
          issue: Record<string, unknown>;
        },
      ),
    ).toEqual({ code: "invalid_cents", path: ["totalAmountCents"] });
  });

  it("rejects MAX+1, fractional, negative, string, NaN totals as invalid_cents", () => {
    for (const bad of [
      MAX_EXPENSE_CENTS + 1,
      1.5,
      -5,
      "100",
      NaN,
      null,
      undefined,
    ]) {
      const r = validateExpenseMoney(singleAmount(bad), "source_parse");
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.issue).toEqual({
        code: "invalid_cents",
        path: ["totalAmountCents"],
      });
    }
  });
});

describe("validateExpenseMoney — item structure", () => {
  const baseItem = () => ({ ...LINE_HALF });

  it("rejects a non-object item", () => {
    const r = validateExpenseMoney(
      itemized({ items: [42], total: 51 }),
      "scan_review",
    );
    expect(issueOf(r as { ok: false; issue: Record<string, unknown> })).toEqual({
      code: "invalid_item_structure",
      itemIndex: 0,
      path: [],
      reason: "not_object",
    });
  });

  it("rejects an array item", () => {
    const r = validateExpenseMoney(
      itemized({ items: [[1, 2]], total: 51 }),
      "scan_review",
    );
    expect(issueOf(r as { ok: false; issue: Record<string, unknown> })).toEqual({
      code: "invalid_item_structure",
      itemIndex: 0,
      path: [],
      reason: "not_object",
    });
  });

  it("rejects each missing required key", () => {
    for (const key of ["description", "quantity", "unitPriceCents", "totalPriceCents"]) {
      const item = baseItem();
      delete item[key];
      const r = validateExpenseMoney(
        itemized({ items: [item], total: 51 }),
        "scan_review",
      );
      expect(issueOf(r as { ok: false; issue: Record<string, unknown> })).toEqual({
        code: "invalid_item_structure",
        itemIndex: 0,
        path: [key],
        reason: "missing_key",
      });
    }
  });

  it("rejects an unknown key", () => {
    const r = validateExpenseMoney(
      itemized({ items: [{ ...baseItem(), extra: 1 }], total: 51 }),
      "scan_review",
    );
    expect(issueOf(r as { ok: false; issue: Record<string, unknown> })).toEqual({
      code: "invalid_item_structure",
      itemIndex: 0,
      path: ["extra"],
      reason: "unknown_key",
    });
  });

  it("rejects a non-string description", () => {
    const r = validateExpenseMoney(
      itemized({ items: [{ ...baseItem(), description: 5 }], total: 51 }),
      "scan_review",
    );
    expect(issueOf(r as { ok: false; issue: Record<string, unknown> })).toEqual({
      code: "invalid_item_structure",
      itemIndex: 0,
      path: ["description"],
      reason: "wrong_type",
    });
  });

  it("rejects a blank description", () => {
    for (const blank of ["", "   ", "\t\n"]) {
      const r = validateExpenseMoney(
        itemized({ items: [{ ...baseItem(), description: blank }], total: 51 }),
        "scan_review",
      );
      expect(issueOf(r as { ok: false; issue: Record<string, unknown> })).toEqual({
        code: "invalid_item_structure",
        itemIndex: 0,
        path: ["description"],
        reason: "blank_description",
      });
    }
  });

  it("rejects a description over the code-point bound and accepts exactly at it", () => {
    const at = "a".repeat(MAX_EXPENSE_SOURCE_ITEM_DESCRIPTION_CODE_POINTS);
    const over = "a".repeat(MAX_EXPENSE_SOURCE_ITEM_DESCRIPTION_CODE_POINTS + 1);
    expect(
      validateExpenseMoney(
        itemized({ items: [{ ...baseItem(), description: at }], total: 51 }),
        "scan_review",
      ).ok,
    ).toBe(true);
    expect(
      issueOf(
        validateExpenseMoney(
          itemized({ items: [{ ...baseItem(), description: over }], total: 51 }),
          "scan_review",
        ) as { ok: false; issue: Record<string, unknown> },
      ),
    ).toEqual({
      code: "invalid_item_structure",
      itemIndex: 0,
      path: ["description"],
      reason: "description_bound",
    });
  });

  it("counts astral characters as single code points", () => {
    const emoji = "🌟";
    const at = emoji.repeat(MAX_EXPENSE_SOURCE_ITEM_DESCRIPTION_CODE_POINTS);
    const over = emoji.repeat(MAX_EXPENSE_SOURCE_ITEM_DESCRIPTION_CODE_POINTS + 1);
    expect(
      validateExpenseMoney(
        itemized({ items: [{ ...baseItem(), description: at }], total: 51 }),
        "scan_review",
      ).ok,
    ).toBe(true);
    expect(
      validateExpenseMoney(
        itemized({ items: [{ ...baseItem(), description: over }], total: 51 }),
        "scan_review",
      ).ok,
    ).toBe(false);
  });

  it("rejects a non-positive unitPriceCents", () => {
    const r = validateExpenseMoney(
      itemized({ items: [{ ...baseItem(), unitPriceCents: 0 }], total: 51 }),
      "scan_review",
    );
    expect(issueOf(r as { ok: false; issue: Record<string, unknown> })).toEqual({
      code: "invalid_item_cents",
      itemIndex: 0,
      field: "unitPriceCents",
    });
  });

  it("rejects a non-positive totalPriceCents", () => {
    const r = validateExpenseMoney(
      itemized({ items: [{ ...baseItem(), totalPriceCents: 0 }], total: 51 }),
      "scan_review",
    );
    expect(issueOf(r as { ok: false; issue: Record<string, unknown> })).toEqual({
      code: "invalid_item_cents",
      itemIndex: 0,
      field: "totalPriceCents",
    });
  });
});

describe("validateExpenseMoney — quantity and line totals", () => {
  it("accepts 0,5 x 101 = 51 (half-up)", () => {
    expect(validateExpenseMoney(itemized51(), "scan_review").ok).toBe(true);
  });

  it("accepts a three-decimal quantity 1,001 x 1000 = 1001", () => {
    const r = validateExpenseMoney(
      itemized({ total: 1001, items: [validItem("triple", "1,001", 1000)] }),
      "scan_review",
    );
    expect(r.ok).toBe(true);
  });

  it("rejects over-precision quantity as invalid_quantity", () => {
    const over = validateExpenseMoney(
      itemized({
        items: [{ ...validItem("x", "1", 100), quantity: "0,0001" }],
        total: 100,
      }),
      "scan_review",
    );
    expect(issueOf(over as { ok: false; issue: Record<string, unknown> })).toEqual({
      code: "invalid_quantity",
      itemIndex: 0,
      issue: { code: "excess_precision" },
    });
  });

  it("rejects an off-by-one line total", () => {
    const item = { ...LINE_HALF, totalPriceCents: 52 };
    const r = validateExpenseMoney(
      itemized({ items: [item], total: 52 }),
      "scan_review",
    );
    expect(issueOf(r as { ok: false; issue: Record<string, unknown> })).toEqual({
      code: "line_total_mismatch",
      itemIndex: 0,
    });
  });

  it("rejects a derived line total above the cap", () => {
    // q=999 (999000 milliunits) x 99999999 -> far above MAX_EXPENSE_CENTS.
    const r = validateExpenseMoney(
      itemized({
        items: [{ description: "big", quantity: "999", unitPriceCents: 99999999, totalPriceCents: 99999999 }],
        total: 99999999,
      }),
      "scan_review",
    );
    expect(issueOf(r as { ok: false; issue: Record<string, unknown> })).toEqual({
      code: "derived_amount_out_of_range",
      field: "line_total",
      itemIndex: 0,
    });
  });
});

describe("validateExpenseMoney — fees", () => {
  it("accepts the full valid basis-point range", () => {
    for (const bps of [0, 1, 5000, 9999, 10000]) {
      const subtotal = parseExpenseCents(51, "allow");
      if (!subtotal.ok) throw new Error("fixture: bad subtotal");
      const fee = computeServiceFeeCents(subtotal.value, bps);
      if (!fee.ok) throw new Error("fixture: bad fee");
      const grand = sumExpenseCents([subtotal.value, fee.value]);
      if (!grand.ok) throw new Error("fixture: bad grand");
      const r = validateExpenseMoney(
        itemized({ bps, total: grand.value as number, items: [LINE_HALF] }),
        "scan_review",
      );
      expect(r.ok).toBe(true);
    }
  });

  it("rejects basis points above the cap", () => {
    const r = validateExpenseMoney(
      itemized({ bps: 10001, total: 51, items: [LINE_HALF] }),
      "scan_review",
    );
    expect(issueOf(r as { ok: false; issue: Record<string, unknown> })).toEqual({
      code: "invalid_service_fee",
      path: ["serviceFeeBasisPoints"],
    });
  });

  it("computes a one-cent subtotal at 50% -> fee 1, grand 2", () => {
    const r = validateExpenseMoney(
      itemized({ bps: 5000, total: 2, items: [validItem("one", "1", 1)] }),
      "scan_review",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.value as CompleteExpenseMoney;
    expect(v.summary.serviceFeeCents as number).toBe(1);
    expect(v.summary.totalAmountCents as number).toBe(2);
  });

  it("computes a one-cent subtotal at 1bp -> fee 0, grand 1", () => {
    const r = validateExpenseMoney(
      itemized({ bps: 1, total: 1, items: [validItem("one", "1", 1)] }),
      "scan_review",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.value as CompleteExpenseMoney;
    expect(v.summary.serviceFeeCents as number).toBe(0);
    expect(v.summary.totalAmountCents as number).toBe(1);
  });

  it("rejects a subtotal above the cap", () => {
    const a = validItem("a", "1", 60000000); // 60,000,000
    const b = validItem("b", "1", 60000000); // 60,000,000 -> sum 120,000,000
    const r = validateExpenseMoney(
      itemized({ items: [a, b], total: MAX_EXPENSE_CENTS }),
      "scan_review",
    );
    expect(issueOf(r as { ok: false; issue: Record<string, unknown> })).toEqual({
      code: "derived_amount_out_of_range",
      field: "subtotal",
    });
  });

  it("rejects a grand total above the cap", () => {
    // subtotal = MAX, fixed fee = 1 -> grand = MAX + 1.
    const r = validateExpenseMoney(
      itemized({
        fixedFees: 1,
        total: MAX_EXPENSE_CENTS,
        items: [validItem("max", "1", MAX_EXPENSE_CENTS)],
      }),
      "scan_review",
    );
    expect(issueOf(r as { ok: false; issue: Record<string, unknown> })).toEqual({
      code: "derived_amount_out_of_range",
      field: "grand_total",
    });
  });

  it("rejects an itemized total that does not match the reconciled grand total", () => {
    const r = validateExpenseMoney(
      itemized({ bps: 0, total: 52, items: [LINE_HALF] }), // reconciles to 51
      "scan_review",
    );
    expect(issueOf(r as { ok: false; issue: Record<string, unknown> })).toEqual({
      code: "itemized_total_mismatch",
    });
  });
});

describe("validateExpenseMoney — variants", () => {
  it("rejects a single_amount that carries items", () => {
    const r = validateExpenseMoney(
      singleAmount(100, { items: [LINE_HALF] }),
      "source_parse",
    );
    expect(issueOf(r as { ok: false; issue: Record<string, unknown> })).toEqual({
      code: "invalid_expense_shape",
      reason: "single_amount_items",
    });
  });

  it("rejects a single_amount with a nonzero service-fee rate", () => {
    const r = validateExpenseMoney(
      singleAmount(100, { serviceFeeBasisPoints: 500 }),
      "source_parse",
    );
    expect(issueOf(r as { ok: false; issue: Record<string, unknown> })).toEqual({
      code: "invalid_fee_configuration",
      reason: "single_amount_fee",
    });
  });

  it("rejects a single_amount with a fixed fee", () => {
    const r = validateExpenseMoney(
      singleAmount(100, { fixedFeesCents: 5 }),
      "source_parse",
    );
    expect(issueOf(r as { ok: false; issue: Record<string, unknown> })).toEqual({
      code: "invalid_fee_configuration",
      reason: "single_amount_fee",
    });
  });

  it("accepts an empty itemized draft with a retained nonzero rate and zero fee", () => {
    const r = validateExpenseMoney(
      itemized({ bps: 500, total: 0, fixedFees: 0, items: [] }),
      "draft",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.value as EmptyPersistableDraftMoney;
    expect(v.outcome).toBe("empty_draft");
    expect(v.expenseType).toBe("itemized");
    expect(v.serviceFeeBasisPoints as number).toBe(500);
    expect(v.totalAmountCents as number).toBe(0);
    expect(v.items.length).toBe(0);
  });

  it("rejects a fixed fee on an empty itemized draft", () => {
    const r = validateExpenseMoney(
      itemized({ fixedFees: 5, total: 0, items: [] }),
      "draft",
    );
    expect(issueOf(r as { ok: false; issue: Record<string, unknown> })).toEqual({
      code: "invalid_fee_configuration",
      reason: "fixed_fee_without_items",
    });
  });

  it("rejects an empty itemized expense with a positive total", () => {
    const r = validateExpenseMoney(
      itemized({ total: 50, items: [] }),
      "source_parse",
    );
    expect(issueOf(r as { ok: false; issue: Record<string, unknown> })).toEqual({
      code: "itemized_shape_mismatch",
      reason: "empty_items_positive_total",
    });
  });

  it("rejects a nonempty itemized expense with a zero total in every mode", () => {
    const modes: ExpenseMoneyMode[] = [
      "source_parse",
      "scan_review",
      "draft",
      "activation",
      "chat_confirmation",
    ];
    for (const mode of modes) {
      const r = validateExpenseMoney(
        itemized({ total: 0, items: [LINE_HALF] }),
        mode,
      );
      expect(issueOf(r as { ok: false; issue: Record<string, unknown> })).toEqual({
        code: "itemized_shape_mismatch",
        reason: "nonempty_items_zero_total",
      });
    }
  });

  it("accepts a valid nonempty itemized draft and reconciles the summary", () => {
    const r = validateExpenseMoney(itemized51(), "draft");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.value as CompleteExpenseMoney;
    expect(v.outcome).toBe("complete");
    expect(v.summary.itemsSubtotalCents as number).toBe(51);
    expect(v.summary.serviceFeeCents as number).toBe(0);
    expect(v.summary.fixedFeesCents as number).toBe(0);
    expect(v.summary.totalAmountCents as number).toBe(51);
  });
});

describe("validateExpenseMoney — mode matrix", () => {
  const modes: ExpenseMoneyMode[] = [
    "source_parse",
    "scan_review",
    "draft",
    "activation",
    "chat_confirmation",
  ];

  describe("empty single_amount (total 0)", () => {
    it.each(modes)("mode %s", (mode) => {
      const r = validateExpenseMoney(singleAmount(0), mode);
      if (mode === "source_parse") {
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.value.outcome).toBe("edit_only_amount_incomplete");
      } else if (mode === "draft") {
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.value.outcome).toBe("empty_draft");
      } else {
        expect(issueOf(r as { ok: false; issue: Record<string, unknown> })).toEqual({
          code: "incomplete_expense",
        });
      }
    });
  });

  describe("empty itemized (items [], total 0, bps 500)", () => {
    it.each(modes)("mode %s", (mode) => {
      const r = validateExpenseMoney(
        itemized({ bps: 500, total: 0, items: [] }),
        mode,
      );
      if (mode === "source_parse") {
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.value.outcome).toBe("edit_only_amount_incomplete");
        if (r.value.outcome !== "edit_only_amount_incomplete") return;
        expect(r.value.expenseType).toBe("itemized");
        expect(r.value.serviceFeeBasisPoints).toBe(500);
      } else if (mode === "draft") {
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.value.outcome).toBe("empty_draft");
        if (r.value.outcome !== "empty_draft") return;
        expect(r.value.serviceFeeBasisPoints).toBe(500);
      } else {
        expect(issueOf(r as { ok: false; issue: Record<string, unknown> })).toEqual({
          code: "incomplete_expense",
        });
      }
    });
  });

  describe("complete single_amount (total 500)", () => {
    it.each(modes)("mode %s", (mode) => {
      const r = validateExpenseMoney(singleAmount(500), mode);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.outcome).toBe("complete");
      if (r.value.outcome !== "complete") return;
      expect(r.value.totalAmountCents).toBe(500);
    });
  });

  describe("complete itemized (reconciled 51)", () => {
    it.each(modes)("mode %s", (mode) => {
      const r = validateExpenseMoney(itemized51(), mode);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.outcome).toBe("complete");
      if (r.value.outcome !== "complete") return;
      expect(r.value.totalAmountCents).toBe(51);
    });
  });

  it("activation of an incomplete (empty) draft is rejected", () => {
    const r = validateExpenseMoney(singleAmount(0), "activation");
    expect(issueOf(r as { ok: false; issue: Record<string, unknown> })).toEqual({
      code: "incomplete_expense",
    });
  });

  it("exact complete activation succeeds", () => {
    const r = validateExpenseMoney(itemized51(), "activation");
    expect(r.ok).toBe(true);
  });
});

describe("validateExpenseMoney — recursive immutability", () => {
  it("returns a deeply frozen value that resists mutation", () => {
    const r = validateExpenseMoney(itemized51(), "scan_review");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.value as CompleteExpenseMoney;

    // Every level is frozen.
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v.items)).toBe(true);
    expect(Object.isFrozen(v.items[0])).toBe(true);
    expect(Object.isFrozen(v.summary)).toBe(true);

    // Attempted mutation of a child throws (strict mode) and leaves it unchanged.
    const beforeChild = v.items[0].description;
    expect(() => Object.assign(v.items[0], { description: "MUTATED" })).toThrow();
    expect(v.items[0].description).toBe(beforeChild);

    // Attempted mutation of the root throws and leaves it unchanged.
    const beforeOutcome = v.outcome;
    expect(() =>
      Object.assign(v, { outcome: "edit_only_amount_incomplete" }),
    ).toThrow();
    expect(v.outcome).toBe(beforeOutcome);

    // Attempted mutation of the items array throws and leaves length unchanged.
    const beforeLen = v.items.length;
    expect(() =>
      Object.defineProperty(v.items, "length", { value: 99 }),
    ).toThrow();
    expect(v.items.length).toBe(beforeLen);
  });

  it("freezes edit-only and empty-draft outcomes too", () => {
    const edit = validateExpenseMoney(itemized({ bps: 500, total: 0 }), "source_parse");
    const draft = validateExpenseMoney(itemized({ bps: 500, total: 0 }), "draft");
    expect(edit.ok && Object.isFrozen((edit.value as EditOnlyParsedExpenseMoney).items)).toBe(true);
    expect(draft.ok && Object.isFrozen((draft.value as EmptyPersistableDraftMoney).items)).toBe(true);
  });
});
