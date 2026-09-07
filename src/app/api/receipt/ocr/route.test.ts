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
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: (...args: unknown[]) => mockEnforceRateLimit(...args),
}));

const { POST, runtime, maxDuration } = await import("./route");
const { AppError } = await import("@/lib/errors");

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

    const base64 = Buffer.from("fake-image").toString("base64");
    const res = await POST(jsonRequest({ image: base64, mimeType: "image/png" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(ocrResult);
    expect(mockParseReceiptImage).toHaveBeenCalledWith(
      base64,
      "image/png",
      "test-key",
    );
  });

  it("defaults mimeType to image/jpeg for JSON body", async () => {
    mockParseReceiptImage.mockResolvedValue({
      merchant: null,
      items: [],
      serviceFeeBasisPoints: 0,
      fixedFeesCents: 0,
      totalCents: 0,
    });

    const base64 = Buffer.from("fake").toString("base64");
    const res = await POST(jsonRequest({ image: base64 }));

    expect(res.status).toBe(200);
    expect(mockParseReceiptImage).toHaveBeenCalledWith(
      base64,
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

    const file = new File([new Uint8Array(100)], "receipt.jpg", {
      type: "image/jpeg",
    });
    const res = await POST(formDataRequest(file));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(ocrResult);
    expect(mockParseReceiptImage).toHaveBeenCalledWith(
      expect.any(String),
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

    const base64 = Buffer.from("fake").toString("base64");
    const res = await POST(jsonRequest({ image: base64 }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Erro ao processar imagem");
    expect(JSON.stringify(body)).not.toContain("leaked internal detail");
  });

  it("returns generic error message for non-Error throws", async () => {
    mockParseReceiptImage.mockRejectedValue("string error");

    const base64 = Buffer.from("fake").toString("base64");
    const res = await POST(jsonRequest({ image: base64 }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Erro ao processar imagem");
    expect(body.timeout).toBe(false);
  });

  it("returns 504 with timeout flag when Gemini times out", async () => {
    const timeoutError = new Error("Request timed out");
    timeoutError.name = "TimeoutError";
    mockParseReceiptImage.mockRejectedValue(timeoutError);

    const base64 = Buffer.from("fake").toString("base64");
    const res = await POST(jsonRequest({ image: base64 }));

    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.timeout).toBe(true);
    expect(body.error).toContain("Tente novamente");
  });

  it("returns 504 with timeout flag when Gemini aborts", async () => {
    const abortError = new Error("Aborted");
    abortError.name = "AbortError";
    mockParseReceiptImage.mockRejectedValue(abortError);

    const base64 = Buffer.from("fake").toString("base64");
    const res = await POST(jsonRequest({ image: base64 }));

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

    await POST(jsonRequest({ image: Buffer.from("fake").toString("base64") }));

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

    await POST(jsonRequest({ image: Buffer.from("fake").toString("base64") }));

    expect(order).toEqual(["limiter", "ocr"]);
  });

  it("returns 429 and invokes the OCR parser zero times when the limiter is saturated on the first call", async () => {
    mockEnforceRateLimit.mockRejectedValue(
      new AppError("RATE_LIMIT_EXCEEDED", "Muitas requisições. Tente novamente em alguns segundos.", {
        statusCode: 429,
      }),
    );

    const res = await POST(jsonRequest({ image: Buffer.from("fake").toString("base64") }));

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
    const base64 = Buffer.from("fake").toString("base64");

    for (let i = 0; i < 30; i++) {
      const res = await POST(jsonRequest({ image: base64 }));
      expect(res.status).toBe(200);
    }
    expect(mockParseReceiptImage).toHaveBeenCalledTimes(30);

    const rejected = await POST(jsonRequest({ image: base64 }));
    expect(rejected.status).toBe(429);
    expect(mockParseReceiptImage).toHaveBeenCalledTimes(30);
  });

  it("returns the exact safe 503 body and invokes the OCR parser zero times when the limiter is unavailable", async () => {
    mockEnforceRateLimit.mockRejectedValue(
      new AppError("RATE_LIMIT_UNAVAILABLE", "Não foi possível verificar o limite de requisições."),
    );

    const res = await POST(jsonRequest({ image: Buffer.from("fake").toString("base64") }));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: "Serviço temporariamente indisponível" });
    expect(JSON.stringify(body)).not.toContain("verificar o limite");
    expect(mockParseReceiptImage).not.toHaveBeenCalled();
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
