import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReceiptOcrResult } from "./receipt-ocr";

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
    serviceFeePercent: 10,
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

  it("rounds float cents to integers", async () => {
    const resultWithFloats = {
      merchant: "Test",
      items: [
        {
          description: "Item A",
          quantity: 1,
          unitPriceCents: 1250.7,
          totalCents: 1250.3,
        },
      ],
      serviceFeePercent: 10,
      totalCents: 1375.8,
    };
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(resultWithFloats),
    });

    const result = await parseReceiptImage(fakeBase64, fakeMimeType, fakeApiKey);

    expect(result.totalCents).toBe(1376);
    // qty=1: sanitizer rounds to 1250, then absorb adds 1 centavo
    // to close the gap (receipt 1376 vs items 1250 + fee 125 = 1375)
    expect(result.items[0].unitPriceCents).toBe(1251);
    expect(result.items[0].totalCents).toBe(1251);
  });

  it("clamps negative/zero quantity to 0.001", async () => {
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
      serviceFeePercent: 0,
      totalCents: 1000,
    };
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(resultWithZeroQty),
    });

    const result = await parseReceiptImage(fakeBase64, fakeMimeType, fakeApiKey);

    expect(result.items[0].quantity).toBe(0.001);
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
    const noFeeResult: ReceiptOcrResult = {
      merchant: "Lanchonete",
      items: [
        {
          description: "Hamburguer",
          quantity: 1,
          unitPriceCents: 2500,
          totalCents: 2500,
        },
      ],
      serviceFeePercent: 0,
      totalCents: 2500,
    };
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(noFeeResult),
    });

    const result = await parseReceiptImage(fakeBase64, fakeMimeType, fakeApiKey);

    expect(result.serviceFeePercent).toBe(0);
  });

  it("handles receipt with null merchant", async () => {
    const nullMerchantResult: ReceiptOcrResult = {
      merchant: null,
      items: [
        {
          description: "Item",
          quantity: 1,
          unitPriceCents: 1000,
          totalCents: 1000,
        },
      ],
      serviceFeePercent: 0,
      totalCents: 1000,
    };
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(nullMerchantResult),
    });

    const result = await parseReceiptImage(fakeBase64, fakeMimeType, fakeApiKey);

    expect(result.merchant).toBeNull();
  });
});
