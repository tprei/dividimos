import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseReceiptImage } from "@/lib/receipt-ocr";

export const runtime = "nodejs";
export const maxDuration = 15;

/** Max request body size: 4 MB (compressed JPEG should be well under this). */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  }

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
    const result = await parseReceiptImage(imageBase64, mimeType, apiKey);
    return NextResponse.json(result);
  } catch (error) {
    const isTimeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    const message = isTimeout
      ? "Não foi possível processar. Tente novamente ou adicione manualmente."
      : error instanceof Error
        ? error.message
        : "Erro ao processar imagem";
    return NextResponse.json(
      { error: message, timeout: isTimeout },
      { status: isTimeout ? 504 : 500 },
    );
  }
}
