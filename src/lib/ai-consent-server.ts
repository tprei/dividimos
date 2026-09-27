import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { CURRENT_AI_CONSENT_VERSION } from "@/lib/ai-consent";
import { AppError } from "@/lib/errors";

/**
 * Identity failures from the consent RPC are terminal, not retryable: they
 * answer with the SQL domain code and a status the client treats as final.
 */
const IDENTITY_FAILURES: Record<string, { statusCode: number; message: string }> = {
  unauthenticated: { statusCode: 401, message: "Sua sessão expirou. É preciso entrar de novo." },
  user_not_found: { statusCode: 401, message: "Não achamos esse usuário." },
  account_deleted: { statusCode: 403, message: "Essa conta foi excluída." },
};

/**
 * Fails closed unless the authenticated caller holds the current AI consent.
 * The route's authenticated Supabase client supplies identity; consent stored
 * on another account can never authorize this request.
 */
export async function enforceAiConsent(
  supabase: SupabaseClient<Database>,
): Promise<void> {
  try {
    const { error } = await supabase.rpc("require_ai_consent", {
      p_version: CURRENT_AI_CONSENT_VERSION,
    });
    if (!error) return;
    if (error.code === "P0001" && error.message === "ai_consent_required") {
      throw new AppError(
        "AI_CONSENT_REQUIRED",
        "Para usar IA, permita o envio dos dados. Você pode continuar sem IA.",
        { statusCode: 403 },
      );
    }
    if (error.code === "P0001" && error.message in IDENTITY_FAILURES) {
      const identity = IDENTITY_FAILURES[error.message];
      throw new AppError("AI_CONSENT_IDENTITY", identity.message, {
        statusCode: identity.statusCode,
        context: { machineCode: error.message },
      });
    }
    throw new AppError(
      "AI_CONSENT_UNAVAILABLE",
      "Não foi possível verificar sua permissão de IA. Tente novamente.",
      { statusCode: 503 },
    );
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "AI_CONSENT_UNAVAILABLE",
      "Não foi possível verificar sua permissão de IA. Tente novamente.",
      { statusCode: 503 },
    );
  }
}
