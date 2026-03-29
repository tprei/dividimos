import { describe, it, expect } from "vitest";
import { sanitizeReceiptResult } from "./receipt-sanitize";
import type { ReceiptOcrResult } from "./receipt-ocr";

function makeResult(overrides: Partial<ReceiptOcrResult> = {}): ReceiptOcrResult {
  return {
    merchant: "Loja Teste",
    items: [],
    serviceFeePercent: 0,
    totalCents: 0,
    ...overrides,
  };
}

describe("sanitizeReceiptResult", () => {
  describe("per-item arithmetic — qty = 1", () => {
    it("sets unitPriceCents = totalCents when qty is 1", () => {
      const result = makeResult({
        items: [{ description: "Item", quantity: 1, unitPriceCents: 999, totalCents: 1000 }],
        totalCents: 1000,
      });
      const { items } = sanitizeReceiptResult(result);
      expect(items[0].unitPriceCents).toBe(1000);
      expect(items[0].totalCents).toBe(1000);
    });
  });

  describe("per-item arithmetic — qty > 1", () => {
    it("corrects unitPriceCents when it equals totalCents (OCR mistake)", () => {
      // OCR returned unitPriceCents = 3000 (line total) instead of 1000 (unit price)
      const result = makeResult({
        items: [{ description: "Cerveja", quantity: 3, unitPriceCents: 3000, totalCents: 3000 }],
        totalCents: 3000,
      });
      const { items } = sanitizeReceiptResult(result);
      expect(items[0].unitPriceCents).toBe(1000);
      expect(items[0].totalCents).toBe(3000);
    });

    it("keeps consistent unitPriceCents × qty ≈ totalCents", () => {
      const result = makeResult({
        items: [{ description: "Agua", quantity: 2, unitPriceCents: 350, totalCents: 700 }],
        totalCents: 700,
      });
      const { items } = sanitizeReceiptResult(result);
      expect(items[0].unitPriceCents).toBe(350);
      expect(items[0].totalCents).toBe(700);
    });

    it("derives unitPriceCents from totalCents when they are inconsistent", () => {
      // 4 × 250 = 1000 but OCR returned totalCents=1200 (trust total)
      const result = makeResult({
        items: [{ description: "Suco", quantity: 4, unitPriceCents: 250, totalCents: 1200 }],
        totalCents: 1200,
      });
      const { items } = sanitizeReceiptResult(result);
      expect(items[0].totalCents).toBe(1200);
      expect(items[0].unitPriceCents).toBe(300); // 1200 / 4
    });

    it("preserves fractional quantity (weight-based items)", () => {
      // 0.5 KG of meat at R$60/kg = R$30 total
      const result = makeResult({
        items: [{ description: "Picanha", quantity: 0.5, unitPriceCents: 6000, totalCents: 3000 }],
        totalCents: 3000,
      });
      const { items } = sanitizeReceiptResult(result);
      expect(items[0].quantity).toBe(0.5);
      expect(items[0].unitPriceCents).toBe(6000);
      expect(items[0].totalCents).toBe(3000);
    });

    it("handles rounding tolerance (qty=3, unit=333, total=1000 — off by 1)", () => {
      const result = makeResult({
        items: [{ description: "Item", quantity: 3, unitPriceCents: 333, totalCents: 1000 }],
        totalCents: 1000,
      });
      const { items } = sanitizeReceiptResult(result);
      // 333 × 3 = 999 ≠ 1000 but within tolerance (gap=1 ≤ qty=3)
      expect(items[0].totalCents).toBe(1000);
    });
  });

  describe("receipt total reconciliation", () => {
    it("returns totalCents = 0 result with itemsSum when receiptTotal is 0", () => {
      const result = makeResult({
        items: [{ description: "Item", quantity: 1, unitPriceCents: 500, totalCents: 500 }],
        totalCents: 0,
      });
      const sanitized = sanitizeReceiptResult(result);
      expect(sanitized.totalCents).toBe(500);
      expect(sanitized.totalMismatch).toBeFalsy();
    });

    it("absorbs small rounding gap (1 centavo) into largest item", () => {
      const result = makeResult({
        items: [
          { description: "A", quantity: 1, unitPriceCents: 1000, totalCents: 1000 },
          { description: "B", quantity: 1, unitPriceCents: 500, totalCents: 500 },
        ],
        totalCents: 1501, // 1 centavo more than itemsSum
      });
      const sanitized = sanitizeReceiptResult(result);
      const newSum = sanitized.items.reduce((s, i) => s + i.totalCents, 0);
      expect(newSum).toBe(1501);
      expect(sanitized.totalMismatch).toBeFalsy();
    });

    it("sets totalMismatch when gap is larger than tolerance", () => {
      const result = makeResult({
        items: [
          { description: "A", quantity: 1, unitPriceCents: 1000, totalCents: 1000 },
        ],
        totalCents: 1500, // 500 centavo gap — clearly wrong
      });
      const sanitized = sanitizeReceiptResult(result);
      expect(sanitized.totalMismatch).toBe(true);
      expect(sanitized.items[0].totalCents).toBe(1000); // unchanged
    });

    it("accounts for service fee when reconciling", () => {
      // Items sum = 1000, 10% service fee → expected total = 1100
      const result = makeResult({
        items: [{ description: "Prato", quantity: 1, unitPriceCents: 1000, totalCents: 1000 }],
        serviceFeePercent: 10,
        totalCents: 1100,
      });
      const sanitized = sanitizeReceiptResult(result);
      expect(sanitized.totalMismatch).toBeFalsy();
      expect(sanitized.totalCents).toBe(1100);
    });

    it("does not touch items when items list is empty", () => {
      const result = makeResult({ items: [], totalCents: 500 });
      const sanitized = sanitizeReceiptResult(result);
      expect(sanitized.items).toHaveLength(0);
      expect(sanitized.totalMismatch).toBeFalsy();
    });

    it("handles multiple items needing rounding correction", () => {
      // 3 items, 3-centavo gap → spread 1 centavo each
      const result = makeResult({
        items: [
          { description: "A", quantity: 1, unitPriceCents: 333, totalCents: 333 },
          { description: "B", quantity: 1, unitPriceCents: 333, totalCents: 333 },
          { description: "C", quantity: 1, unitPriceCents: 333, totalCents: 333 },
        ],
        totalCents: 1000, // 999 + 1 gap
      });
      const sanitized = sanitizeReceiptResult(result);
      const newSum = sanitized.items.reduce((s, i) => s + i.totalCents, 0);
      expect(newSum).toBe(1000);
      expect(sanitized.totalMismatch).toBeFalsy();
    });
  });
});
