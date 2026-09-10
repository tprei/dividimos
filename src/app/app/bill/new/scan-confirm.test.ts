import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userAlice } from "@/test/fixtures";
import { useBillStore } from "@/stores/bill-store";
import type { ItemDivisionValue } from "@/lib/item-division";
import type { ReceiptOcrResult } from "@/lib/receipt-ocr";


function simulateScanConfirm(
  result: ReceiptOcrResult,
  receiptAccessKey: string | null = null,
  divisions: Record<number, ItemDivisionValue> = {},
  occurredOn = "2026-09-10",
) {
  const store = useBillStore.getState();
  store.setCurrentUser(userAlice);
  store.createExpense(
    result.merchant || "Nota escaneada",
    "itemized",
    result.merchant || undefined,
  );
  store.setReceiptAccessKey(receiptAccessKey);
  store.updateExpense({
    serviceFeePercent: result.serviceFeeBasisPoints / 100,
    serviceFeeBasisPoints: result.serviceFeeBasisPoints,
    fixedFees: result.fixedFeesCents,
  });

  for (const item of result.items) {
    store.addItem({
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      totalPriceCents: item.totalCents,
    });
  }

  const addedItems = useBillStore.getState().items;
  for (const [indexText, division] of Object.entries(divisions)) {
    const item = addedItems[Number(indexText)];
    if (item) store.setItemDivision(item.id, division);
  }
  store.setOccurredOn(occurredOn);
}

const sampleResult: ReceiptOcrResult = {
  merchant: "Bar do Zé",
  items: [
    {
      description: "Cerveja Brahma 600ml",
      quantity: 2000,
      unitPriceCents: 1200,
      totalCents: 2400,
    },
    {
      description: "Picanha 400g",
      quantity: 1000,
      unitPriceCents: 4500,
      totalCents: 4500,
    },
  ],
  serviceFeeBasisPoints: 1000,
  fixedFeesCents: 0,
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
  it("keeps the scanned receipt key with the draft", () => {
    const receiptAccessKey = "12345678901234567890123456789012345678901234";
    simulateScanConfirm(sampleResult, receiptAccessKey);
    expect(useBillStore.getState().receiptAccessKey).toBe(receiptAccessKey);
  });

  it("populates all scanned items in the store", () => {
    simulateScanConfirm(sampleResult);
    const { items } = useBillStore.getState();
    expect(items).toHaveLength(2);
    expect(items[0].description).toBe("Cerveja Brahma 600ml");
    expect(items[0].quantity).toBe(2000);
    expect(items[0].unitPriceCents).toBe(1200);
    expect(items[0].totalPriceCents).toBe(2400);
    expect(items[1].description).toBe("Picanha 400g");
    expect(items[1].quantity).toBe(1000);
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
      serviceFeeBasisPoints: 0,
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
          quantity: 10000,
          unitPriceCents: 50,
          totalCents: 500,
        },
      ],
      serviceFeeBasisPoints: 0,
      fixedFeesCents: 0,
      totalCents: 500,
    });
    const { items } = useBillStore.getState();
    expect(items).toHaveLength(1);
    expect(items[0].description).toBe("Pão francês");
    expect(items[0].quantity).toBe(10000);
    expect(items[0].totalPriceCents).toBe(500);
  });

  it("grand total reflects scanned items with service fee", () => {
    simulateScanConfirm(sampleResult);
    const store = useBillStore.getState();
    expect(store.getGrandTotal()).toBe(7590);
  });
  it("applies divisions to items in scan order and preserves the date", () => {
    const divisions: Record<number, ItemDivisionValue> = {
      0: {
        mode: "equal",
        shares: [{ participantId: userAlice.id, cents: 2400 }],
      },
      1: {
        mode: "fixed",
        shares: [{ participantId: userAlice.id, cents: 4500 }],
      },
    };

    simulateScanConfirm(sampleResult, null, divisions, "2026-09-09");

    const store = useBillStore.getState();
    expect(store.occurredOn).toBe("2026-09-09");
    expect(store.splits).toHaveLength(2);
    expect(store.splits.map((split) => [split.itemId, split.computedAmountCents])).toEqual([
      [store.items[0].id, 2400],
      [store.items[1].id, 4500],
    ]);
  });
});
