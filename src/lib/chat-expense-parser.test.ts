import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  ChatExpenseResult,
  ChatParticipantMatch,
} from "./chat-expense-parser";
import type { MemberContext } from "./voice-expense-parser";

const mockGenerateContent = vi.fn();
vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: class {
      models = { generateContent: mockGenerateContent };
    },
  };
});

const { parseChatExpense, sanitizeChatResult } = await import(
  "./chat-expense-parser"
);

function makeResult(overrides: Partial<ChatExpenseResult> = {}): ChatExpenseResult {
  return {
    title: "Uber",
    amountCents: 2500,
    expenseType: "single_amount",
    splitType: "equal",
    items: [],
    participants: [],
    payerHandle: null,
    merchantName: null,
    confidence: "high",
    ...overrides,
  };
}

function mockGemini(result: Partial<ChatExpenseResult>) {
  mockGenerateContent.mockResolvedValue({
    text: JSON.stringify(makeResult(result)),
  });
}

describe("parseChatExpense", () => {
  const fakeApiKey = "test-api-key";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses a simple single_amount expense", async () => {
    mockGemini({
      title: "Uber",
      amountCents: 2500,
      payerHandle: "SELF",
      confidence: "high",
    });

    const result = await parseChatExpense(
      "pegamos uber 25 reais eu paguei",
      fakeApiKey,
    );

    expect(result.title).toBe("Uber");
    expect(result.amountCents).toBe(2500);
    expect(result.expenseType).toBe("single_amount");
    expect(result.payerHandle).toBe("SELF");
    expect(result.confidence).toBe("high");
  });

  it("passes text to Gemini as user content", async () => {
    mockGemini({});

    await parseChatExpense("pizza 60 conto", fakeApiKey);

    expect(mockGenerateContent).toHaveBeenCalledOnce();
    const callArgs = mockGenerateContent.mock.calls[0][0];
    expect(callArgs.model).toBe("gemini-2.5-flash-lite");
    expect(callArgs.contents[0].parts[0].text).toContain("pizza 60 conto");
  });

  it("uses structured JSON output config", async () => {
    mockGemini({});

    await parseChatExpense("teste", fakeApiKey);

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

    mockGemini({
      title: "Pizza",
      amountCents: 6000,
      participants: [
        { spokenName: "João", matchedHandle: "joao123", confidence: "high" },
      ],
    });

    const result = await parseChatExpense(
      "pizza com João 60 reais",
      fakeApiKey,
      members,
    );

    const callArgs = mockGenerateContent.mock.calls[0][0];
    expect(callArgs.config.systemInstruction).toContain("@joao123");
    expect(callArgs.config.systemInstruction).toContain("João Silva");
    expect(callArgs.config.systemInstruction).toContain("@maria_s");
    expect(result.participants[0].matchedHandle).toBe("joao123");
  });

  it("uses no-member prompt when members is empty", async () => {
    mockGemini({});

    await parseChatExpense("teste", fakeApiKey, []);

    const callArgs = mockGenerateContent.mock.calls[0][0];
    expect(callArgs.config.systemInstruction).toContain(
      "Não há membros conhecidos",
    );
  });

  it("uses no-member prompt when members is undefined", async () => {
    mockGemini({});

    await parseChatExpense("teste", fakeApiKey, undefined);

    const callArgs = mockGenerateContent.mock.calls[0][0];
    expect(callArgs.config.systemInstruction).toContain(
      "Não há membros conhecidos",
    );
  });

  it("handles itemized expenses with multiple items", async () => {
    mockGemini({
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
          description: "Batata",
          quantity: 1,
          unitPriceCents: 2500,
          totalCents: 2500,
        },
      ],
      merchantName: "Bar do Zé",
    });

    const result = await parseChatExpense(
      "2 cervejas 15 e 1 batata 25 no bar do ze",
      fakeApiKey,
    );

    expect(result.expenseType).toBe("itemized");
    expect(result.items).toHaveLength(2);
    expect(result.items[0].description).toBe("Cerveja");
    expect(result.merchantName).toBe("Bar do Zé");
  });

  it("returns payerHandle from Gemini response", async () => {
    const members: MemberContext[] = [
      { handle: "joao123", name: "João Silva" },
    ];
    mockGemini({ payerHandle: "joao123" });

    const result = await parseChatExpense(
      "pizza joão pagou",
      fakeApiKey,
      members,
    );

    expect(result.payerHandle).toBe("joao123");
  });

  it("returns splitType from Gemini response", async () => {
    mockGemini({ splitType: "custom" });

    const result = await parseChatExpense(
      "eu paguei 60 e ela 40",
      fakeApiKey,
    );

    expect(result.splitType).toBe("custom");
  });

  it("returns confidence level from Gemini response", async () => {
    mockGemini({ title: "Almoço", amountCents: 0, confidence: "low" });

    const result = await parseChatExpense("almoco", fakeApiKey);

    expect(result.confidence).toBe("low");
    expect(result.amountCents).toBe(0);
  });

  it("throws when Gemini returns empty response", async () => {
    mockGenerateContent.mockResolvedValue({ text: undefined });

    await expect(parseChatExpense("teste", fakeApiKey)).rejects.toThrow(
      "Gemini returned empty response",
    );
  });

  it("throws when Gemini returns invalid JSON", async () => {
    mockGenerateContent.mockResolvedValue({ text: "not json" });

    await expect(parseChatExpense("teste", fakeApiKey)).rejects.toThrow();
  });

  it("propagates Gemini API errors", async () => {
    mockGenerateContent.mockRejectedValue(new Error("API quota exceeded"));

    await expect(parseChatExpense("teste", fakeApiKey)).rejects.toThrow(
      "API quota exceeded",
    );
  });
});

