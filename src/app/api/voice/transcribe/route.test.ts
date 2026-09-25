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

const mockTranscribeVoiceAudio = vi.fn();
vi.mock("@/lib/voice-transcription", () => ({
  transcribeVoiceAudio: (...args: unknown[]) => mockTranscribeVoiceAudio(...args),
}));

const mockEnforceRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: (...args: unknown[]) => mockEnforceRateLimit(...args),
}));

const { POST, runtime, maxDuration } = await import("./route");
const { AppError } = await import("@/lib/errors");

function audioRequest(options?: {
  type?: string;
  bytes?: number;
  /** Declared body length; `null` sends no content-length header. */
  contentLength?: string | null;
}): Request {
  const bytes = options?.bytes ?? 16;
  const form = new FormData();
  form.append(
    "audio",
    new File([new Uint8Array(bytes)], "clip", {
      type: options?.type ?? "audio/mp4",
    }),
  );
  const request = new Request("http://localhost/api/voice/transcribe", {
    method: "POST",
    body: form,
  });
  const declared = options?.contentLength ?? String(bytes);
  // happy-dom drops content-length given in the init headers; real clients
  // always send it, so set it the way a browser would.
  if (options?.contentLength !== null) request.headers.set("content-length", declared);
  return request;
}

function emptyFormRequest(): Request {
  const request = new Request("http://localhost/api/voice/transcribe", {
    method: "POST",
    body: new FormData(),
  });
  request.headers.set("content-length", "96");
  return request;
}

