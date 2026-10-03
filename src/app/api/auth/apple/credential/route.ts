import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptPixKey as encryptToken } from "@/lib/crypto";
import { enforceRateLimit } from "@/lib/rate-limit";
import { AppError } from "@/lib/errors";
import {
  AppleSignInError,
  exchangeAppleAuthorizationCode,
  readAppleServerConfig,
  revokeAppleAuthorization,
} from "@/lib/apple-sign-in";
import type { AppleCredentialResponse } from "@/lib/apple-credential";

// Apple authorization codes are short URL-safe strings; the ceiling only
// exists so abuse never reaches Apple or the database.
const AUTHORIZATION_CODE_MAX_LENGTH = 1024;
const AUTHORIZATION_CODE_PATTERN = /^[A-Za-z0-9._~-]+$/;

function jsonResponse(
  body: AppleCredentialResponse,
  status: number,
): NextResponse<AppleCredentialResponse> {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function POST(request: Request): Promise<NextResponse<AppleCredentialResponse>> {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return jsonResponse({ ok: false, code: "apple_unavailable" }, 503);
  }

  let claimsResult;
  try {
    claimsResult = await supabase.auth.getClaims();
  } catch {
    return jsonResponse({ ok: false, code: "apple_unavailable" }, 503);
  }
  if (claimsResult.error != null || claimsResult.data == null) {
    return jsonResponse({ ok: false, code: "unauthenticated" }, 401);
  }
  const subject: unknown = claimsResult.data.claims.sub;
  if (typeof subject !== "string" || subject === "") {
    return jsonResponse({ ok: false, code: "unauthenticated" }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, code: "invalid_argument" }, 400);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ ok: false, code: "invalid_argument" }, 400);
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).length !== 1) {
    return jsonResponse({ ok: false, code: "invalid_argument" }, 400);
  }
  const authorizationCode = record.authorizationCode;
  if (
    typeof authorizationCode !== "string" ||
    authorizationCode === "" ||
    authorizationCode.length > AUTHORIZATION_CODE_MAX_LENGTH ||
    !AUTHORIZATION_CODE_PATTERN.test(authorizationCode)
  ) {
    return jsonResponse({ ok: false, code: "invalid_argument" }, 400);
  }

  try {
    await enforceRateLimit("apple.credential", subject);
  } catch (error) {
    if (error instanceof AppError && error.code === "RATE_LIMIT_EXCEEDED") {
      return jsonResponse({ ok: false, code: "apple_rate_limited" }, 429);
    }
    if (!(error instanceof AppError && error.code === "RATE_LIMIT_UNAVAILABLE")) {
      console.error("[apple/credential] unexpected rate-limit failure:", error);
    }
    return jsonResponse({ ok: false, code: "apple_unavailable" }, 503);
  }

  const config = readAppleServerConfig();
  if (config === null) {
    console.error("[apple/credential] APPLE_TEAM_ID/APPLE_SIGN_IN_KEY_ID/APPLE_SIGN_IN_PRIVATE_KEY missing");
    return jsonResponse({ ok: false, code: "apple_unavailable" }, 503);
  }

  const admin = createAdminClient();
  const fetched = await admin.auth.admin.getUserById(subject);
  if (fetched.error != null || fetched.data?.user == null) {
    console.error("[apple/credential] user lookup failed:", fetched.error?.message ?? "no user");
    return jsonResponse({ ok: false, code: "apple_unavailable" }, 503);
  }
  let linkedAppleSubject: string | null = null;
  for (const identity of fetched.data.user.identities ?? []) {
    if (identity.provider !== "apple") continue;
    const candidate = identity.identity_data?.sub;
    if (typeof candidate === "string" && candidate !== "") {
      linkedAppleSubject = candidate;
      break;
    }
    if (typeof identity.id === "string" && identity.id !== "") {
      linkedAppleSubject = identity.id;
      break;
    }
  }
  if (linkedAppleSubject === null) {
    return jsonResponse({ ok: false, code: "apple_identity_mismatch" }, 403);
  }

  let exchange;
  try {
    exchange = await exchangeAppleAuthorizationCode(authorizationCode, linkedAppleSubject, config);
  } catch (thrown) {
    if (thrown instanceof AppleSignInError) {
      if (thrown.reason === "identity_mismatch") {
        console.error("[apple/credential] subject mismatch:", thrown.message);
        return jsonResponse({ ok: false, code: "apple_identity_mismatch" }, 403);
      }
      if (thrown.reason === "code_rejected") {
        return jsonResponse({ ok: false, code: "apple_code_rejected" }, 400);
      }
      const cause = thrown.cause instanceof Error ? ` (${thrown.cause.name}: ${thrown.cause.message})` : "";
      console.error(`[apple/credential] exchange failed: ${thrown.message}${cause}`);
    } else {
      // A broken signing key is a configuration failure, not a client error.
      console.error(
        "[apple/credential] exchange failed:",
        thrown instanceof Error ? thrown.message : "unknown error",
      );
    }
    return jsonResponse({ ok: false, code: "apple_unavailable" }, 503);
  }

  try {
    const { error: storeError } = await admin.rpc("store_apple_credential", {
      p_user_id: subject,
      p_apple_subject: exchange.appleSubject,
      p_refresh_token_encrypted: encryptToken(exchange.refreshToken),
    });
    if (storeError) {
      if (storeError.message === "account_deleted") {
        // The account was deleted while this code was in flight; the token
        // just issued would otherwise outlive the account unrevoked.
        const outcome = await revokeAppleAuthorization(exchange.refreshToken, config);
        if (outcome === "unavailable") {
          console.error("[apple/credential] could not revoke token issued after deletion");
        }
        return jsonResponse({ ok: false, code: "account_deleted" }, 403);
      }
      console.error("[apple/credential] store failed:", storeError.message);
      return jsonResponse({ ok: false, code: "apple_unavailable" }, 503);
    }
    return jsonResponse({ ok: true }, 200);
  } catch (thrown) {
    console.error(
      "[apple/credential] store failed:",
      thrown instanceof Error ? thrown.message : "unknown error",
    );
    return jsonResponse({ ok: false, code: "apple_unavailable" }, 503);
  }
}
