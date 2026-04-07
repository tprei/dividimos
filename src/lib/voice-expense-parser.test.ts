import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VoiceExpenseResult, MemberContext } from "./voice-expense-parser";

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
const { parseVoiceExpense } = await import("./voice-expense-parser");

describe("parseVoiceExpense", () => {
  const fakeApiKey = "test-api-key";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses a simple single_amount expense", async () => {
    const geminiResult: VoiceExpenseResult = {
      title: "Uber",
      amountCents: 2500,
      expenseType: "single_amount",
      items: [],
      participants: [
        { spokenName: "João", matchedHandle: null, confidence: "low" },
      ],
      merchantName: null,
    };
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(geminiResult),
    });

    const result = await parseVoiceExpense(
      "Uber com João vinte e cinco reais",
      fakeApiKey,
    );

    expect(result.title).toBe("Uber");
    expect(result.amountCents).toBe(2500);
    expect(result.expenseType).toBe("single_amount");
    expect(result.items).toEqual([]);
    expect(result.participants).toHaveLength(1);
    expect(result.participants[0].spokenName).toBe("João");
  });

  it("passes text to Gemini as user content", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        title: "Test",
        amountCents: 1000,
        expenseType: "single_amount",
        items: [],
        participants: [],
        merchantName: null,
      }),
    });

    await parseVoiceExpense("teste dez reais", fakeApiKey);

    expect(mockGenerateContent).toHaveBeenCalledOnce();
    const callArgs = mockGenerateContent.mock.calls[0][0];
    expect(callArgs.model).toBe("gemini-2.5-flash-lite");
    expect(callArgs.contents[0].parts[0].text).toContain("teste dez reais");
  });

  it("uses structured output with JSON response type", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        title: "Test",
        amountCents: 0,
        expenseType: "single_amount",
        items: [],
        participants: [],
        merchantName: null,
      }),
    });

    await parseVoiceExpense("teste", fakeApiKey);

    const callArgs = mockGenerateContent.mock.calls[0][0];
    expect(callArgs.config.responseMimeType).toBe("application/json");
    expect(callArgs.config.responseSchema).toBeDefined();
    expect(callArgs.config.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(callArgs.config.temperature).toBe(0);
  });

  it("includes member context in system prompt when provided", async () => {
    const members: MemberContext[] = [
      { handle: "joao123", name: "João Silva" },
      { handle: "maria_s", name: "Maria Santos" },
    ];

    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        title: "Pizza",
        amountCents: 6000,
        expenseType: "single_amount",
        items: [],
        participants: [
          { spokenName: "João", matchedHandle: "joao123", confidence: "high" },
        ],
        merchantName: null,
      }),
    });

    const result = await parseVoiceExpense(
      "Pizza com João sessenta reais",
      fakeApiKey,
      members,
    );

    const callArgs = mockGenerateContent.mock.calls[0][0];
    expect(callArgs.config.systemInstruction).toContain("@joao123");
    expect(callArgs.config.systemInstruction).toContain("João Silva");
    expect(callArgs.config.systemInstruction).toContain("@maria_s");
    expect(result.participants[0].matchedHandle).toBe("joao123");
    expect(result.participants[0].confidence).toBe("high");
  });

  it("handles itemized expenses with multiple items", async () => {
    const geminiResult: VoiceExpenseResult = {
      title: "Bar",
      amountCents: 5500,
      expenseType: "itemized",
      items: [
        {
          description: "Cerveja",
          quantity: 2,
          unitPriceCents: 1500,
          totalCents: 3000,
        },
        {
          description: "Pizza",
          quantity: 1,
          unitPriceCents: 2500,
          totalCents: 2500,
        },
      ],
      participants: [],
      merchantName: "Bar do Zé",
    };
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(geminiResult),
    });

    const result = await parseVoiceExpense(
      "2 cervejas a 15 e 1 pizza a 25 no Bar do Zé",
      fakeApiKey,
    );

    expect(result.expenseType).toBe("itemized");
    expect(result.items).toHaveLength(2);
    expect(result.items[0].description).toBe("Cerveja");
    expect(result.items[0].totalCents).toBe(3000);
    expect(result.merchantName).toBe("Bar do Zé");
  });

  it("computes amountCents from items when Gemini returns 0", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        title: "Compras",
        amountCents: 0,
        expenseType: "itemized",
        items: [
          {
            description: "Item A",
            quantity: 1,
            unitPriceCents: 1000,
            totalCents: 1000,
          },
          {
            description: "Item B",
            quantity: 1,
            unitPriceCents: 2000,
            totalCents: 2000,
          },
        ],
        participants: [],
        merchantName: null,
      }),
    });

    const result = await parseVoiceExpense("item A dez e item B vinte", fakeApiKey);

    expect(result.amountCents).toBe(3000);
  });

  it("rounds float cents to integers", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        title: "Test",
        amountCents: 2533.7,
        expenseType: "single_amount",
        items: [],
        participants: [],
        merchantName: null,
      }),
    });

    const result = await parseVoiceExpense("teste", fakeApiKey);

    expect(result.amountCents).toBe(2534);
    expect(Number.isInteger(result.amountCents)).toBe(true);
  });

  it("clamps negative amountCents to 0", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        title: "Test",
        amountCents: -500,
        expenseType: "single_amount",
        items: [],
        participants: [],
        merchantName: null,
      }),
    });

    const result = await parseVoiceExpense("teste", fakeApiKey);

    expect(result.amountCents).toBe(0);
  });

  it("handles missing participants gracefully", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        title: "Mercado",
        amountCents: 12000,
        expenseType: "single_amount",
        items: [],
        participants: null,
        merchantName: null,
      }),
    });

    const result = await parseVoiceExpense("mercado cento e vinte", fakeApiKey);

    expect(result.participants).toEqual([]);
  });

  it("handles missing items gracefully", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        title: "Test",
        amountCents: 1000,
        expenseType: "single_amount",
        items: null,
        participants: [],
        merchantName: null,
      }),
    });

    const result = await parseVoiceExpense("teste dez reais", fakeApiKey);

    expect(result.items).toEqual([]);
  });

  it("trims whitespace from title", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        title: "  Uber  ",
        amountCents: 2500,
        expenseType: "single_amount",
        items: [],
        participants: [],
        merchantName: null,
      }),
    });

    const result = await parseVoiceExpense("uber vinte e cinco", fakeApiKey);

    expect(result.title).toBe("Uber");
  });

  it("throws when Gemini returns empty response", async () => {
    mockGenerateContent.mockResolvedValue({ text: undefined });

    await expect(
      parseVoiceExpense("teste", fakeApiKey),
    ).rejects.toThrow("Gemini returned empty response");
  });

  it("throws when Gemini returns invalid JSON", async () => {
    mockGenerateContent.mockResolvedValue({ text: "not json" });

    await expect(parseVoiceExpense("teste", fakeApiKey)).rejects.toThrow();
  });

  it("propagates Gemini API errors", async () => {
    mockGenerateContent.mockRejectedValue(new Error("API quota exceeded"));

    await expect(
      parseVoiceExpense("teste", fakeApiKey),
    ).rejects.toThrow("API quota exceeded");
  });

  it("includes no-member prompt when members list is empty", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        title: "Test",
        amountCents: 0,
        expenseType: "single_amount",
        items: [],
        participants: [],
        merchantName: null,
      }),
    });

    await parseVoiceExpense("teste", fakeApiKey, []);

    const callArgs = mockGenerateContent.mock.calls[0][0];
    expect(callArgs.config.systemInstruction).toContain(
      "Não há membros conhecidos",
    );
  });

  it("defaults null amountCents to 0", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        title: "Test",
        amountCents: null,
        expenseType: "single_amount",
        items: [],
        participants: [],
        merchantName: null,
      }),
    });

    const result = await parseVoiceExpense("teste", fakeApiKey);

    expect(result.amountCents).toBe(0);
  });

  it("defaults undefined amountCents to 0", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        title: "Test",
        expenseType: "single_amount",
        items: [],
        participants: [],
        merchantName: null,
      }),
    });

    const result = await parseVoiceExpense("teste", fakeApiKey);

    expect(result.amountCents).toBe(0);
  });

  it("defaults null title to empty string", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        title: null,
        amountCents: 1000,
        expenseType: "single_amount",
        items: [],
        participants: [],
        merchantName: null,
      }),
    });

    const result = await parseVoiceExpense("teste", fakeApiKey);

    expect(result.title).toBe("");
  });

  it("defaults undefined title to empty string", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        amountCents: 1000,
        expenseType: "single_amount",
        items: [],
        participants: [],
        merchantName: null,
      }),
    });

    const result = await parseVoiceExpense("teste", fakeApiKey);

    expect(result.title).toBe("");
  });

  it("clamps negative item quantity to 0", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        title: "Test",
        amountCents: 1000,
        expenseType: "itemized",
        items: [
          {
            description: "Item",
            quantity: -3,
            unitPriceCents: 500,
            totalCents: 500,
          },
        ],
        participants: [],
        merchantName: null,
      }),
    });

    const result = await parseVoiceExpense("teste", fakeApiKey);

    expect(result.items[0].quantity).toBe(0);
  });

  it("clamps negative item unitPriceCents to 0", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        title: "Test",
        amountCents: 1000,
        expenseType: "itemized",
        items: [
          {
            description: "Item",
            quantity: 1,
            unitPriceCents: -200,
            totalCents: 500,
          },
        ],
        participants: [],
        merchantName: null,
      }),
    });

    const result = await parseVoiceExpense("teste", fakeApiKey);

    expect(result.items[0].unitPriceCents).toBe(0);
  });

  it("clamps negative item totalCents to 0", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        title: "Test",
        amountCents: 1000,
        expenseType: "itemized",
        items: [
          {
            description: "Item",
            quantity: 1,
            unitPriceCents: 500,
            totalCents: -100,
          },
        ],
        participants: [],
        merchantName: null,
      }),
    });

    const result = await parseVoiceExpense("teste", fakeApiKey);

    expect(result.items[0].totalCents).toBe(0);
  });

  it("does not override amountCents when itemized with non-zero amount", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        title: "Compras",
        amountCents: 5000,
        expenseType: "itemized",
        items: [
          {
            description: "Item A",
            quantity: 1,
            unitPriceCents: 1000,
            totalCents: 1000,
          },
          {
            description: "Item B",
            quantity: 1,
            unitPriceCents: 2000,
            totalCents: 2000,
          },
        ],
        participants: [],
        merchantName: null,
      }),
    });

    const result = await parseVoiceExpense("compras", fakeApiKey);

    expect(result.amountCents).toBe(5000);
  });

  it("uses no-member prompt when members parameter is undefined", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        title: "Test",
        amountCents: 0,
        expenseType: "single_amount",
        items: [],
        participants: [],
        merchantName: null,
      }),
    });

    await parseVoiceExpense("teste", fakeApiKey, undefined);

    const callArgs = mockGenerateContent.mock.calls[0][0];
    expect(callArgs.config.systemInstruction).toContain(
      "Não há membros conhecidos",
    );
  });

  it("marks unmatched participant names with null handle and low confidence", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        title: "Pizza",
        amountCents: 4000,
        expenseType: "single_amount",
        items: [],
        participants: [
          {
            spokenName: "Carlos",
            matchedHandle: null,
            confidence: "low",
          },
        ],
        merchantName: null,
      }),
    });

    const members: MemberContext[] = [
      { handle: "joao123", name: "João Silva" },
    ];

    const result = await parseVoiceExpense("pizza com Carlos", fakeApiKey, members);

    expect(result.participants[0].matchedHandle).toBeNull();
    expect(result.participants[0].confidence).toBe("low");
    expect(result.participants[0].spokenName).toBe("Carlos");
  });

  it("handles duplicate participant names from Gemini", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        title: "Jantar",
        amountCents: 8000,
        expenseType: "single_amount",
        items: [],
        participants: [
          { spokenName: "Maria", matchedHandle: "maria1", confidence: "low" },
          { spokenName: "Maria", matchedHandle: "maria2", confidence: "low" },
        ],
        merchantName: null,
      }),
    });

    const result = await parseVoiceExpense("jantar com Maria e Maria", fakeApiKey);

    expect(result.participants).toHaveLength(2);
    expect(result.participants[0].spokenName).toBe("Maria");
    expect(result.participants[1].spokenName).toBe("Maria");
  });

  it("handles transcript near 2000 character limit", async () => {
    const longText = "pizza ".repeat(333).trim();
    expect(longText.length).toBeLessThanOrEqual(2000);
    expect(longText.length).toBeGreaterThan(1900);

    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        title: "Pizza",
        amountCents: 1000,
        expenseType: "single_amount",
        items: [],
        participants: [],
        merchantName: null,
      }),
    });

    const result = await parseVoiceExpense(longText, fakeApiKey);

    expect(result.title).toBe("Pizza");
    const callArgs = mockGenerateContent.mock.calls[0][0];
    expect(callArgs.contents[0].parts[0].text).toContain(longText);
  });

  it("handles null item fields with nullish coalescing defaults", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        title: "Test",
        amountCents: 1000,
        expenseType: "itemized",
        items: [
          {
            description: "Item",
            quantity: null,
            unitPriceCents: null,
            totalCents: null,
          },
        ],
        participants: [],
        merchantName: null,
      }),
    });

    const result = await parseVoiceExpense("teste", fakeApiKey);

    expect(result.items[0].quantity).toBe(0);
    expect(result.items[0].unitPriceCents).toBe(0);
    expect(result.items[0].totalCents).toBe(0);
  });

  it("rounds item cents to integers", async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        title: "Test",
        amountCents: 3000,
        expenseType: "itemized",
        items: [
          {
            description: "Item",
            quantity: 3,
            unitPriceCents: 999.5,
            totalCents: 2998.5,
          },
        ],
        participants: [],
        merchantName: null,
      }),
    });

    const result = await parseVoiceExpense("teste", fakeApiKey);

    expect(Number.isInteger(result.items[0].unitPriceCents)).toBe(true);
    expect(Number.isInteger(result.items[0].totalCents)).toBe(true);
    expect(result.items[0].unitPriceCents).toBe(1000);
    expect(result.items[0].totalCents).toBe(2999);
  });
});
