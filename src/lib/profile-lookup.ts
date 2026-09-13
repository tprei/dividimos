import "server-only";
import { AppError } from "@/lib/errors";
import { decodeUserProfileOrNull } from "@/lib/ledger/decode";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/ledger";

/**
 * The single server-side boundary for profile lookups: it authenticates the
 * caller from cookie-bound claims (never from input), spends the
 * users.lookup rate-limit token, and only then reads the profile through
 * the service role. Since 20260913010070 no browser role may execute
 * lookup_user_by_handle directly, so every in-process consumer must go
 * through here; nothing in this module caches or accepts a caller id from
 * the request.
 *
 * Failures are typed AppErrors: AUTH_UNAUTHORIZED (401) for a missing or
 * invalid session, USER_INVALID_HANDLE (400) for an empty handle,
 * RATE_LIMIT_EXCEEDED (429) for a saturated bucket, and 5xx for a limiter
 * or backing-RPC failure — fail closed, never null. `null` means exactly
 * one thing: no onboarded profile owns the handle.
 */
export async function lookupProfile(handle: string): Promise<UserProfile | null> {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData) {
    throw new AppError("AUTH_UNAUTHORIZED", "Não autenticado");
  }
  const userId = claimsData.claims.sub;

  const normalized = handle.toLowerCase().trim();
  if (!normalized) {
    throw new AppError("USER_INVALID_HANDLE", "Handle obrigatorio");
  }

  try {
    await enforceRateLimit("users.lookup", userId);
  } catch (error) {
    if (error instanceof AppError && error.code === "RATE_LIMIT_EXCEEDED") {
      throw error;
    }
    if (!(error instanceof AppError && error.code === "RATE_LIMIT_UNAVAILABLE")) {
      console.error("[profile-lookup] unexpected rate-limit failure:", error);
    }
    throw new AppError("RATE_LIMIT_UNAVAILABLE", "Serviço temporariamente indisponível", {
      cause: error instanceof Error ? error : undefined,
    });
  }

  const { data: raw, error: rpcError } = await createAdminClient().rpc(
    "lookup_user_by_handle",
    { p_handle: normalized },
  );
  if (rpcError) {
    console.error("[profile-lookup] lookup_user_by_handle RPC error:", rpcError.message);
    throw new AppError("EXTERNAL_SERVICE_ERROR", "Serviço temporariamente indisponível", {
      statusCode: 503,
    });
  }

  const decoded = decodeUserProfileOrNull(raw);
  if (!decoded.ok) {
    throw new AppError("INTERNAL_ERROR", "Resposta de perfil inválida", {
      statusCode: 500,
      context: { issue: decoded.issue },
    });
  }
  return decoded.value;
}

/**
 * Maps a lookupProfile failure to the exact response body/status the
 * /api/users/lookup route has always published. Returns null for errors
 * that are not part of the lookup contract, so a route can let them
 * surface as real 500s instead of disguising them.
 */
export function lookupFailureResponse(
  error: unknown,
): { status: number; body: { error: string } } | null {
  if (!(error instanceof AppError)) return null;
  switch (error.code) {
    case "AUTH_UNAUTHORIZED":
      return { status: 401, body: { error: "Não autenticado" } };
    case "USER_INVALID_HANDLE":
      return { status: 400, body: { error: "Handle obrigatorio" } };
    case "RATE_LIMIT_EXCEEDED":
      return {
        status: 429,
        body: { error: "Muitas requisições. Tente novamente em alguns segundos." },
      };
    default:
      return { status: 503, body: { error: "Serviço temporariamente indisponível" } };
  }
}