describe("sanitizeChatResult", () => {
  it("rounds float cents to integers", () => {
    const result = sanitizeChatResult(
      makeResult({ amountCents: 2533.7 }) as ChatExpenseResult,
    );

    expect(result.amountCents).toBe(2534);
    expect(Number.isInteger(result.amountCents)).toBe(true);
  });

  it("clamps negative amountCents to 0", () => {
    const result = sanitizeChatResult(
      makeResult({ amountCents: -500 }) as ChatExpenseResult,
    );

    expect(result.amountCents).toBe(0);
  });

  it("defaults null amountCents to 0", () => {
    const result = sanitizeChatResult(
      makeResult({ amountCents: null as unknown as number }) as ChatExpenseResult,
    );

    expect(result.amountCents).toBe(0);
  });

  it("defaults undefined amountCents to 0", () => {
    const raw = makeResult();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (raw as any).amountCents;
    const result = sanitizeChatResult(raw);

    expect(result.amountCents).toBe(0);
  });

  it("trims whitespace from title", () => {
    const result = sanitizeChatResult(
      makeResult({ title: "  Uber  " }) as ChatExpenseResult,
    );

    expect(result.title).toBe("Uber");
  });

  it("defaults null title to empty string", () => {
    const result = sanitizeChatResult(
      makeResult({ title: null as unknown as string }) as ChatExpenseResult,
    );

    expect(result.title).toBe("");
  });

  it("defaults null participants to empty array", () => {
    const result = sanitizeChatResult(
      makeResult({
        participants: null as unknown as ChatParticipantMatch[],
      }) as ChatExpenseResult,
    );

    expect(result.participants).toEqual([]);
  });

  it("defaults null items to empty array", () => {
    const result = sanitizeChatResult(
      makeResult({
        items: null as unknown as ChatExpenseResult["items"],
      }) as ChatExpenseResult,
    );

    expect(result.items).toEqual([]);
  });

  it("defaults null payerHandle to null", () => {
    const result = sanitizeChatResult(makeResult({ payerHandle: null }));

    expect(result.payerHandle).toBeNull();
  });

  it("defaults null confidence to low", () => {
    const result = sanitizeChatResult(
      makeResult({
        confidence: null as unknown as ChatExpenseResult["confidence"],
      }) as ChatExpenseResult,
    );

    expect(result.confidence).toBe("low");
  });

  it("defaults null splitType to equal", () => {
    const result = sanitizeChatResult(
      makeResult({
        splitType: null as unknown as ChatExpenseResult["splitType"],
      }) as ChatExpenseResult,
    );

    expect(result.splitType).toBe("equal");
  });

  it("computes amountCents from items when Gemini returns 0", () => {
    const result = sanitizeChatResult(
      makeResult({
        amountCents: 0,
        expenseType: "itemized",
        items: [
          { description: "A", quantity: 1, unitPriceCents: 1000, totalCents: 1000 },
          { description: "B", quantity: 1, unitPriceCents: 2000, totalCents: 2000 },
        ],
      }),
    );

    expect(result.amountCents).toBe(3000);
  });

  it("does not override amountCents when itemized with non-zero amount", () => {
    const result = sanitizeChatResult(
      makeResult({
        amountCents: 5000,
        expenseType: "itemized",
        items: [
          { description: "A", quantity: 1, unitPriceCents: 1000, totalCents: 1000 },
        ],
      }),
    );

    expect(result.amountCents).toBe(5000);
  });

  it("clamps negative item values to 0", () => {
    const result = sanitizeChatResult(
      makeResult({
        expenseType: "itemized",
        items: [
          {
            description: "Item",
            quantity: -3,
            unitPriceCents: -200,
            totalCents: -100,
          },
        ],
      }),
    );

    expect(result.items[0].quantity).toBe(0);
    expect(result.items[0].unitPriceCents).toBe(0);
    expect(result.items[0].totalCents).toBe(0);
  });

  it("rounds item cents to integers", () => {
    const result = sanitizeChatResult(
      makeResult({
        expenseType: "itemized",
        items: [
          {
            description: "Item",
            quantity: 3,
            unitPriceCents: 999.5,
            totalCents: 2998.5,
          },
        ],
      }),
    );

    expect(Number.isInteger(result.items[0].unitPriceCents)).toBe(true);
    expect(Number.isInteger(result.items[0].totalCents)).toBe(true);
    expect(result.items[0].unitPriceCents).toBe(1000);
    expect(result.items[0].totalCents).toBe(2999);
  });

  it("handles null item fields with defaults", () => {
    const result = sanitizeChatResult(
      makeResult({
        expenseType: "itemized",
        items: [
          {
            description: "Item",
            quantity: null as unknown as number,
            unitPriceCents: null as unknown as number,
            totalCents: null as unknown as number,
          },
        ],
      }),
    );

    expect(result.items[0].quantity).toBe(0);
    expect(result.items[0].unitPriceCents).toBe(0);
    expect(result.items[0].totalCents).toBe(0);
  });
});
