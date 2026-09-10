import { NextResponse } from "next/server";
import { classifyLlmFailure, LLM_FAILURE_MESSAGE } from "@/lib/llm-errors";
import { createClient } from "@/lib/supabase/server";
import { parseReceiptImage } from "@/lib/receipt-ocr";
import { enforceRateLimit } from "@/lib/rate-limit";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 15;

/** Max request body size: 4 MB (compressed JPEG should be well under this). */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

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

  // Parse multipart form or JSON body
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
    mimeType = file.type || "image/jpeg";
    const buffer = await file.arrayBuffer();
    imageBase64 = Buffer.from(buffer).toString("base64");
  } else {
    // JSON body: { image: base64string, mimeType?: string }
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
    imageBase64 = body.image;
    mimeType = body.mimeType ?? "image/jpeg";
  }

  try {
    await enforceRateLimit("receipt.ocr", userId);
  } catch (error) {
    if (error instanceof AppError && error.code === "RATE_LIMIT_EXCEEDED") {
      return NextResponse.json(
        { error: "Muitas requisições. Tente novamente em alguns segundos." },
        { status: 429 },
      );
    }
    if (!(error instanceof AppError && error.code === "RATE_LIMIT_UNAVAILABLE")) {
      console.error("[receipt/ocr] unexpected rate-limit failure:", error);
    }
    return NextResponse.json(
      { error: "Serviço temporariamente indisponível" },
      { status: 503 },
    );
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
