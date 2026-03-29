import { compressImage } from "@/lib/image-utils";
import type { ReceiptOcrResult } from "@/lib/receipt-ocr";

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
    throw new Error(body.error || `Erro ${res.status}`);
  }

  return res.json();
}
