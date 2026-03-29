import { compressImage } from "@/lib/image-utils";
import type { ReceiptOcrResult } from "@/lib/receipt-ocr";

/**
 * Error thrown when SEFAZ fetch fails but a photo fallback is appropriate.
 * The `fallback` flag lets callers distinguish recoverable SEFAZ errors
 * (captcha, timeout, unparseable HTML) from hard failures (auth, bad URL).
 */
export class SefazFallbackError extends Error {
  readonly fallback = true as const;
  constructor(message: string) {
    super(message);
    this.name = "SefazFallbackError";
  }
}

/**
 * Error thrown when an API call times out or fails in a retryable way.
 * Callers should offer "Tente novamente" and "Adicionar manualmente" options.
 */
export class ReceiptTimeoutError extends Error {
  readonly timeout = true as const;
  constructor(
    message = "Não foi possível processar. Tente novamente ou adicione manualmente.",
  ) {
    super(message);
    this.name = "ReceiptTimeoutError";
  }
}

/**
 * Fetch and parse an NFC-e receipt via the SEFAZ HTML scraper route.
 * Throws `SefazFallbackError` when the server indicates a fallback is appropriate
 * (captcha, timeout, unparseable page). Other errors throw a generic `Error`.
 */
export async function fetchSefazReceipt(url: string): Promise<ReceiptOcrResult> {
  const res = await fetch("/api/receipt/sefaz", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (body.fallback) {
      throw new SefazFallbackError(body.error || "Falha ao consultar SEFAZ");
    }
    throw new Error(body.error || `Erro ${res.status}`);
  }

  return res.json();
}

/**
 * Compress an image file and send it to the OCR API route.
 * Returns the parsed receipt result on success.
 */
export async function processReceiptScan(file: File): Promise<ReceiptOcrResult> {
  const compressed = await compressImage(file);
  const buffer = await compressed.arrayBuffer();
  const base64 = btoa(
    new Uint8Array(buffer).reduce(
      (data, byte) => data + String.fromCharCode(byte),
      "",
    ),
  );

  const res = await fetch("/api/receipt/ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: base64, mimeType: compressed.type }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (body.timeout) {
      throw new ReceiptTimeoutError(body.error);
    }
    throw new Error(body.error || `Erro ${res.status}`);
  }

  return res.json();
}
