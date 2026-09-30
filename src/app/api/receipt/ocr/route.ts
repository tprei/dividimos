import { NextResponse } from "next/server";
import { classifyLlmFailure, LLM_FAILURE_MESSAGE } from "@/lib/llm-errors";
import { createClient } from "@/lib/supabase/server";
import { parseReceiptImage } from "@/lib/receipt-ocr";
import { detectImageMimeType } from "@/lib/image-format";
import { enforceRateLimit, enforceAiBudget } from "@/lib/rate-limit";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 15;

/** Max request body size: 4 MB (compressed JPEG should be well under this). */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const UNSUPPORTED_IMAGE_MESSAGE =
  "Formato de imagem não suportado. Envie uma foto em JPG, PNG ou WEBP.";

export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  const userId = claimsData.claims.sub;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OCR nao configurado" },
      { status: 503 },
    );
  }

  // The body readers buffer without a bound, so a declared length above the
  // cap is rejected before the read. A missing header keeps the exact
  // post-read size checks as the only gate.
  const rawDeclaredLength = request.headers.get("content-length");
  if (rawDeclaredLength !== null) {
    const declaredLength = Number(rawDeclaredLength);
    if (
      !Number.isInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > MAX_BODY_BYTES
    ) {
      return NextResponse.json(
        { error: "Imagem muito grande (max 4MB)" },
        { status: 413 },
      );
    }
  }

  // Paid AI call: the per-minute token and the daily budget are spent before
  // any body byte is read.
  try {
    await Promise.all([
      enforceRateLimit("receipt.ocr", userId),
      enforceAiBudget(userId),
    ]);
  } catch (error) {
    if (error instanceof AppError && error.code === "ACCOUNT_DELETED") {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof AppError && error.code === "RATE_LIMIT_EXCEEDED") {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    if (!(error instanceof AppError && error.code === "RATE_LIMIT_UNAVAILABLE")) {
      console.error("[receipt/ocr] unexpected rate-limit failure:", error);
    }
    return NextResponse.json(
      { error: "Serviço temporariamente indisponível" },
      { status: 503 },
    );
  }

  // Decode the multipart form or JSON body
  const contentType = request.headers.get("content-type") ?? "";
  let imageBase64: string;
  let mimeType: string;

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("image");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Campo 'image' obrigatorio" },
        { status: 400 },
      );
    }
    if (file.size > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "Imagem muito grande (max 4MB)" },
        { status: 413 },
      );
    }
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const detected = detectImageMimeType(bytes);
    if (!detected) {
      return NextResponse.json(
        { error: UNSUPPORTED_IMAGE_MESSAGE },
        { status: 415 },
      );
    }
    mimeType = detected;
    imageBase64 = Buffer.from(bytes).toString("base64");
  } else {
    // JSON body: { image: base64string }. The caller's mimeType claim is
    // ignored; Gemini receives only the type detected from magic bytes.
    const body = await request.json();
    if (!body.image || typeof body.image !== "string") {
      return NextResponse.json(
        { error: "Campo 'image' (base64) obrigatorio" },
        { status: 400 },
      );
    }
    const rawBytes = Buffer.from(body.image, "base64");
    if (rawBytes.length > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "Imagem muito grande (max 4MB)" },
        { status: 413 },
      );
    }
    const detected = detectImageMimeType(rawBytes);
    if (!detected) {
      return NextResponse.json(
        { error: UNSUPPORTED_IMAGE_MESSAGE },
        { status: 415 },
      );
    }
    imageBase64 = body.image;
    mimeType = detected;
  }

  try {
    const result = await parseReceiptImage(imageBase64, mimeType, apiKey);
    return NextResponse.json(result);
  } catch (error) {
    const failure = classifyLlmFailure(error);
    if (failure.code !== "LLM_TIMEOUT") {
      // Logged server-side only: provider text must never reach the client.
      console.error(`[receipt/ocr] ${failure.code}:`, error);
    }
    return NextResponse.json(
      {
        error: LLM_FAILURE_MESSAGE[failure.code],
        code: failure.code,
        retryable: failure.retryable,
        timeout: failure.code === "LLM_TIMEOUT",
      },
      { status: failure.status },
    );
  }
}
