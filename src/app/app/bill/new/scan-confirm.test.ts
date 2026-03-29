import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userAlice } from "@/test/fixtures";
import { useBillStore } from "@/stores/bill-store";
import type { ReceiptOcrResult } from "@/lib/receipt-ocr";

/**
 * Tests the scan-confirm integration logic: given a ReceiptOcrResult,
 * verify the bill store is populated correctly with items, merchant,
 * expense type, and service fee — matching what handleScanConfirm does
 * in the new bill page.
 */

function simulateScanConfirm(result: ReceiptOcrResult) {
  const store = useBillStore.getState();
  store.setCurrentUser(userAlice);
  store.createExpense(
    result.merchant || "Nota escaneada",
    "itemized",
    result.merchant || undefined,
  );
  store.updateExpense({
    serviceFeePercent: result.serviceFeePercent || 0,
  });

  for (const item of result.items) {
    store.addItem({
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      totalPriceCents: item.totalCents,
    });
  }
}

const sampleResult: ReceiptOcrResult = {
  merchant: "Bar do Zé",
  items: [
    {
      description: "Cerveja Brahma 600ml",
      quantity: 2,
      unitPriceCents: 1200,
      totalCents: 2400,
    },
    {
      description: "Picanha 400g",
      quantity: 1,
      unitPriceCents: 4500,
      totalCents: 4500,
    },
  ],
  serviceFeePercent: 10,
  totalCents: 6900,
};

beforeEach(() => {
  useBillStore.getState().reset();
  useBillStore.setState({ currentUser: null });
});

afterEach(() => {
  useBillStore.getState().reset();
  useBillStore.setState({ currentUser: null });
});

describe("scan confirm → bill store integration", () => {
  it("creates an itemized expense with merchant name", () => {
    simulateScanConfirm(sampleResult);
    const { expense } = useBillStore.getState();
    expect(expense).not.toBeNull();
    expect(expense!.expenseType).toBe("itemized");
    expect(expense!.title).toBe("Bar do Zé");
    expect(expense!.merchantName).toBe("Bar do Zé");
  });

  it("sets service fee from OCR result", () => {
    simulateScanConfirm(sampleResult);
    const { expense } = useBillStore.getState();
    expect(expense!.serviceFeePercent).toBe(10);
  });

  it("populates all scanned items in the store", () => {
    simulateScanConfirm(sampleResult);
    const { items } = useBillStore.getState();
    expect(items).toHaveLength(2);
    expect(items[0].description).toBe("Cerveja Brahma 600ml");
    expect(items[0].quantity).toBe(2);
    expect(items[0].unitPriceCents).toBe(1200);
    expect(items[0].totalPriceCents).toBe(2400);
    expect(items[1].description).toBe("Picanha 400g");
    expect(items[1].quantity).toBe(1);
    expect(items[1].unitPriceCents).toBe(4500);
    expect(items[1].totalPriceCents).toBe(4500);
  });

  it("adds current user as participant", () => {
    simulateScanConfirm(sampleResult);
    const { participants } = useBillStore.getState();
    expect(participants).toHaveLength(1);
    expect(participants[0].id).toBe("user-alice");
  });

  it("uses fallback title when merchant is null", () => {
    simulateScanConfirm({
      ...sampleResult,
      merchant: null,
    });
    const { expense } = useBillStore.getState();
    expect(expense!.title).toBe("Nota escaneada");
    expect(expense!.merchantName).toBeUndefined();
  });

  it("handles zero service fee", () => {
    simulateScanConfirm({
      ...sampleResult,
      serviceFeePercent: 0,
    });
    const { expense } = useBillStore.getState();
    expect(expense!.serviceFeePercent).toBe(0);
  });

  it("handles single item result", () => {
    simulateScanConfirm({
      merchant: "Padaria",
      items: [
        {
          description: "Pão francês",
          quantity: 10,
          unitPriceCents: 50,
          totalCents: 500,
        },
      ],
      serviceFeePercent: 0,
      totalCents: 500,
    });
    const { items } = useBillStore.getState();
    expect(items).toHaveLength(1);
    expect(items[0].description).toBe("Pão francês");
    expect(items[0].quantity).toBe(10);
    expect(items[0].totalPriceCents).toBe(500);
  });

  it("grand total reflects scanned items with service fee", () => {
    simulateScanConfirm(sampleResult);
    const store = useBillStore.getState();
    // Items total: 2400 + 4500 = 6900
    // Service fee 10%: 690
    // Grand total: 7590
    expect(store.getGrandTotal()).toBe(7590);
  });
});
