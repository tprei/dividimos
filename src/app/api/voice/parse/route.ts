import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  parseVoiceExpense,
  type MemberContext,
} from "@/lib/voice-expense-parser";

export const runtime = "nodejs";
export const maxDuration = 10;

/** Max text length to send to Gemini (roughly 500 words). */
const MAX_TEXT_LENGTH = 2000;

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
      { error: "Reconhecimento de voz nao configurado" },
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
    for (const m of members) {
      if (
        typeof m.handle !== "string" ||
        typeof m.name !== "string"
      ) {
        return NextResponse.json(
          { error: "Cada membro deve ter 'handle' e 'name'" },
          { status: 400 },
        );
      }
    }
  }

  try {
    const result = await parseVoiceExpense(text.trim(), apiKey, members);
    return NextResponse.json(result);
  } catch (error) {
    const isTimeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    const message = isTimeout
      ? "Não foi possível processar. Tente novamente."
      : error instanceof Error
        ? error.message
        : "Erro ao processar comando de voz";
    return NextResponse.json(
      { error: message, timeout: isTimeout },
      { status: isTimeout ? 504 : 500 },
    );
  }
}
