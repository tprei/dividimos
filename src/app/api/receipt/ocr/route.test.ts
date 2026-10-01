import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase server client
const mockGetUser = vi.fn();
const mockGetClaims = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: () => mockGetUser(),
      getClaims: () => mockGetClaims(),
    },
  }),
}));

// Mock the receipt OCR module
const mockParseReceiptImage = vi.fn();
vi.mock("@/lib/receipt-ocr", () => ({
  parseReceiptImage: (...args: unknown[]) => mockParseReceiptImage(...args),
}));

const mockEnforceRateLimit = vi.fn();
const mockEnforceAiBudget = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: (...args: unknown[]) => mockEnforceRateLimit(...args),
  enforceAiBudget: (...args: unknown[]) => mockEnforceAiBudget(...args),
}));

const { POST } = await import("./route");
const { AppError } = await import("@/lib/errors");

// Minimal real-format fixtures for the magic-byte gate.
const JPEG_BYTES = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const GIF_BYTES = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const PDF_BYTES = Uint8Array.from([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a,
]);

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

const DAILY_BUDGET_MESSAGE =
  "Você usou o limite diário de leituras com IA. Tente de novo amanhã.";
const ACCOUNT_DELETED_MESSAGE =
  "Sua conta foi excluída e não pode mais usar o Dividimos.";

function jsonRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/receipt/ocr", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function formDataRequest(file: File) {
  const form = new FormData();
  form.append("image", file);
  return new Request("http://localhost/api/receipt/ocr", {
    method: "POST",
    body: form,
  });
}

