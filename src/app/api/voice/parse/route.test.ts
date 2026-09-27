import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockSupabaseRpc = vi.fn();
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
    rpc: (...args: unknown[]) => mockSupabaseRpc(...args),
  }),
}));

const mockParseVoiceExpense = vi.fn();
vi.mock("@/lib/voice-expense-parser", () => ({
  parseVoiceExpense: (...args: unknown[]) => mockParseVoiceExpense(...args),
}));

const mockEnforceRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: (...args: unknown[]) => mockEnforceRateLimit(...args),
}));

const { POST } = await import("./route");
const { AppError } = await import("@/lib/errors");

function jsonRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/voice/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function textRequest(text: string) {
  return new Request("http://localhost/api/voice/parse", {
    method: "POST",
    body: text,
  });
}

describe("POST /api/voice/parse", () => {
  const authenticatedUser = { data: { user: { id: "user-123" } } };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue(authenticatedUser);
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    // vi.clearAllMocks() clears call history but not a queued rejection
    // implementation from a prior test — reset the default to success here.
    mockEnforceRateLimit.mockReset();
    mockEnforceRateLimit.mockResolvedValue(undefined);
    mockSupabaseRpc.mockReset();
    mockSupabaseRpc.mockResolvedValue({ data: null, error: null });
  });

  // --- Auth ---

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await POST(jsonRequest({ text: "pizza 50 reais" }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Não autenticado");
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
    expect(mockParseVoiceExpense).not.toHaveBeenCalled();
  });

  // --- GEMINI_API_KEY ---

  it("returns 503 when GEMINI_API_KEY is not set", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");

    const res = await POST(jsonRequest({ text: "pizza 50 reais" }));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("Reconhecimento de voz nao configurado");
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
    mockParseVoiceExpense.mockResolvedValue({ title: "Test" });

    await POST(jsonRequest({ text: "pizza" }));

    expect(mockParseVoiceExpense).toHaveBeenCalledWith("pizza", "test-key", undefined);
  });

  // --- Body parsing ---

  it("returns 400 when body is not valid JSON", async () => {
    const res = await POST(textRequest("not json"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Corpo da requisicao invalido");
    expect(mockEnforceRateLimit).toHaveBeenCalledWith("voice.parse", "user-123");
  });

  // --- Text validation ---

  it("returns 400 when text field is missing", async () => {
    const res = await POST(jsonRequest({}));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Campo 'text' obrigatorio");
    expect(mockEnforceRateLimit).toHaveBeenCalledWith("voice.parse", "user-123");
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
    expect(mockEnforceRateLimit).toHaveBeenCalledWith("voice.parse", "user-123");
  });

  it("accepts text at exactly 2000 characters", async () => {
    mockParseVoiceExpense.mockResolvedValue({ title: "Test", totalCents: 100 });

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
    expect(mockEnforceRateLimit).toHaveBeenCalledWith("voice.parse", "user-123");
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
    expect(mockEnforceRateLimit).toHaveBeenCalledWith("voice.parse", "user-123");
  });

  it("accepts members at exactly 100 items", async () => {
    mockParseVoiceExpense.mockResolvedValue({ title: "Test", totalCents: 100 });
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
    expect(mockEnforceRateLimit).toHaveBeenCalledWith("voice.parse", "user-123");
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
    expect(mockEnforceRateLimit).toHaveBeenCalledWith("voice.parse", "user-123");
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
    mockParseVoiceExpense.mockResolvedValue({ title: "Test", totalCents: 100 });

    const res = await POST(
      jsonRequest({
        text: "pizza",
        members: [{ handle: "a".repeat(50), name: "b".repeat(100) }],
      }),
    );

    expect(res.status).toBe(200);
  });

  // --- Rate limiting ---

  it("calls enforceRateLimit with the voice.parse bucket and the authenticated user id", async () => {
    mockParseVoiceExpense.mockResolvedValue({ title: "Test" });

    await POST(jsonRequest({ text: "pizza" }));

    expect(mockEnforceRateLimit).toHaveBeenCalledExactlyOnceWith("voice.parse", "user-123");
  });

  it("resolves the limiter before starting the parser call", async () => {
    const order: string[] = [];
    mockEnforceRateLimit.mockImplementation(async () => {
      order.push("limiter");
    });
    mockParseVoiceExpense.mockImplementation(async () => {
      order.push("parser");
      return { title: "Test" };
    });

    await POST(jsonRequest({ text: "pizza" }));

    expect(order).toEqual(["limiter", "parser"]);
  });

  it("passes a distinct subject per authenticated user id", async () => {
    mockParseVoiceExpense.mockResolvedValue({ title: "Test" });
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-A" } } });
    await POST(jsonRequest({ text: "pizza" }));
    expect(mockEnforceRateLimit).toHaveBeenLastCalledWith("voice.parse", "user-A");

    mockGetUser.mockResolvedValue({ data: { user: { id: "user-B" } } });
    await POST(jsonRequest({ text: "pizza" }));
    expect(mockEnforceRateLimit).toHaveBeenLastCalledWith("voice.parse", "user-B");
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
    expect(mockParseVoiceExpense).not.toHaveBeenCalled();
  });

  it("simulates 30 admitted requests followed by a 31st rejection with parser count pinned at 30", async () => {
    mockParseVoiceExpense.mockResolvedValue({ title: "Test" });
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
    expect(mockParseVoiceExpense).toHaveBeenCalledTimes(30);

    const rejected = await POST(jsonRequest({ text: "pizza" }));
    expect(rejected.status).toBe(429);
    expect(mockParseVoiceExpense).toHaveBeenCalledTimes(30);
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
    expect(mockParseVoiceExpense).not.toHaveBeenCalled();
  });

  it("returns the exact safe 503 body and invokes the parser zero times on an unknown limiter throw", async () => {
    mockEnforceRateLimit.mockRejectedValue(new Error("unexpected"));

    const res = await POST(jsonRequest({ text: "pizza" }));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: "Serviço temporariamente indisponível" });
    expect(mockParseVoiceExpense).not.toHaveBeenCalled();
  });

  it("shows exactly one limiter call after an admitted token even when the parser throws", async () => {
    mockParseVoiceExpense.mockRejectedValue(new Error("Gemini API error"));

    const res = await POST(jsonRequest({ text: "pizza" }));

    expect(res.status).toBe(500);
    expect(mockEnforceRateLimit).toHaveBeenCalledOnce();
    expect(mockParseVoiceExpense).toHaveBeenCalledOnce();
  });

  it("shows exactly one limiter call after an admitted token even when the parser times out", async () => {
    const err = new Error("timed out");
    err.name = "TimeoutError";
    mockParseVoiceExpense.mockRejectedValue(err);

    const res = await POST(jsonRequest({ text: "pizza" }));

    expect(res.status).toBe(504);
    expect(mockEnforceRateLimit).toHaveBeenCalledOnce();
    expect(mockParseVoiceExpense).toHaveBeenCalledOnce();
  });

  // --- Success ---

  it("returns 200 with parsed result on success", async () => {
    const parseResult = {
      title: "Pizza",
      totalCents: 5000,
      participants: ["João"],
    };
    mockParseVoiceExpense.mockResolvedValue(parseResult);

    const res = await POST(jsonRequest({ text: "pizza 50 reais" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(parseResult);
  });

  it("passes trimmed text and members to parseVoiceExpense", async () => {
    mockParseVoiceExpense.mockResolvedValue({ title: "Test" });
    const members = [{ handle: "joao", name: "João" }];

    await POST(jsonRequest({ text: "  pizza 50  ", members }));

    expect(mockParseVoiceExpense).toHaveBeenCalledWith(
      "pizza 50",
      "test-key",
      members,
    );
  });

  it("passes undefined members when not provided", async () => {
    mockParseVoiceExpense.mockResolvedValue({ title: "Test" });

    await POST(jsonRequest({ text: "pizza" }));

    expect(mockParseVoiceExpense).toHaveBeenCalledWith(
      "pizza",
      "test-key",
      undefined,
    );
  });

  // --- Error handling ---

  it("returns 500 when parseVoiceExpense throws a generic error", async () => {
    mockParseVoiceExpense.mockRejectedValue(new Error("Gemini API error"));

    const res = await POST(jsonRequest({ text: "pizza" }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("LLM_INTERNAL");
    expect(body.retryable).toBe(false);
    expect(body.timeout).toBe(false);
  });

  it("returns 504 with timeout flag on TimeoutError", async () => {
    const err = new Error("timed out");
    err.name = "TimeoutError";
    mockParseVoiceExpense.mockRejectedValue(err);

    const res = await POST(jsonRequest({ text: "pizza" }));

    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.timeout).toBe(true);
    expect(body.code).toBe("LLM_TIMEOUT");
    expect(body.retryable).toBe(true);
  });

  it("returns 504 with timeout flag on AbortError", async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    mockParseVoiceExpense.mockRejectedValue(err);

    const res = await POST(jsonRequest({ text: "pizza" }));

    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.timeout).toBe(true);
  });

  it("does not call the provider without current AI consent", async () => {
    mockSupabaseRpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "ai_consent_required" },
    });

    const res = await POST(jsonRequest({ text: "pizza 50 reais" }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Para usar IA, permita o envio dos dados. Você pode continuar sem IA.",
      code: "ai_consent_required",
    });
    expect(mockParseVoiceExpense).not.toHaveBeenCalled();
  });

  it("fails closed when the consent RPC reports an unexpected SQL error", async () => {
    mockSupabaseRpc.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: "boom" },
    });

    const res = await POST(jsonRequest({ text: "pizza 50 reais" }));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "Não foi possível verificar sua permissão de IA. Tente novamente.",
      code: "ai_consent_unavailable",
    });
    expect(mockParseVoiceExpense).not.toHaveBeenCalled();
  });

  it("fails closed when the consent RPC transport throws", async () => {
    mockSupabaseRpc.mockRejectedValue(new TypeError("fetch failed"));

    const res = await POST(jsonRequest({ text: "pizza 50 reais" }));

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "Não foi possível verificar sua permissão de IA. Tente novamente.",
      code: "ai_consent_unavailable",
    });
    expect(mockParseVoiceExpense).not.toHaveBeenCalled();
  });

  it("waits for consent and rate limiting before calling the provider", async () => {
    const order: string[] = [];
    const consentGate = Promise.withResolvers<void>();
    const limiterGate = Promise.withResolvers<void>();
    mockSupabaseRpc.mockImplementation(async () => {
      await consentGate.promise;
      order.push("consent");
      return { data: null, error: null };
    });
    mockEnforceRateLimit.mockImplementation(async () => {
      await limiterGate.promise;
      order.push("limiter");
    });
    mockParseVoiceExpense.mockImplementation(async () => {
      order.push("provider");
      return { title: "Pizza", totalCents: 5000, participants: ["João"] };
    });

    const pending = POST(jsonRequest({ text: "pizza 50 reais" }));

    await macrotaskFlush();
    expect(order).not.toContain("provider");

    consentGate.resolve();
    await macrotaskFlush();
    expect(order).not.toContain("provider");

    limiterGate.resolve();
    const res = await pending;

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ title: "Pizza", totalCents: 5000, participants: ["João"] });
    expect(order).toEqual(["consent", "limiter", "provider"]);
  });

  it("allows the existing happy path with current consent", async () => {
    mockParseVoiceExpense.mockResolvedValue({ title: "Pizza", totalCents: 5000, participants: ["João"] });

    const res = await POST(jsonRequest({ text: "pizza 50 reais" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ title: "Pizza", totalCents: 5000, participants: ["João"] });
    expect(mockSupabaseRpc).toHaveBeenCalledWith("require_ai_consent", { p_version: 1 });
    expect(mockParseVoiceExpense).toHaveBeenCalledOnce();
  });

  it("does not query consent or call the provider when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(jsonRequest({ text: "pizza 50 reais" }));

    expect(res.status).toBe(401);
    expect(mockSupabaseRpc).not.toHaveBeenCalled();
    expect(mockParseVoiceExpense).not.toHaveBeenCalled();
  });

  it("enforces consent even when the limiter bypass is active", async () => {
    const actualLimiter = (await vi.importActual("@/lib/rate-limit")) as {
      enforceRateLimit: (bucket: string, subject: string) => Promise<void>;
    };
    mockEnforceRateLimit.mockImplementation(actualLimiter.enforceRateLimit);
    vi.stubEnv("RATE_LIMIT_DISABLED", "1");
    mockSupabaseRpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "ai_consent_required" },
    });

    const res = await POST(jsonRequest({ text: "pizza 50 reais" }));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "ai_consent_required" });
    expect(mockParseVoiceExpense).not.toHaveBeenCalled();
  });

  it("returns 429 with zero provider calls when the limiter rejects while consent is still pending", async () => {
    const consentGate = Promise.withResolvers<void>();
    mockSupabaseRpc.mockImplementation(async () => {
      await consentGate.promise;
      return { data: null, error: null };
    });
    mockEnforceRateLimit.mockRejectedValue(
      new AppError("RATE_LIMIT_EXCEEDED", "too many", { statusCode: 429 }),
    );

    const res = await POST(jsonRequest({ text: "pizza 50 reais" }));

    expect(res.status).toBe(429);
    expect(mockParseVoiceExpense).not.toHaveBeenCalled();
  });
});

function macrotaskFlush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
