import { NextResponse } from "next/server";
import { classifyLlmFailure, LLM_FAILURE_MESSAGE } from "@/lib/llm-errors";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { AppError } from "@/lib/errors";
import { transcribeVoiceAudio } from "@/lib/voice-transcription";

export const runtime = "nodejs";
export const maxDuration = 15;

const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
/** Multipart framing (boundary + part headers) allowed on top of the audio. */
const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const MAX_MULTIPART_BYTES = MAX_AUDIO_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;
const NO_SPEECH_MESSAGE = "Não ouvi nada. Tente de novo.";

/** Container/codec MIME types accepted from the client recorder. */
const ALLOWED_AUDIO_TYPES: Record<string, true> = {
  "audio/mp4": true,
  "audio/webm": true,
  "audio/ogg": true,
  "audio/mpeg": true,
  "audio/aac": true,
  "audio/wav": true,
  "audio/x-m4a": true,
};

export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  const userId = claimsData.claims.sub;

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Transcrição de voz não configurada" },
      { status: 503 },
    );
  }

  try {
    await enforceRateLimit("voice.transcribe", userId);
  } catch (error) {
    if (error instanceof AppError && error.code === "RATE_LIMIT_EXCEEDED") {
      return NextResponse.json(
        { error: "Muitas requisições. Tente novamente em alguns segundos." },
        { status: 429 },
      );
    }
    if (!(error instanceof AppError && error.code === "RATE_LIMIT_UNAVAILABLE")) {
      console.error("[voice/transcribe] unexpected rate-limit failure:", error);
    }
    return NextResponse.json(
      { error: "Serviço temporariamente indisponível" },
      { status: 503 },
    );
  }

  // The multipart parser buffers the body without a bound, so the declared
  // length gates the read. A missing or unparseable length fails closed.
  const rawLength = request.headers.get("content-length");
  const declaredLength = rawLength === null ? Number.NaN : Number(rawLength);
  if (
    !Number.isInteger(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > MAX_MULTIPART_BYTES
  ) {
    return NextResponse.json(
      { error: "Áudio muito grande (max 2 MB)" },
      { status: 413 },
    );
  }

  let audio: File;
  try {
    const field = (await request.formData()).get("audio");
    if (!(field instanceof File)) {
      return NextResponse.json(
        { error: "Campo 'audio' obrigatório" },
        { status: 400 },
      );
    }
    audio = field;
  } catch {
    return NextResponse.json(
      { error: "Corpo da requisição inválido" },
      { status: 400 },
    );
  }

  // Browsers append codec parameters ("audio/mp4;codecs=..."); compare the
  // base type only.
  const mimeType = audio.type.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!ALLOWED_AUDIO_TYPES[mimeType]) {
    return NextResponse.json(
      { error: "Formato de áudio não suportado" },
      { status: 415 },
    );
  }

  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: "Áudio muito grande (max 2 MB)" },
      { status: 413 },
    );
  }

  try {
    const audioBase64 = Buffer.from(await audio.arrayBuffer()).toString("base64");
    const transcript = (
      await transcribeVoiceAudio({ audioBase64, mimeType, apiKey })
    ).trim();
    if (!transcript) {
      return NextResponse.json({ error: NO_SPEECH_MESSAGE }, { status: 422 });
    }
    return NextResponse.json({ transcript });
  } catch (error) {
    const failure = classifyLlmFailure(error);
    if (failure.code !== "LLM_TIMEOUT") {
      // Logged server-side only: provider text must never reach the client.
      console.error(`[voice/transcribe] ${failure.code}:`, error);
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
