import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock compressImage to return the same file (avoid canvas APIs in tests)
vi.mock("@/lib/image-utils", () => ({
  compressImage: vi.fn((file: File) => Promise.resolve(file)),
}));

import { compressImage } from "@/lib/image-utils";
import { useAppStore } from "@/stores/app-store";
import { CURRENT_AI_CONSENT_VERSION } from "@/lib/ai-consent";
import {
  processReceiptScan,
  ReceiptTimeoutError,
  ReceiptInvalidError,
} from "./receipt";
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
  serviceFeeBasisPoints: 1000,
  fixedFeesCents: 0,
  totalCents: 5390,
};

function createMockFile(name = "receipt.jpg", type = "image/jpeg"): File {
  return new File(["fake-image-data"], name, { type });
}


function revokeLocally(): void {
  useAppStore.getState().patch((s) =>
    s.me
      ? {
          me: { ...s.me, aiConsentVersion: null, aiConsentGrantedAt: null },
          aiConsentRevision: s.aiConsentRevision + 1,
        }
      : {},
  );
}

function seedUsableConsent(): void {
  useAppStore.getState().reset();
  useAppStore.setState({
    bootstrapStatus: "ready",
    lastBootstrappedAccountId: "user-1",
    lastBootstrappedGeneration: 0,
    me: {
      id: "user-1",
      handle: "alice",
      name: "Alice",
      avatarUrl: null,
      isBot: false,
      email: "alice@example.com",
      pixKeyType: null,
      pixKeyHint: null,
      onboarded: true,
      notificationPreferences: {},
      aiConsentVersion: CURRENT_AI_CONSENT_VERSION,
      aiConsentGrantedAt: "2026-01-01T00:00:00.000Z",
    },
  });
}

