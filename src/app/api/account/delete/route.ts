import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptPixKey as decryptToken } from "@/lib/crypto";
import { readAppleServerConfig, revokeAppleAuthorization } from "@/lib/apple-sign-in";
import {
  decodeAccountDeletionGroups,
  type AccountDeletionResponse,
} from "@/lib/account-deletion";
import type { Database } from "@/types/database";

function jsonError(
  body: AccountDeletionResponse,
  status: number,
): NextResponse<AccountDeletionResponse> {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/**
 * Revokes the stored Apple authorization and drops the credential row once
 * Apple gives a definitive outcome (HTTP 200, or invalid_grant for a token
 * Apple no longer knows). The row deliberately outlives the delete_account
 * tombstone: it holds the only refresh token that can revoke, so a retried
 * deletion reaches this step again. Any failure here stops the deletion with
 * a retryable response instead of orphaning a live Apple authorization.
 */
async function revokeAppleCredentialForDeletion(
  admin: SupabaseClient<Database>,
  userId: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc("read_apple_credential_for_revocation", {
    p_user_id: userId,
  });
  if (error) {
    console.error("[account/delete] apple credential read failed:", error.message);
    return false;
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    if (data !== null) {
      console.error("[account/delete] apple credential payload malformed");
      return false;
    }
    return true;
  }
  const stored = data as Record<string, unknown>;
  const encrypted = stored.refreshTokenEncrypted;
  if (typeof encrypted !== "string" || encrypted === "") {
    console.error("[account/delete] apple credential payload malformed");
    return false;
  }
  const config = readAppleServerConfig();
  if (config === null) {
    console.error(
      "[account/delete] APPLE_TEAM_ID/APPLE_SIGN_IN_KEY_ID/APPLE_SIGN_IN_PRIVATE_KEY missing; cannot revoke Apple access",
    );
    return false;
  }

  let refreshToken: string;
  try {
    refreshToken = decryptToken(encrypted);
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : "unknown error";
    // Only a ciphertext that fails GCM authentication is unrecoverable (the
    // encryption key changed since it was stored); a missing or malformed key
    // is configuration and must keep the token for a retry.
    if (!/unable to authenticate data/i.test(message)) {
      console.error("[account/delete] apple refresh token not decryptable now:", message);
      return false;
    }
    console.error("[account/delete] apple refresh token undecryptable, dropping row:", message);
    return deleteAppleCredential(admin, userId);
  }

  const outcome = await revokeAppleAuthorization(refreshToken, config);
  if (outcome === "unavailable") {
    console.error("[account/delete] apple revoke unavailable");
    return false;
  }
  return deleteAppleCredential(admin, userId);
}

async function deleteAppleCredential(
  admin: SupabaseClient<Database>,
  userId: string,
): Promise<boolean> {
  const { error } = await admin.rpc("delete_apple_credential", { p_user_id: userId });
  if (error) {
    console.error("[account/delete] apple credential delete failed:", error.message);
    return false;
  }
  return true;
}

type AppleReadiness = "ready" | "reauthorization_required" | "unavailable";

/**
 * An account with a linked Apple identity but no stored refresh token (the
 * upload after sign-in failed) could be deleted without revoking Apple's
 * authorization. Such a deletion is refused before anything commits, so the
 * app can collect a fresh Apple authorization code first. An already
 * tombstoned account skips this: its row, if any, is handled by the retry.
 */
async function appleRevocationReadiness(
  admin: SupabaseClient<Database>,
  userId: string,
): Promise<AppleReadiness> {
  const profile = await admin.from("users").select("deleted_at").eq("id", userId).maybeSingle();
  if (profile.error) {
    console.error("[account/delete] profile read failed:", profile.error.message);
    return "unavailable";
  }
  if (profile.data?.deleted_at) return "ready";

  const authUser = await admin.auth.admin.getUserById(userId);
  if (authUser.error) {
    console.error("[account/delete] auth user read failed:", authUser.error.message);
    return "unavailable";
  }
  const hasApple = (authUser.data.user.identities ?? []).some((identity) => identity.provider === "apple");
  if (!hasApple) return "ready";

  const credential = await admin.rpc("read_apple_credential_for_revocation", { p_user_id: userId });
  if (credential.error) {
    console.error("[account/delete] apple credential read failed:", credential.error.message);
    return "unavailable";
  }
  return credential.data === null ? "reauthorization_required" : "ready";
}

export async function POST(request: Request): Promise<NextResponse<AccountDeletionResponse>> {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return jsonError({ ok: false, code: "deletion_failed", retryable: true }, 503);
  }

  let claimsResult;
  try {
    claimsResult = await supabase.auth.getClaims();
  } catch {
    return jsonError({ ok: false, code: "deletion_failed", retryable: true }, 503);
  }
  if (claimsResult.error != null) {
    return jsonError({ ok: false, code: "unauthenticated" }, 401);
  }
  const claimsData = claimsResult.data;
  if (claimsData == null) {
    return jsonError({ ok: false, code: "unauthenticated" }, 401);
  }
  const subject: unknown = claimsData.claims.sub;
  if (typeof subject !== "string" || subject === "") {
    return jsonError({ ok: false, code: "unauthenticated" }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError({ ok: false, code: "invalid_argument" }, 400);
  }
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    (body as Record<string, unknown>).confirmation !== "EXCLUIR"
  ) {
    return jsonError({ ok: false, code: "invalid_argument" }, 400);
  }

  const admin = createAdminClient();
  const readiness = await appleRevocationReadiness(admin, subject);
  if (readiness === "unavailable") {
    return jsonError({ ok: false, code: "deletion_failed", retryable: true }, 503);
  }
  if (readiness === "reauthorization_required") {
    return jsonError({ ok: false, code: "apple_reauthorization_required" }, 409);
  }
  const { error: rpcError } = await admin.rpc("delete_account", { p_user_id: subject });
  if (rpcError) {
    if (rpcError.message === "outstanding_balance") {
      let groups: unknown = null;
      try {
        groups = JSON.parse(rpcError.details ?? "").groups;
      } catch {
        groups = null;
      }
      const decoded = decodeAccountDeletionGroups(groups);
      if (!decoded) {
        console.error("[account/delete] refusal details malformed:", rpcError.message);
        return jsonError({ ok: false, code: "deletion_failed", retryable: true }, 500);
      }
      return jsonError({ ok: false, code: "outstanding_balance", groups: decoded }, 409);
    }
    console.error("[account/delete] rpc failed:", rpcError.message);
    return jsonError({ ok: false, code: "deletion_failed", retryable: true }, 503);
  }

  if (!(await revokeAppleCredentialForDeletion(admin, subject))) {
    return jsonError(
      { ok: false, code: "apple_revoke_failed", retryable: true, userId: subject },
      503,
    );
  }

  let authDelete;
  try {
    authDelete = await admin.auth.admin.deleteUser(subject, true);
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : "auth delete transport failed";
    console.error("[account/delete] auth delete failed:", message);
    return jsonError(
      { ok: false, code: "auth_delete_failed", retryable: true, userId: subject },
      503,
    );
  }
  if (authDelete.error) {
    console.error("[account/delete] auth delete failed:", authDelete.error.message);
    return jsonError(
      { ok: false, code: "auth_delete_failed", retryable: true, userId: subject },
      503,
    );
  }

  return jsonError({ ok: true, userId: subject }, 200);
}
