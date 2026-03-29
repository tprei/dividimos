import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase server client
const mockGetUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
  }),
}));

// Mock the receipt OCR module
const mockParseReceiptImage = vi.fn();
vi.mock("@/lib/receipt-ocr", () => ({
  parseReceiptImage: (...args: unknown[]) => mockParseReceiptImage(...args),
}));

const { POST, runtime, maxDuration } = await import("./route");

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
    vi.stubEnv("GEMINI_API_KEY", "test-key");
  });

  it("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await POST(jsonRequest({ image: "abc" }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Nao autenticado");
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
      serviceFeePercent: 0,
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
      serviceFeePercent: 0,
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
      serviceFeePercent: 0,
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

  it("returns 500 when parseReceiptImage throws", async () => {
    mockParseReceiptImage.mockRejectedValue(new Error("Gemini API error"));

    const base64 = Buffer.from("fake").toString("base64");
    const res = await POST(jsonRequest({ image: base64 }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Gemini API error");
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
});

describe("route segment config", () => {
  it("exports nodejs runtime", () => {
    expect(runtime).toBe("nodejs");
  });

  it("exports maxDuration of 15 seconds", () => {
    expect(maxDuration).toBe(15);
  });
});