describe("processReceiptScan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedUsableConsent();
  });
  afterEach(() => {
    useAppStore.getState().reset();
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

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/receipt/ocr");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });

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

  it("aborts the OCR request when the caller aborts", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise<Response>((_, reject) => {
          // Platform fetch rejects immediately on an already-aborted signal.
          const fail = () => reject(new DOMException("aborted", "AbortError"));
          if (init?.signal?.aborted) fail();
          else init?.signal?.addEventListener("abort", fail);
        }),
    );

    const controller = new AbortController();
    const pending = processReceiptScan(createMockFile(), controller.signal);
    const assertion = expect(pending).rejects.toBeInstanceOf(ReceiptTimeoutError);
    controller.abort();
    await assertion;

    expect(fetchSpy.mock.calls[0][1]?.signal?.aborted).toBe(true);
    fetchSpy.mockRestore();
  });

  it("rejects an OCR result with zero items and a positive total (#477 637k: never inferred as single_amount)", async () => {
    const emptyItemsResult: ReceiptOcrResult = {
      merchant: "Bar do Zeca",
      items: [],
      serviceFeeBasisPoints: 0,
      fixedFeesCents: 0,
      totalCents: 5390,
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(emptyItemsResult), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const file = createMockFile();
    await expect(processReceiptScan(file)).rejects.toBeInstanceOf(ReceiptInvalidError);

    fetchSpy.mockRestore();
  });

  it("rejects an OCR result with zero items and a zero total", async () => {
    const emptyResult: ReceiptOcrResult = {
      merchant: "Bar do Zeca",
      items: [],
      serviceFeeBasisPoints: 0,
      fixedFeesCents: 0,
      totalCents: 0,
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(emptyResult), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const file = createMockFile();
    const pending = processReceiptScan(file);
    await expect(pending).rejects.toBeInstanceOf(ReceiptInvalidError);
    await expect(pending).rejects.toThrow("Não encontramos itens na nota");

    fetchSpy.mockRestore();
  });

  it("accepts a receipt whose printed total disagrees with the item sum", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ...mockOcrResult, totalCents: 4999 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const file = createMockFile();
    const result = await processReceiptScan(file);
    expect(result.totalCents).toBe(4999);

    fetchSpy.mockRestore();
  });

  it("rejects a receipt whose line arithmetic is broken", async () => {
    const brokenLineResult: ReceiptOcrResult = {
      merchant: "Bar do Zeca",
      items: [
        {
          description: "X",
          quantity: 2,
          unitPriceCents: 1000,
          totalCents: 2500,
        },
      ],
      serviceFeeBasisPoints: 0,
      fixedFeesCents: 0,
      totalCents: 2500,
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(brokenLineResult), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const file = createMockFile();
    await expect(processReceiptScan(file)).rejects.toBeInstanceOf(ReceiptInvalidError);

    fetchSpy.mockRestore();
  });
  it("revocation during compression uploads nothing and reports the cancelled path", async () => {
    const compression = Promise.withResolvers<File>();
    vi.mocked(compressImage).mockImplementationOnce(() => compression.promise as never);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const pending = processReceiptScan(createMockFile());
    revokeLocally();
    compression.resolve(createMockFile());

    await expect(pending).rejects.toThrowError(
      "Não foi possível processar. Tente novamente ou adicione manualmente.",
    );
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("a 403 denial invalidates only the matching account", async () => {
    const response = Promise.withResolvers<Response>();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockReturnValue(response.promise as never);

    const pending = processReceiptScan(createMockFile());
    useAppStore.getState().reset();
    seedUsableConsent();
    useAppStore.setState({
      me: {
        ...useAppStore.getState().me!,
        id: "user-2",
        handle: "bob",
        email: "bob@example.com",
      },
      lastBootstrappedAccountId: "user-2",
    });

    response.resolve(
      new Response(
        JSON.stringify({
          error: "Para usar IA, permita o envio dos dados. Você pode continuar sem IA.",
          code: "ai_consent_required",
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(pending).rejects.toBeInstanceOf(ReceiptTimeoutError);

    const state = useAppStore.getState();
    expect(state.me?.id).toBe("user-2");
    expect(state.me?.aiConsentVersion).toBe(CURRENT_AI_CONSENT_VERSION);

    fetchSpy.mockRestore();
  });

  it("a 403 denial for the current account invalidates its grant", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Para usar IA, permita o envio dos dados. Você pode continuar sem IA.",
          code: "ai_consent_required",
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(processReceiptScan(createMockFile())).rejects.toMatchObject({
      code: "ai_consent_required",
    });

    const state = useAppStore.getState();
    expect(state.me?.aiConsentVersion).toBeNull();
    expect(state.aiConsentRevision).toBe(1);

    fetchSpy.mockRestore();
  });

  it("missing consent means zero fetch calls", async () => {
    revokeLocally();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(processReceiptScan(createMockFile())).rejects.toMatchObject({
      code: "ai_consent_required",
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("a 503 keeps known consent but surfaces the failure", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Serviço temporariamente indisponível" }), {
        status: 503,
      }),
    );

    await expect(processReceiptScan(createMockFile())).rejects.toThrow(
      "Serviço temporariamente indisponível",
    );

    const state = useAppStore.getState();
    expect(state.me?.aiConsentVersion).toBe(CURRENT_AI_CONSENT_VERSION);
    expect(state.me?.aiConsentGrantedAt).toBe("2026-01-01T00:00:00.000Z");

    fetchSpy.mockRestore();
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

describe("application-owned deadlines", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    seedUsableConsent();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** A proxy that accepts the connection and then never answers. */
  function stalledFetch() {
    return vi.fn(
      (_input: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason ?? new DOMException("aborted", "AbortError"));
          });
        }),
    );
  }


  it("times out the OCR call instead of hanging the scan", async () => {
    vi.stubGlobal("fetch", stalledFetch());

    const pending = processReceiptScan(createMockFile());
    const assertion = expect(pending).rejects.toBeInstanceOf(ReceiptTimeoutError);
    await vi.advanceTimersByTimeAsync(40_000);
    await assertion;
  });
});
