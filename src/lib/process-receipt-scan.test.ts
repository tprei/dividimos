import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock compressImage to return the same file (avoid canvas APIs in tests)
vi.mock("@/lib/image-utils", () => ({
  compressImage: vi.fn((file: File) => Promise.resolve(file)),
}));

import { processReceiptScan } from "./process-receipt-scan";
import type { ReceiptOcrResult } from "@/lib/receipt-ocr";

const mockOcrResult: ReceiptOcrResult = {
  merchant: "Bar do Zeca",
  items: [
    {
      description: "Cerveja Brahma 600ml",
      quantity: 2,
      unitPriceCents: 1200,
      totalCents: 2400,
    },
    {
      description: "Porcao Batata Frita",
      quantity: 1,
      unitPriceCents: 2500,
      totalCents: 2500,
    },
  ],
  serviceFeePercent: 10,
  totalCents: 5390,
};

function createMockFile(name = "receipt.jpg", type = "image/jpeg"): File {
  return new File(["fake-image-data"], name, { type });
}

describe("processReceiptScan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("compresses the image, sends base64 to OCR API, and returns result", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockOcrResult), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const file = createMockFile();
    const result = await processReceiptScan(file);

    expect(result).toEqual(mockOcrResult);

    // Verify fetch was called with correct endpoint and method
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/receipt/ocr");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });

    // Verify the body contains base64 image and mimeType
    const body = JSON.parse(init?.body as string);
    expect(body.mimeType).toBe("image/jpeg");
    expect(typeof body.image).toBe("string");
    expect(body.image.length).toBeGreaterThan(0);

    fetchSpy.mockRestore();
  });

  it("throws on non-ok response with error message from body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Imagem muito grande (max 4MB)" }), {
        status: 413,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const file = createMockFile();
    await expect(processReceiptScan(file)).rejects.toThrow(
      "Imagem muito grande (max 4MB)",
    );

    fetchSpy.mockRestore();
  });

  it("throws generic error when response body is not JSON", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error", { status: 500 }),
    );

    const file = createMockFile();
    await expect(processReceiptScan(file)).rejects.toThrow("Erro 500");

    fetchSpy.mockRestore();
  });

  it("passes compressed file mimeType to API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockOcrResult), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const pngFile = createMockFile("receipt.png", "image/png");
    await processReceiptScan(pngFile);

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.mimeType).toBe("image/png");

    fetchSpy.mockRestore();
  });
});
