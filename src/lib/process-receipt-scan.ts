import { compressImage } from "@/lib/image-utils";
import { decodeExpenseResult } from "@/lib/expense-money";
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
 * Error thrown when a receipt result fails the exact #477 money/arithmetic
 * reconciliation gate (missing total, item line mismatch, unreconciled fee,
 * etc). The review screen must never mount on this - it always means "the
 * source could not be trusted," never "warn but continue."
 */
export class ReceiptInvalidError extends Error {
  constructor(
    message = "Não foi possível confirmar os valores da nota. Tente novamente ou adicione manualmente.",
  ) {
    super(message);
    this.name = "ReceiptInvalidError";
  }
}

/**
 * Validate a raw receipt candidate through the same #477 exact reconciliation
 * `decodeExpenseResult` applies before mounting `ScannedItemsReview`. Every
 * OCR/SEFAZ receipt is `itemized` -- never inferred as `single_amount`. A
 * scan that found zero items is never a legitimate single-total receipt; per
 * #477 part 1, `scan_review` is itemized-only and "empty/zero or missing
 * root total is a safe scan error before review." Passing the true
 * `itemized` type here (instead of inferring `single_amount` from an empty
 * item array) lets the decoder reject that case outright rather than
 * silently mounting an undetailed, unreviewed single-amount expense.
 */
function assertReconciledReceipt(
  source: "ocr" | "sefaz",
  result: ReceiptOcrResult,
): ReceiptOcrResult {
  const decoded = decodeExpenseResult(source, "scan_review", {
    merchantName: result.merchant,
    expenseType: "itemized",
    totalAmountCents: result.totalCents,
    serviceFeeBasisPoints: result.serviceFeeBasisPoints,
    fixedFeesCents: result.fixedFeesCents,
    items: result.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      totalCents: item.totalCents,
    })),
  });
  if (!decoded.ok) {
    throw new ReceiptInvalidError();
  }
  return result;
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

  const result = (await res.json()) as ReceiptOcrResult;
  return assertReconciledReceipt("sefaz", result);
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

  const result = (await res.json()) as ReceiptOcrResult;
  return assertReconciledReceipt("ocr", result);
}