function jsonRequest(body: string): Request {
  const request = new Request("http://localhost/api/voice/transcribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  request.headers.set("content-length", String(body.length));
  return request;
}

describe("POST /api/voice/transcribe", () => {
  const authenticatedUser = { data: { user: { id: "user-123" } } };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue(authenticatedUser);
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    // vi.clearAllMocks() clears call history but not a queued rejection
    // implementation from a prior test — reset the default to success here.
    mockEnforceRateLimit.mockReset();
    mockEnforceRateLimit.mockResolvedValue(undefined);
    mockTranscribeVoiceAudio.mockReset();
    mockTranscribeVoiceAudio.mockResolvedValue("Uber com João 25 reais");
  });

  // --- Auth ---

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await POST(audioRequest());

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Não autenticado");
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
    expect(mockTranscribeVoiceAudio).not.toHaveBeenCalled();
  });

  // --- GEMINI_API_KEY ---

  it("returns 503 when GEMINI_API_KEY is not set", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");

    const res = await POST(audioRequest());

    expect(res.status).toBe(503);
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
    expect(mockTranscribeVoiceAudio).not.toHaveBeenCalled();
  });

  it("returns 503 when GEMINI_API_KEY is whitespace only", async () => {
    vi.stubEnv("GEMINI_API_KEY", "   ");

    const res = await POST(audioRequest());

    expect(res.status).toBe(503);
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
  });

  it("trims a padded GEMINI_API_KEY before passing it to the transcriber", async () => {
    vi.stubEnv("GEMINI_API_KEY", "  test-key  ");
    mockTranscribeVoiceAudio.mockResolvedValue("oi");

    await POST(audioRequest());

    const call = mockTranscribeVoiceAudio.mock.calls[0][0];
    expect(call.apiKey).toBe("test-key");
  });

  // --- Rate limiting ---

  it("calls enforceRateLimit with the voice.transcribe bucket and the authenticated user id", async () => {
    await POST(audioRequest());

    expect(mockEnforceRateLimit).toHaveBeenCalledExactlyOnceWith(
      "voice.transcribe",
      "user-123",
    );
  });

  it("resolves the limiter before starting the transcription", async () => {
    const order: string[] = [];
    mockEnforceRateLimit.mockImplementation(async () => {
      order.push("limiter");
    });
    mockTranscribeVoiceAudio.mockImplementation(async () => {
      order.push("transcriber");
      return "oi";
    });

    await POST(audioRequest());

    expect(order).toEqual(["limiter", "transcriber"]);
  });

  it("returns 429 and invokes the transcriber zero times when the limiter is saturated", async () => {
    mockEnforceRateLimit.mockRejectedValue(
      new AppError("RATE_LIMIT_EXCEEDED", "Muitas requisições. Tente novamente em alguns segundos.", {
        statusCode: 429,
      }),
    );

    const res = await POST(audioRequest());

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toEqual({ error: "Muitas requisições. Tente novamente em alguns segundos." });
    expect(mockTranscribeVoiceAudio).not.toHaveBeenCalled();
  });

  it("returns the exact safe 503 body when the limiter is unavailable", async () => {
    mockEnforceRateLimit.mockRejectedValue(
      new AppError("RATE_LIMIT_UNAVAILABLE", "Não foi possível verificar o limite de requisições."),
    );

    const res = await POST(audioRequest());

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: "Serviço temporariamente indisponível" });
    expect(mockTranscribeVoiceAudio).not.toHaveBeenCalled();
  });

  it("returns 503 on an unknown limiter throw", async () => {
    mockEnforceRateLimit.mockRejectedValue(new Error("unexpected"));

    const res = await POST(audioRequest());

    expect(res.status).toBe(503);
    expect(mockTranscribeVoiceAudio).not.toHaveBeenCalled();
  });

  // --- Declared body length ---

  it("rejects a declared body over the multipart cap before reading it", async () => {
    // The audio itself fits the 2 MB file cap: only the declared length
    // explains the 413.
    const res = await POST(
      audioRequest({
        bytes: 2 * 1024 * 1024,
        contentLength: String(2 * 1024 * 1024 + 64 * 1024 + 1),
      }),
    );

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toContain("2 MB");
    expect(mockEnforceRateLimit).toHaveBeenCalledExactlyOnceWith(
      "voice.transcribe",
      "user-123",
    );
    expect(mockTranscribeVoiceAudio).not.toHaveBeenCalled();
  });

  it("rejects a missing content-length instead of buffering an unknown body", async () => {
    const res = await POST(audioRequest({ contentLength: null }));

    expect(res.status).toBe(413);
    expect(mockEnforceRateLimit).toHaveBeenCalledExactlyOnceWith(
      "voice.transcribe",
      "user-123",
    );
    expect(mockTranscribeVoiceAudio).not.toHaveBeenCalled();
  });

  it("rejects an unparseable content-length", async () => {
    const res = await POST(audioRequest({ contentLength: "abc" }));

    expect(res.status).toBe(413);
    expect(mockTranscribeVoiceAudio).not.toHaveBeenCalled();
  });

  // --- Body parsing ---

  it("returns 400 when the audio field is missing", async () => {
    const res = await POST(emptyFormRequest());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Campo 'audio' obrigatório");
    expect(mockTranscribeVoiceAudio).not.toHaveBeenCalled();
  });

  it("returns 400 when the body is not multipart", async () => {
    const res = await POST(jsonRequest(JSON.stringify({ audio: "x" })));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Corpo da requisição inválido");
    expect(mockTranscribeVoiceAudio).not.toHaveBeenCalled();
  });

  // --- Mime validation ---

  it.each(["video/mp4", "application/octet-stream", "text/plain", ""])(
    "returns 415 for unsupported mime type %s",
    async (type) => {
      const res = await POST(audioRequest({ type }));

      expect(res.status).toBe(415);
      const body = await res.json();
      expect(body.error).toBe("Formato de áudio não suportado");
      expect(mockTranscribeVoiceAudio).not.toHaveBeenCalled();
    },
  );

  it("strips codec parameters before checking the mime type", async () => {
    const res = await POST(audioRequest({ type: "audio/webm;codecs=opus" }));

    expect(res.status).toBe(200);
    const call = mockTranscribeVoiceAudio.mock.calls[0][0];
    expect(call.mimeType).toBe("audio/webm");
  });

  it.each(["audio/mp4", "audio/webm", "audio/ogg", "audio/mpeg", "audio/aac", "audio/wav", "audio/x-m4a"])(
    "accepts allowlisted mime type %s",
    async (type) => {
      mockTranscribeVoiceAudio.mockResolvedValue("oi");

      const res = await POST(audioRequest({ type }));

      expect(res.status).toBe(200);
      expect(mockTranscribeVoiceAudio).toHaveBeenCalledTimes(1);
    },
  );

  // --- Size validation ---

  it("returns 413 when the audio exceeds 2 MB", async () => {
    const res = await POST(audioRequest({ bytes: 2 * 1024 * 1024 + 1 }));

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toContain("2 MB");
    expect(mockTranscribeVoiceAudio).not.toHaveBeenCalled();
  });

  it("accepts audio at exactly 2 MB", async () => {
    const res = await POST(audioRequest({ bytes: 2 * 1024 * 1024 }));

    expect(res.status).toBe(200);
  });

  // --- Transcription ---

  it("returns 200 with the transcript on success", async () => {
    mockTranscribeVoiceAudio.mockResolvedValue("Uber com João, 25 reais");

    const res = await POST(audioRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ transcript: "Uber com João, 25 reais" });
  });

  it("sends base64 audio, the stripped mime type and the api key to the transcriber", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const form = new FormData();
    form.append("audio", new File([bytes], "clip", { type: "audio/mp4" }));

    const request = new Request("http://localhost/api/voice/transcribe", {
      method: "POST",
      body: form,
    });
    request.headers.set("content-length", String(bytes.length));

    const res = await POST(request);

    expect(res.status).toBe(200);
    expect(mockTranscribeVoiceAudio).toHaveBeenCalledExactlyOnceWith({
      audioBase64: Buffer.from(bytes).toString("base64"),
      mimeType: "audio/mp4",
      apiKey: "test-key",
    });
  });

  it("returns 422 with the no-speech message when the transcript is empty", async () => {
    mockTranscribeVoiceAudio.mockResolvedValue("   ");

    const res = await POST(audioRequest());

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toEqual({ error: "Não ouvi nada. Tente de novo." });
  });

  it("maps a provider timeout to 504 with the timeout flag", async () => {
    const err = new Error("timed out");
    err.name = "TimeoutError";
    mockTranscribeVoiceAudio.mockRejectedValue(err);

    const res = await POST(audioRequest());

    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body).toEqual({
      error: "Demorou demais. Tente de novo.",
      code: "LLM_TIMEOUT",
      retryable: true,
      timeout: true,
    });
  });

  it("maps a generic provider failure to 500 with LLM_INTERNAL", async () => {
    mockTranscribeVoiceAudio.mockRejectedValue(new Error("Gemini API error"));

    const res = await POST(audioRequest());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("LLM_INTERNAL");
    expect(body.retryable).toBe(false);
    expect(body.timeout).toBe(false);
  });

  it("maps a quota failure to 429", async () => {
    mockTranscribeVoiceAudio.mockRejectedValue(
      Object.assign(new Error("quota"), { status: 429 }),
    );

    const res = await POST(audioRequest());

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("LLM_QUOTA");
  });
});

describe("route segment config", () => {
  it("exports nodejs runtime", () => {
    expect(runtime).toBe("nodejs");
  });

  it("exports maxDuration of 15 seconds", () => {
    expect(maxDuration).toBe(15);
  });
});
