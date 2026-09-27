import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  decodeAccountDeletionGroups,
  type AccountDeletionResponse,
} from "@/lib/account-deletion";

function jsonError(
  body: AccountDeletionResponse,
  status: number,
): NextResponse<AccountDeletionResponse> {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
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
