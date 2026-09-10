import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { AppError } from "@/lib/errors";
import { classifyLlmFailure, LLM_FAILURE_MESSAGE } from "@/lib/llm-errors";
import {
  parseChatExpense,
  type MemberContext,
} from "@/lib/chat-expense-parser";

export const runtime = "nodejs";
export const maxDuration = 10;

/** Max text length to send to Gemini (roughly 500 words). */
const MAX_TEXT_LENGTH = 2000;

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
      { error: "Chat parser nao configurado" },
      { status: 503 },
    );
  }

  let text: string;
  let members: MemberContext[] | undefined;

  try {
    const body = await request.json();
    text = body.text;
    members = body.members;
  } catch {
    return NextResponse.json(
      { error: "Corpo da requisicao invalido" },
      { status: 400 },
    );
  }

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json(
      { error: "Campo 'text' obrigatorio" },
      { status: 400 },
    );
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json(
      { error: "Texto muito longo (max 2000 caracteres)" },
      { status: 413 },
    );
  }

  // Validate members array if provided
  if (members !== undefined) {
    if (!Array.isArray(members)) {
      return NextResponse.json(
        { error: "Campo 'members' deve ser um array" },
        { status: 400 },
      );
    }
    if (members.length > 100) {
      return NextResponse.json(
        { error: "Número de membros excede o limite permitido" },
        { status: 400 },
      );
    }
    for (const m of members) {
      if (
        typeof m !== "object" ||
        m === null ||
        typeof m.handle !== "string" ||
        typeof m.name !== "string"
      ) {
        return NextResponse.json(
          { error: "Cada membro deve ter 'handle' e 'name'" },
          { status: 400 },
        );
      }
      if (m.handle.length > 50 || m.name.length > 100) {
        return NextResponse.json(
          { error: "Campos de membro excedem o tamanho permitido" },
          { status: 400 },
        );
      }
    }
  }

  try {
    await enforceRateLimit("chat.parse", userId);
  } catch (error) {
    if (error instanceof AppError && error.code === "RATE_LIMIT_EXCEEDED") {
      return NextResponse.json(
        { error: "Muitas requisições. Tente novamente em alguns segundos." },
        { status: 429 },
      );
    }
    if (!(error instanceof AppError && error.code === "RATE_LIMIT_UNAVAILABLE")) {
      console.error("[chat/parse] unexpected rate-limit failure:", error);
    }
    return NextResponse.json(
      { error: "Serviço temporariamente indisponível" },
      { status: 503 },
    );
  }

  try {
    const result = await parseChatExpense(text.trim(), apiKey, members);
    return NextResponse.json(result);
  } catch (error) {
    const failure = classifyLlmFailure(error);
    if (failure.code !== "LLM_TIMEOUT") {
      // Logged server-side only: provider text must never reach the client.
      console.error(`[chat/parse] ${failure.code}:`, error);
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
