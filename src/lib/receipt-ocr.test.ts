import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReceiptOcrResult } from "./receipt-ocr";
import {
  computeExpenseLineTotalCents,
  parseExpenseQuantity,
} from "./expense-quantity";
import { brandExpenseCents } from "./expense-money";

// Mock the @google/genai module
const mockGenerateContent = vi.fn();
vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: class {
      models = { generateContent: mockGenerateContent };
    },
  };
});

// Import after mocking
const { parseReceiptImage } = await import("./receipt-ocr");

describe("parseReceiptImage", () => {
  const fakeBase64 = "aW1hZ2VkYXRh";
  const fakeMimeType = "image/jpeg";
  const fakeApiKey = "test-api-key";

  const validResult: ReceiptOcrResult = {
    merchant: "Restaurante Bom Sabor",
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
        unitPriceCents: 5800,
        totalCents: 5800,
      },
    ],
    serviceFeeBasisPoints: 1000,
    fixedFeesCents: 0,
    totalCents: 9020,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns structured receipt data from Gemini response", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(validResult),
    });

    const result = await parseReceiptImage(fakeBase64, fakeMimeType, fakeApiKey);

    expect(result).toEqual(validResult);
  });

  it("preserves fixed fees reported separately from the service percentage", async () => {
    const receiptWithFixedFee = {
      ...validResult,
      serviceFeeBasisPoints: 0,
      fixedFeesCents: 1000,
      totalCents: 9000,
    };
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(receiptWithFixedFee),
    });

    const result = await parseReceiptImage(fakeBase64, fakeMimeType, fakeApiKey);

    expect(result.fixedFeesCents).toBe(1000);
    expect(result.totalCents).toBe(9000);
  });

  it("passes the image as inline data to Gemini", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(validResult),
    });

    await parseReceiptImage(fakeBase64, fakeMimeType, fakeApiKey);

    expect(mockGenerateContent).toHaveBeenCalledOnce();
    const callArgs = mockGenerateContent.mock.calls[0][0];
    expect(callArgs.model).toBe("gemini-2.5-flash-lite");
    const parts = callArgs.contents[0].parts;
    expect(parts[0].inlineData).toEqual({
      mimeType: fakeMimeType,
      data: fakeBase64,
    });
  });

  it("uses structured output with JSON response type", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(validResult),
    });

    await parseReceiptImage(fakeBase64, fakeMimeType, fakeApiKey);

    const callArgs = mockGenerateContent.mock.calls[0][0];
    expect(callArgs.config.responseMimeType).toBe("application/json");
    expect(callArgs.config.responseSchema).toBeDefined();
    expect(callArgs.config.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(callArgs.config.temperature).toBe(0);
  });

  it("keeps the printed line total and derives the unit price when the printed unit price is not usable", async () => {
    const resultWithFloats = {
      merchant: "Test",
      items: [
        {
          description: "Item A",
          quantity: 1,
          unitPriceCents: 1250.7,
          totalCents: 1251,
        },
      ],
      serviceFeeBasisPoints: 1000,
      totalCents: 1376,
    };
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(resultWithFloats),
    });

    const result = await parseReceiptImage(fakeBase64, fakeMimeType, fakeApiKey);

    expect(result.totalCents).toBe(1376);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      description: "Item A",
      quantity: 1,
      unitPriceCents: 1251,
      totalCents: 1251,
    });
  });

  it("drops an item with zero/negative quantity instead of clamping it", async () => {
    const resultWithZeroQty = {
      merchant: "Test",
      items: [
        {
          description: "Item A",
          quantity: 0,
          unitPriceCents: 1000,
          totalCents: 1000,
        },
      ],
      serviceFeeBasisPoints: 0,
      totalCents: 1000,
    };
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(resultWithZeroQty),
    });

    const result = await parseReceiptImage(fakeBase64, fakeMimeType, fakeApiKey);

    expect(result.items).toHaveLength(0);
  });

  it("derives the unit price from quantity and printed line total when the receipt prints no unit price", async () => {
    const resultMissingUnit = {
      merchant: "Test",
      items: [{ description: "Item A", quantity: 2, totalCents: 2000 }],
      serviceFeeBasisPoints: 0,
      totalCents: 2000,
    };
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(resultMissingUnit),
    });

    const result = await parseReceiptImage(fakeBase64, fakeMimeType, fakeApiKey);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      description: "Item A",
      quantity: 2,
      unitPriceCents: 1000,
      totalCents: 2000,
    });
  });

  it("keeps the printed line total when quantity × unit price disagrees with it", async () => {
    const picanhaResult = {
      merchant: "Churrascaria",
      items: [
        {
          description: "Picanha",
          quantity: 0.532,
          unitPriceCents: 3990,
          totalCents: 2122,
        },
      ],
      serviceFeeBasisPoints: 0,
      totalCents: 2122,
    };
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(picanhaResult),
    });

    const result = await parseReceiptImage(fakeBase64, fakeMimeType, fakeApiKey);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].description).toBe("Picanha");
    expect(result.items[0].quantity).toBe(0.532);
    expect(result.items[0].totalCents).toBe(2122);

    const qty = parseExpenseQuantity(0.532);
    expect(qty.ok).toBe(true);
    if (!qty.ok) return;

    const lineTotal = computeExpenseLineTotalCents(
      qty.value,
      brandExpenseCents(result.items[0].unitPriceCents),
    );
    expect(lineTotal.ok).toBe(true);
    if (!lineTotal.ok) return;
    expect(lineTotal.value).toBe(2122);
  });

  it("falls back to a single unit at the printed total when no unit price can reproduce it", async () => {
    const resultUnreproducible = {
      merchant: "Test",
      items: [
        {
          description: "Água",
          quantity: 3000,
          unitPriceCents: 1,
          totalCents: 1,
        },
      ],
      serviceFeeBasisPoints: 0,
      totalCents: 1,
    };
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(resultUnreproducible),
    });

    const result = await parseReceiptImage(fakeBase64, fakeMimeType, fakeApiKey);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      description: "Água",
      quantity: 1,
      unitPriceCents: 1,
      totalCents: 1,
    });
  });

  it("throws when Gemini returns empty response", async () => {
    mockGenerateContent.mockResolvedValue({ text: undefined });

    await expect(
      parseReceiptImage(fakeBase64, fakeMimeType, fakeApiKey),
    ).rejects.toThrow("Gemini returned empty response");
  });

  it("throws when Gemini returns invalid JSON", async () => {
    mockGenerateContent.mockResolvedValue({ text: "not json" });

    await expect(
      parseReceiptImage(fakeBase64, fakeMimeType, fakeApiKey),
    ).rejects.toThrow();
  });

  it("propagates Gemini API errors", async () => {
    mockGenerateContent.mockRejectedValue(new Error("API quota exceeded"));

    await expect(
      parseReceiptImage(fakeBase64, fakeMimeType, fakeApiKey),
    ).rejects.toThrow("API quota exceeded");
  });

  it("handles receipt with no service fee", async () => {
    const noFeeResult = {
      merchant: "Lanchonete",
      items: [
        {
          description: "Hamburguer",
          quantity: 1,
          unitPriceCents: 2500,
          totalCents: 2500,
        },
      ],
      serviceFeeBasisPoints: 0,
      totalCents: 2500,
    };
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(noFeeResult),
    });

    const result = await parseReceiptImage(fakeBase64, fakeMimeType, fakeApiKey);

    expect(result.serviceFeeBasisPoints).toBe(0);
    expect(result.fixedFeesCents).toBe(0);
  });

  it("handles receipt with null merchant", async () => {
    const nullMerchantResult = {
      merchant: null,
      items: [{ description: "Item", quantity: 1, unitPriceCents: 1000, totalCents: 1000 }],
      serviceFeeBasisPoints: 0,
      totalCents: 1000,
    };
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(nullMerchantResult),
    });

    const result = await parseReceiptImage(fakeBase64, fakeMimeType, fakeApiKey);

    expect(result.merchant).toBeNull();
  });
});
