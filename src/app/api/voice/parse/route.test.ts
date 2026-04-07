import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
  }),
}));

const mockParseVoiceExpense = vi.fn();
vi.mock("@/lib/voice-expense-parser", () => ({
  parseVoiceExpense: (...args: unknown[]) => mockParseVoiceExpense(...args),
}));

const { POST, runtime, maxDuration } = await import("./route");

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
  });

  // --- Auth ---

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await POST(jsonRequest({ text: "pizza 50 reais" }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Nao autenticado");
  });

  // --- GEMINI_API_KEY ---

  it("returns 503 when GEMINI_API_KEY is not set", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");

    const res = await POST(jsonRequest({ text: "pizza 50 reais" }));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("Reconhecimento de voz nao configurado");
  });

  // --- Body parsing ---

  it("returns 400 when body is not valid JSON", async () => {
    const res = await POST(textRequest("not json"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Corpo da requisicao invalido");
  });

  // --- Text validation ---

  it("returns 400 when text field is missing", async () => {
    const res = await POST(jsonRequest({}));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Campo 'text' obrigatorio");
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
    expect(body.error).toBe("Erro ao processar comando de voz");
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
    expect(body.error).toContain("Tente novamente");
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
});

describe("route segment config", () => {
  it("exports nodejs runtime", () => {
    expect(runtime).toBe("nodejs");
  });

  it("exports maxDuration of 10 seconds", () => {
    expect(maxDuration).toBe(10);
  });
});