describe("POST /api/receipt/ocr", () => {
  const authenticatedUser = {
    data: { user: { id: "user-123" } },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue(authenticatedUser);
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "user-123" } }, error: null });
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    // vi.clearAllMocks() clears call history but not a queued rejection
    // implementation from a prior test — reset the default to success here.
    mockEnforceRateLimit.mockReset();
    mockEnforceRateLimit.mockResolvedValue(undefined);
    mockEnforceAiBudget.mockReset();
    mockEnforceAiBudget.mockResolvedValue(undefined);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockGetClaims.mockResolvedValue({ data: null, error: null });

    const res = await POST(jsonRequest({ image: "abc" }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Não autenticado");
  });

  it("returns 503 when GEMINI_API_KEY is not set", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");

    const res = await POST(jsonRequest({ image: "abc" }));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("OCR nao configurado");
  });

  it("returns 400 when JSON body has no image field", async () => {
    const res = await POST(jsonRequest({}));

    expect(res.status).toBe(400);
  });

  it("returns 400 when image field is not a string", async () => {
    const res = await POST(jsonRequest({ image: 123 }));

    expect(res.status).toBe(400);
  });

  it("processes JSON body with base64 image", async () => {
    const ocrResult = {
      merchant: "Test",
      items: [
        {
          description: "Item",
          quantity: 1,
          unitPriceCents: 1000,
          totalCents: 1000,
        },
      ],
      serviceFeeBasisPoints: 0,
      fixedFeesCents: 0,
      totalCents: 1000,
    };
    mockParseReceiptImage.mockResolvedValue(ocrResult);

    const imageBase64 = base64(PNG_BYTES);
    const res = await POST(jsonRequest({ image: imageBase64, mimeType: "image/png" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(ocrResult);
    expect(mockParseReceiptImage).toHaveBeenCalledWith(
      imageBase64,
      "image/png",
      "test-key",
    );
  });

  it("sends the detected type, not the caller's mimeType claim, to Gemini", async () => {
    mockParseReceiptImage.mockResolvedValue({
      merchant: null,
      items: [],
      serviceFeeBasisPoints: 0,
      fixedFeesCents: 0,
      totalCents: 0,
    });

    const res = await POST(
      jsonRequest({ image: base64(PNG_BYTES), mimeType: "image/jpeg" }),
    );

    expect(res.status).toBe(200);
    expect(mockParseReceiptImage).toHaveBeenCalledWith(
      base64(PNG_BYTES),
      "image/png",
      "test-key",
    );
  });

  it("defaults to the detected type when the JSON body has no mimeType", async () => {
    mockParseReceiptImage.mockResolvedValue({
      merchant: null,
      items: [],
      serviceFeeBasisPoints: 0,
      fixedFeesCents: 0,
      totalCents: 0,
    });

    const res = await POST(jsonRequest({ image: base64(JPEG_BYTES) }));

    expect(res.status).toBe(200);
    expect(mockParseReceiptImage).toHaveBeenCalledWith(
      base64(JPEG_BYTES),
      "image/jpeg",
      "test-key",
    );
  });

  it("processes multipart form data with file", async () => {
    const ocrResult = {
      merchant: "Restaurante",
      items: [],
      serviceFeeBasisPoints: 0,
      fixedFeesCents: 0,
      totalCents: 0,
    };
    mockParseReceiptImage.mockResolvedValue(ocrResult);

    const file = new File([JPEG_BYTES], "receipt.jpg", {
      type: "image/jpeg",
    });
    const res = await POST(formDataRequest(file));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(ocrResult);
    expect(mockParseReceiptImage).toHaveBeenCalledWith(
      base64(JPEG_BYTES),
      "image/jpeg",
      "test-key",
    );
  });

  it("returns 400 when form data has no image field", async () => {
    const form = new FormData();
    form.append("other", "value");
    const req = new Request("http://localhost/api/receipt/ocr", {
      method: "POST",
      body: form,
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("returns 413 when JSON image exceeds 4MB", async () => {
    // Create a base64 string that decodes to >4MB
    const largeBuffer = Buffer.alloc(5 * 1024 * 1024);
    const largeBase64 = largeBuffer.toString("base64");

    const res = await POST(jsonRequest({ image: largeBase64 }));

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toContain("4MB");
  });

  it("returns 500 with a generic message without leaking the thrown error", async () => {
    mockParseReceiptImage.mockRejectedValue(
      new Error("Gemini API error: leaked internal detail"),
    );

    const res = await POST(jsonRequest({ image: base64(JPEG_BYTES) }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("LLM_INTERNAL");
    expect(body.retryable).toBe(false);
    expect(JSON.stringify(body)).not.toContain("leaked internal detail");
  });

  it("returns generic error message for non-Error throws", async () => {
    mockParseReceiptImage.mockRejectedValue("string error");

    const res = await POST(jsonRequest({ image: base64(JPEG_BYTES) }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("LLM_INTERNAL");
    expect(body.retryable).toBe(false);
    expect(body.timeout).toBe(false);
  });

  it("returns 504 with timeout flag when Gemini times out", async () => {
    const timeoutError = new Error("Request timed out");
    timeoutError.name = "TimeoutError";
    mockParseReceiptImage.mockRejectedValue(timeoutError);

    const res = await POST(jsonRequest({ image: base64(JPEG_BYTES) }));

    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.timeout).toBe(true);
    expect(body.code).toBe("LLM_TIMEOUT");
    expect(body.retryable).toBe(true);
  });

  it("returns 504 with timeout flag when Gemini aborts", async () => {
    const abortError = new Error("Aborted");
    abortError.name = "AbortError";
    mockParseReceiptImage.mockRejectedValue(abortError);

    const res = await POST(jsonRequest({ image: base64(JPEG_BYTES) }));

    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.timeout).toBe(true);
  });

  // --- Rate limiting ---

  it("calls enforceRateLimit with the receipt.ocr bucket and the authenticated user id", async () => {
    mockParseReceiptImage.mockResolvedValue({
      merchant: null,
      items: [],
      serviceFeePercent: 0,
      totalCents: 0,
    });

    await POST(jsonRequest({ image: base64(JPEG_BYTES) }));

    expect(mockEnforceRateLimit).toHaveBeenCalledExactlyOnceWith("receipt.ocr", "user-123");
  });

  it("resolves the limiter before starting the OCR call", async () => {
    const order: string[] = [];
    mockEnforceRateLimit.mockImplementation(async () => {
      order.push("limiter");
    });
    mockParseReceiptImage.mockImplementation(async () => {
      order.push("ocr");
      return { merchant: null, items: [], serviceFeePercent: 0, totalCents: 0 };
    });

    await POST(jsonRequest({ image: base64(JPEG_BYTES) }));

    expect(order).toEqual(["limiter", "ocr"]);
  });

  it("returns 429 and invokes the OCR parser zero times when the limiter is saturated on the first call", async () => {
    mockEnforceRateLimit.mockRejectedValue(
      new AppError("RATE_LIMIT_EXCEEDED", "Muitas requisições. Tente novamente em alguns segundos.", {
        statusCode: 429,
      }),
    );

    const res = await POST(jsonRequest({ image: base64(JPEG_BYTES) }));

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toEqual({ error: "Muitas requisições. Tente novamente em alguns segundos." });
    expect(mockParseReceiptImage).not.toHaveBeenCalled();
  });

  it("simulates 30 admitted requests followed by a 31st rejection with parser count pinned at 30", async () => {
    mockParseReceiptImage.mockResolvedValue({
      merchant: null,
      items: [],
      serviceFeePercent: 0,
      totalCents: 0,
    });
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
      const res = await POST(jsonRequest({ image: base64(JPEG_BYTES) }));
      expect(res.status).toBe(200);
    }
    expect(mockParseReceiptImage).toHaveBeenCalledTimes(30);

    const rejected = await POST(jsonRequest({ image: base64(JPEG_BYTES) }));
    expect(rejected.status).toBe(429);
    expect(mockParseReceiptImage).toHaveBeenCalledTimes(30);
  });

  it("returns the exact safe 503 body and invokes the OCR parser zero times when the limiter is unavailable", async () => {
    mockEnforceRateLimit.mockRejectedValue(
      new AppError("RATE_LIMIT_UNAVAILABLE", "Não foi possível verificar o limite de requisições."),
    );

    const res = await POST(jsonRequest({ image: base64(JPEG_BYTES) }));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: "Serviço temporariamente indisponível" });
    expect(JSON.stringify(body)).not.toContain("verificar o limite");
    expect(mockParseReceiptImage).not.toHaveBeenCalled();
  });

  // --- Daily AI budget ---

  it("spends the daily AI budget with the authenticated user id alongside the per-minute limit", async () => {
    mockParseReceiptImage.mockResolvedValue({
      merchant: null,
      items: [],
      serviceFeeBasisPoints: 0,
      fixedFeesCents: 0,
      totalCents: 0,
    });

    await POST(jsonRequest({ image: base64(JPEG_BYTES) }));

    expect(mockEnforceAiBudget).toHaveBeenCalledExactlyOnceWith("user-123");
    expect(mockEnforceRateLimit).toHaveBeenCalledExactlyOnceWith("receipt.ocr", "user-123");
  });

  it("returns 429 with the daily-budget copy when the daily AI budget is exhausted", async () => {
    mockEnforceAiBudget.mockRejectedValue(
      new AppError("RATE_LIMIT_EXCEEDED", DAILY_BUDGET_MESSAGE, { statusCode: 429 }),
    );

    const res = await POST(jsonRequest({ image: base64(JPEG_BYTES) }));

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toEqual({ error: DAILY_BUDGET_MESSAGE });
    expect(mockParseReceiptImage).not.toHaveBeenCalled();
  });

  it("returns 503 when the daily AI budget cannot be verified", async () => {
    mockEnforceAiBudget.mockRejectedValue(
      new AppError("RATE_LIMIT_UNAVAILABLE", "Não foi possível verificar o limite de requisições."),
    );

    const res = await POST(jsonRequest({ image: base64(JPEG_BYTES) }));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: "Serviço temporariamente indisponível" });
    expect(mockParseReceiptImage).not.toHaveBeenCalled();
  });

  it("returns 403 and invokes the OCR parser zero times when the account is deleted", async () => {
    mockEnforceAiBudget.mockRejectedValue(
      new AppError("ACCOUNT_DELETED", ACCOUNT_DELETED_MESSAGE),
    );

    const res = await POST(jsonRequest({ image: base64(JPEG_BYTES) }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: ACCOUNT_DELETED_MESSAGE });
    expect(mockParseReceiptImage).not.toHaveBeenCalled();
  });

  // --- Declared body length ---

  it("rejects a Content-Length above 4MB before reading the body", async () => {
    // A non-JSON body: if the route read it, POST would throw on json()
    // instead of returning the 413.
    const request = new Request("http://localhost/api/receipt/ocr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    request.headers.set("content-length", String(4 * 1024 * 1024 + 1));

    const res = await POST(request);

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toContain("4MB");
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
    expect(mockEnforceAiBudget).not.toHaveBeenCalled();
    expect(mockParseReceiptImage).not.toHaveBeenCalled();
  });

  it("rejects an unparseable Content-Length before reading the body", async () => {
    const request = new Request("http://localhost/api/receipt/ocr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    request.headers.set("content-length", "abc");

    const res = await POST(request);

    expect(res.status).toBe(413);
    expect(mockEnforceRateLimit).not.toHaveBeenCalled();
    expect(mockEnforceAiBudget).not.toHaveBeenCalled();
  });

  // --- Magic-byte format gate ---

  it("returns 415 when a PDF claims to be image/jpeg", async () => {
    const res = await POST(
      jsonRequest({ image: base64(PDF_BYTES), mimeType: "image/jpeg" }),
    );

    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toContain("JPG, PNG ou WEBP");
    expect(mockParseReceiptImage).not.toHaveBeenCalled();
  });

  it("returns 415 for a GIF uploaded as multipart", async () => {
    const file = new File([GIF_BYTES], "receipt.gif", { type: "image/gif" });
    const res = await POST(formDataRequest(file));

    expect(res.status).toBe(415);
    expect(mockParseReceiptImage).not.toHaveBeenCalled();
  });

  it("returns 415 for garbage bytes claiming image/jpeg", async () => {
    const res = await POST(
      jsonRequest({ image: base64(new Uint8Array(32)), mimeType: "image/jpeg" }),
    );

    expect(res.status).toBe(415);
    expect(mockParseReceiptImage).not.toHaveBeenCalled();
  });
});
