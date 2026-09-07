import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: () => mockGetUser(),
      getClaims: async () => {
        const u = await mockGetUser();
        return u?.data?.user
          ? { data: { claims: { sub: u.data.user.id } }, error: null }
          : { data: null, error: null };
      },
    },
  }),
}));

const mockParseChatExpense = vi.fn();
vi.mock("@/lib/chat-expense-parser", () => ({
  parseChatExpense: (...args: unknown[]) => mockParseChatExpense(...args),
}));

const mockEnforceRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: (...args: unknown[]) => mockEnforceRateLimit(...args),
}));

const { POST, runtime, maxDuration } = await import("./route");
const { AppError } = await import("@/lib/errors");

function jsonRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/chat/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function textRequest(text: string) {
  return new Request("http://localhost/api/chat/parse", {
    method: "POST",
    body: text,
  });
}

describe("POST /api/chat/parse", () => {
  const authenticatedUser = { data: { user: { id: "user-123" } } };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue(authenticatedUser);
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    // vi.clearAllMocks() clears call history but not a queued rejection
    // implementation from a prior test — reset the default to success here.
    mockEnforceRateLimit.mockReset();
    mockEnforceRateLimit.mockResolvedValue(undefined);
  });

  // --- Auth ---

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await POST(jsonRequest({ text: "pizza 50 reais" }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Não autenticado");
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
    expect(mockParseChatExpense).not.toHaveBeenCalled();
  });

  // --- GEMINI_API_KEY ---

  it("returns 503 when GEMINI_API_KEY is not set", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");

    const res = await POST(jsonRequest({ text: "pizza 50 reais" }));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("Chat parser nao configurado");
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
  });

  it("returns 503 when GEMINI_API_KEY is whitespace only", async () => {
    vi.stubEnv("GEMINI_API_KEY", "   ");

    const res = await POST(jsonRequest({ text: "pizza 50 reais" }));

    expect(res.status).toBe(503);
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
  });

  it("trims a padded GEMINI_API_KEY before passing it to the parser", async () => {
    vi.stubEnv("GEMINI_API_KEY", "  test-key  ");
    mockParseChatExpense.mockResolvedValue({ title: "Test" });

    await POST(jsonRequest({ text: "pizza" }));

    expect(mockParseChatExpense).toHaveBeenCalledWith("pizza", "test-key", undefined);
  });

  // --- Body parsing ---

  it("returns 400 when body is not valid JSON", async () => {
    const res = await POST(textRequest("not json"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Corpo da requisicao invalido");
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
  });

  // --- Text validation ---

  it("returns 400 when text field is missing", async () => {
    const res = await POST(jsonRequest({}));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Campo 'text' obrigatorio");
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
  });

  it("returns 400 when text is empty string", async () => {
    const res = await POST(jsonRequest({ text: "" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Campo 'text' obrigatorio");
  });

  it("returns 400 when text is whitespace only", async () => {
    const res = await POST(jsonRequest({ text: "   " }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Campo 'text' obrigatorio");
  });

  it("returns 400 when text is not a string", async () => {
    const res = await POST(jsonRequest({ text: 123 }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Campo 'text' obrigatorio");
  });

  it("returns 413 when text exceeds 2000 characters", async () => {
    const res = await POST(jsonRequest({ text: "a".repeat(2001) }));

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toContain("2000");
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
  });

  it("accepts text at exactly 2000 characters", async () => {
    mockParseChatExpense.mockResolvedValue({
      title: "Test",
      amountCents: 100,
      confidence: "high",
    });

    const res = await POST(jsonRequest({ text: "a".repeat(2000) }));

    expect(res.status).toBe(200);
  });

  // --- Members validation ---

  it("returns 400 when members is not an array", async () => {
    const res = await POST(
      jsonRequest({ text: "pizza", members: "not-array" }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Campo 'members' deve ser um array");
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
  });

  it("returns 400 when members exceeds 100 items", async () => {
    const members = Array.from({ length: 101 }, (_, i) => ({
      handle: `user${i}`,
      name: `User ${i}`,
    }));

    const res = await POST(jsonRequest({ text: "pizza", members }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("limite");
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
  });

  it("accepts members at exactly 100 items", async () => {
    mockParseChatExpense.mockResolvedValue({
      title: "Test",
      amountCents: 100,
      confidence: "high",
    });
    const members = Array.from({ length: 100 }, (_, i) => ({
      handle: `user${i}`,
      name: `User ${i}`,
    }));

    const res = await POST(jsonRequest({ text: "pizza", members }));

    expect(res.status).toBe(200);
  });

  it("returns 400 when member handle is not a string", async () => {
    const res = await POST(
      jsonRequest({
        text: "pizza",
        members: [{ handle: 123, name: "Test" }],
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Cada membro deve ter 'handle' e 'name'");
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
  });

  it("returns 400 when member name is not a string", async () => {
    const res = await POST(
      jsonRequest({
        text: "pizza",
        members: [{ handle: "test", name: null }],
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Cada membro deve ter 'handle' e 'name'");
  });

  it("returns 400 (not a TypeError) when a members entry is null", async () => {
    const res = await POST(
      jsonRequest({ text: "pizza", members: [null] }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Cada membro deve ter 'handle' e 'name'");
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
  });

  it("returns 400 when a members entry is a primitive", async () => {
    const res = await POST(
      jsonRequest({ text: "pizza", members: ["not-an-object"] }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Cada membro deve ter 'handle' e 'name'");
  });

  it("returns 400 when member handle exceeds 50 chars", async () => {
    const res = await POST(
      jsonRequest({
        text: "pizza",
        members: [{ handle: "a".repeat(51), name: "Test" }],
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("tamanho");
  });

  it("returns 400 when member name exceeds 100 chars", async () => {
    const res = await POST(
      jsonRequest({
        text: "pizza",
        members: [{ handle: "test", name: "a".repeat(101) }],
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("tamanho");
  });

  it("accepts member with handle at 50 chars and name at 100 chars", async () => {
    mockParseChatExpense.mockResolvedValue({
      title: "Test",
      amountCents: 100,
      confidence: "high",
    });

    const res = await POST(
      jsonRequest({
        text: "pizza",
        members: [{ handle: "a".repeat(50), name: "b".repeat(100) }],
      }),
    );

    expect(res.status).toBe(200);
  });

  // --- Rate limiting ---

  it("calls enforceRateLimit with the chat.parse bucket and the authenticated user id", async () => {
    mockParseChatExpense.mockResolvedValue({ title: "Test" });

    await POST(jsonRequest({ text: "pizza" }));

    expect(mockEnforceRateLimit).toHaveBeenCalledExactlyOnceWith("chat.parse", "user-123");
  });

  it("resolves the limiter before starting the parser call", async () => {
    const order: string[] = [];
    mockEnforceRateLimit.mockImplementation(async () => {
      order.push("limiter");
    });
    mockParseChatExpense.mockImplementation(async () => {
      order.push("parser");
      return { title: "Test" };
    });

    await POST(jsonRequest({ text: "pizza" }));

    expect(order).toEqual(["limiter", "parser"]);
  });

  it("passes a distinct subject per authenticated user id", async () => {
    mockParseChatExpense.mockResolvedValue({ title: "Test" });
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-A" } } });
    await POST(jsonRequest({ text: "pizza" }));
    expect(mockEnforceRateLimit).toHaveBeenLastCalledWith("chat.parse", "user-A");

    mockGetUser.mockResolvedValue({ data: { user: { id: "user-B" } } });
    await POST(jsonRequest({ text: "pizza" }));
    expect(mockEnforceRateLimit).toHaveBeenLastCalledWith("chat.parse", "user-B");
  });

  it("returns 429 and invokes the parser zero times when the limiter is saturated on the first call", async () => {
    mockEnforceRateLimit.mockRejectedValue(
      new AppError("RATE_LIMIT_EXCEEDED", "Muitas requisições. Tente novamente em alguns segundos.", {
        statusCode: 429,
      }),
    );

    const res = await POST(jsonRequest({ text: "pizza" }));

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toEqual({ error: "Muitas requisições. Tente novamente em alguns segundos." });
    expect(mockParseChatExpense).not.toHaveBeenCalled();
  });

  it("simulates 30 admitted requests followed by a 31st rejection with parser count pinned at 30", async () => {
    mockParseChatExpense.mockResolvedValue({ title: "Test" });
    let call = 0;
    mockEnforceRateLimit.mockImplementation(async () => {
      call += 1;
      if (call > 30) {
        throw new AppError("RATE_LIMIT_EXCEEDED", "Muitas requisições. Tente novamente em alguns segundos.", {
          statusCode: 429,
        });
      }
    });

    for (let i = 0; i < 30; i++) {
      const res = await POST(jsonRequest({ text: "pizza" }));
      expect(res.status).toBe(200);
    }
    expect(mockParseChatExpense).toHaveBeenCalledTimes(30);

    const rejected = await POST(jsonRequest({ text: "pizza" }));
    expect(rejected.status).toBe(429);
    expect(mockParseChatExpense).toHaveBeenCalledTimes(30);
  });

  it("returns the exact safe 503 body and invokes the parser zero times when the limiter is unavailable", async () => {
    mockEnforceRateLimit.mockRejectedValue(
      new AppError("RATE_LIMIT_UNAVAILABLE", "Não foi possível verificar o limite de requisições."),
    );

    const res = await POST(jsonRequest({ text: "pizza" }));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: "Serviço temporariamente indisponível" });
    expect(JSON.stringify(body)).not.toContain("verificar o limite");
    expect(mockParseChatExpense).not.toHaveBeenCalled();
  });

  it("returns the exact safe 503 body and invokes the parser zero times on an unknown limiter throw", async () => {
    mockEnforceRateLimit.mockRejectedValue(new Error("unexpected"));

    const res = await POST(jsonRequest({ text: "pizza" }));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: "Serviço temporariamente indisponível" });
    expect(mockParseChatExpense).not.toHaveBeenCalled();
  });

  it("shows exactly one limiter call after an admitted token even when the parser throws", async () => {
    mockParseChatExpense.mockRejectedValue(new Error("Gemini API error"));

    const res = await POST(jsonRequest({ text: "pizza" }));

    expect(res.status).toBe(500);
    expect(mockEnforceRateLimit).toHaveBeenCalledOnce();
    expect(mockParseChatExpense).toHaveBeenCalledOnce();
  });

  it("shows exactly one limiter call after an admitted token even when the parser times out", async () => {
    const err = new Error("timed out");
    err.name = "TimeoutError";
    mockParseChatExpense.mockRejectedValue(err);

    const res = await POST(jsonRequest({ text: "pizza" }));

    expect(res.status).toBe(504);
    expect(mockEnforceRateLimit).toHaveBeenCalledOnce();
    expect(mockParseChatExpense).toHaveBeenCalledOnce();
  });

  // --- Success ---

  it("returns 200 with parsed result on success", async () => {
    const parseResult = {
      title: "Pizza",
      amountCents: 5000,
      expenseType: "single_amount",
      splitType: "equal",
      items: [],
      participants: [
        { spokenName: "João", matchedHandle: "joao", confidence: "high" },
      ],
      payerHandle: "SELF",
      merchantName: null,
      confidence: "high",
    };
    mockParseChatExpense.mockResolvedValue(parseResult);

    const res = await POST(jsonRequest({ text: "pizza 50 reais" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(parseResult);
  });

  it("passes trimmed text and members to parseChatExpense", async () => {
    mockParseChatExpense.mockResolvedValue({ title: "Test" });
    const members = [{ handle: "joao", name: "João" }];

    await POST(jsonRequest({ text: "  pizza 50  ", members }));

    expect(mockParseChatExpense).toHaveBeenCalledWith(
      "pizza 50",
      "test-key",
      members,
    );
  });

  it("passes undefined members when not provided", async () => {
    mockParseChatExpense.mockResolvedValue({ title: "Test" });

    await POST(jsonRequest({ text: "pizza" }));

    expect(mockParseChatExpense).toHaveBeenCalledWith(
      "pizza",
      "test-key",
      undefined,
    );
  });

  // --- Error handling ---

  it("returns 500 when parseChatExpense throws a generic error", async () => {
    mockParseChatExpense.mockRejectedValue(new Error("Gemini API error"));

    const res = await POST(jsonRequest({ text: "pizza" }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Erro ao processar mensagem do chat");
    expect(body.timeout).toBe(false);
  });

  it("returns 504 with timeout flag on TimeoutError", async () => {
    const err = new Error("timed out");
    err.name = "TimeoutError";
    mockParseChatExpense.mockRejectedValue(err);

    const res = await POST(jsonRequest({ text: "pizza" }));

    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.timeout).toBe(true);
    expect(body.error).toContain("Tente novamente");
  });

  it("returns 504 with timeout flag on AbortError", async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    mockParseChatExpense.mockRejectedValue(err);

    const res = await POST(jsonRequest({ text: "pizza" }));

    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.timeout).toBe(true);
  });
});

describe("route segment config", () => {
  it("exports nodejs runtime", () => {
    expect(runtime).toBe("nodejs");
  });

  it("exports maxDuration of 10 seconds", () => {
    expect(maxDuration).toBe(10);
  });
});
