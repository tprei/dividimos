import type { AccountDeletionResponse } from "@/lib/account-deletion";
import { decodeAccountDeletionResponse } from "@/lib/account-deletion";
import { getSupabase } from "./client";

async function postDeletion(): Promise<AccountDeletionResponse | null> {
  const response = await fetch("/api/account/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmation: "EXCLUIR" }),
  });
  const raw: unknown = await response.json();
  return decodeAccountDeletionResponse(raw);
}

async function currentSessionUserId(): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export async function deleteAccount(): Promise<AccountDeletionResponse> {
  const decoded = await postDeletion();
  if (!decoded) return { ok: false, code: "deletion_failed", retryable: true };
  if (decoded.ok) {
    const sessionUserId = await currentSessionUserId();
    if (sessionUserId !== decoded.userId) {
      return { ok: false, code: "deletion_failed", retryable: true };
    }
  }
  return decoded;
}

export async function finishPendingAccountDeletion(): Promise<AccountDeletionResponse> {
  const decoded = await postDeletion();
  if (!decoded) return { ok: false, code: "deletion_failed", retryable: true };
  if (decoded.ok) {
    const sessionUserId = await currentSessionUserId();
    if (sessionUserId !== decoded.userId) {
      return { ok: false, code: "deletion_failed", retryable: true };
    }
  }
  return decoded;
}
