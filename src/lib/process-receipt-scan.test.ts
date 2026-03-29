import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock compressImage to return the same file (avoid canvas APIs in tests)
vi.mock("@/lib/image-utils", () => ({
  compressImage: vi.fn((file: File) => Promise.resolve(file)),
}));

import { processReceiptScan, fetchSefazReceipt, SefazFallbackError, ReceiptTimeoutError } from "./process-receipt-scan";
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

  it("throws ReceiptTimeoutError when response has timeout flag", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Não foi possível processar. Tente novamente ou adicione manualmente.",
          timeout: true,
        }),
        { status: 504, headers: { "Content-Type": "application/json" } },
      ),
    );

    const file = createMockFile();
    const err = await processReceiptScan(file).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReceiptTimeoutError);
    expect((err as ReceiptTimeoutError).timeout).toBe(true);
    expect((err as ReceiptTimeoutError).message).toContain("Tente novamente");

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

describe("fetchSefazReceipt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends URL to SEFAZ API and returns parsed result", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockOcrResult), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const sefazUrl = "https://nfce.sefaz.sp.gov.br/consulta?chNFe=12345678901234567890123456789012345678901234";
    const result = await fetchSefazReceipt(sefazUrl);

    expect(result).toEqual(mockOcrResult);
    expect(fetchSpy).toHaveBeenCalledOnce();

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/receipt/sefaz");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.url).toBe(sefazUrl);

    fetchSpy.mockRestore();
  });

  it("throws SefazFallbackError when response has fallback flag", async () => {
    const sefazUrl = "https://nfce.sefaz.sp.gov.br/consulta";
    const makeResponse = () =>
      new Response(
        JSON.stringify({ error: "CAPTCHA detectado", fallback: true }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(makeResponse());

    const err = await fetchSefazReceipt(sefazUrl).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SefazFallbackError);
    expect((err as SefazFallbackError).message).toBe("CAPTCHA detectado");

    fetchSpy.mockRestore();
  });

  it("throws SefazFallbackError with default message when error field is empty", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ fallback: true }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(fetchSefazReceipt("https://example.com")).rejects.toThrow(
      "Falha ao consultar SEFAZ",
    );

    fetchSpy.mockRestore();
  });

  it("throws generic Error when response fails without fallback flag", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: "Nao autenticado" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    );

    const promise = fetchSefazReceipt("https://example.com");
    await expect(promise).rejects.toThrow("Nao autenticado");
    await expect(fetchSefazReceipt("https://example.com")).rejects.not.toThrow(SefazFallbackError);

    fetchSpy.mockRestore();
  });

  it("throws generic error when response body is not JSON", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Gateway Timeout", { status: 504 }),
    );

    await expect(fetchSefazReceipt("https://example.com")).rejects.toThrow("Erro 504");

    fetchSpy.mockRestore();
  });

  it("SefazFallbackError has fallback property set to true", () => {
    const err = new SefazFallbackError("test");
    expect(err.fallback).toBe(true);
    expect(err.name).toBe("SefazFallbackError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("ReceiptTimeoutError", () => {
  it("has timeout property set to true", () => {
    const err = new ReceiptTimeoutError();
    expect(err.timeout).toBe(true);
    expect(err.name).toBe("ReceiptTimeoutError");
    expect(err).toBeInstanceOf(Error);
  });

  it("uses default message when none provided", () => {
    const err = new ReceiptTimeoutError();
    expect(err.message).toBe(
      "Não foi possível processar. Tente novamente ou adicione manualmente.",
    );
  });

  it("accepts custom message", () => {
    const err = new ReceiptTimeoutError("Custom timeout");
    expect(err.message).toBe("Custom timeout");
  });
});
