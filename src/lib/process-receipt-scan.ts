import { compressImage } from "@/lib/image-utils";
import { decodeExpenseResult } from "@/lib/expense-money";
import type { ReceiptOcrResult } from "@/lib/receipt-ocr";

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
 * OCR receipt is `itemized` -- never inferred as `single_amount`. A
 * scan that found zero items is never a legitimate single-total receipt; per
 * #477 part 1, `scan_review` is itemized-only and "empty/zero or missing
 * root total is a safe scan error before review." Passing the true
 * `itemized` type here (instead of inferring `single_amount` from an empty
 * item array) lets the decoder reject that case outright rather than
 * silently mounting an undetailed, unreviewed single-amount expense.
 */
function assertReconciledReceipt(result: ReceiptOcrResult): ReceiptOcrResult {
  const decoded = decodeExpenseResult("ocr", "scan_review", {
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
  return assertReconciledReceipt(result);
}
