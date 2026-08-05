"use server";

import { createClient } from "@/lib/supabase/server";
import { encryptPixKey } from "@/lib/crypto";
import { maskPixKey, validatePixKey } from "@/lib/pix";
import { isValidHandle } from "@/lib/onboarding";
import type { PixKeyType } from "@/types";

export type CompleteOnboardingResult =
  | { kind: "completed"; redirectTo: string }
  | {
      kind: "rejected";
      reason:
        | "unauthenticated"
        | "identity_changed"
        | "invalid_name"
        | "invalid_handle"
        | "invalid_pix_type"
        | "invalid_pix_key"
        | "handle_taken"
        | "profile_unavailable"
        | "save_failed";
    };

function isPixKeyType(value: unknown): value is PixKeyType {
  return (
    value === "cpf" ||
    value === "email" ||
    value === "phone" ||
    value === "random"
  );
}

/**
 * Server-authoritative onboarding completion.
 *
 * The `expectedUserId`/`redirectTo` closure values are NOT treated as
 * authorization — this helper re-authenticates against the live session before
 * touching any FormData field, and the single conditional update is fenced by
 * both `id = expectedUserId` and `onboarded = false`. No redirect, RPC, upsert,
 * or admin/service-role client is used here.
 */
export async function completeOnboarding(
  expectedUserId: string,
  redirectTo: string,
  formData: FormData,
): Promise<CompleteOnboardingResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return { kind: "rejected", reason: "unauthenticated" };
  }
  if (user.id !== expectedUserId) {
    return { kind: "rejected", reason: "identity_changed" };
  }

  const nameRaw = formData.get("name");
  const handleRaw = formData.get("handle");
  const pixKeyTypeRaw = formData.get("pixKeyType");
  const pixKeyRaw = formData.get("pixKey");

  if (typeof nameRaw !== "string") {
    return { kind: "rejected", reason: "invalid_name" };
  }
  const trimmedName = nameRaw.trim();
  if (trimmedName === "") {
    return { kind: "rejected", reason: "invalid_name" };
  }

  if (typeof handleRaw !== "string") {
    return { kind: "rejected", reason: "invalid_handle" };
  }
  const canonicalHandle = handleRaw.trim().toLowerCase();
  if (!isValidHandle(canonicalHandle)) {
    return { kind: "rejected", reason: "invalid_handle" };
  }

  if (!isPixKeyType(pixKeyTypeRaw)) {
    return { kind: "rejected", reason: "invalid_pix_type" };
  }

  if (typeof pixKeyRaw !== "string") {
    return { kind: "rejected", reason: "invalid_pix_key" };
  }
  if (!validatePixKey(pixKeyRaw, pixKeyTypeRaw)) {
    return { kind: "rejected", reason: "invalid_pix_key" };
  }

  const encrypted = encryptPixKey(pixKeyRaw);
  const hint = maskPixKey(pixKeyRaw);

  const { data, error: updateError } = await supabase
    .from("users")
    .update({
      name: trimmedName,
      handle: canonicalHandle,
      pix_key_encrypted: encrypted,
      pix_key_hint: hint,
      pix_key_type: pixKeyTypeRaw,
      onboarded: true,
    })
    .eq("id", expectedUserId)
    .eq("onboarded", false)
    .select("id");

  if (updateError?.code === "23505") {
    return { kind: "rejected", reason: "handle_taken" };
  }
  if (updateError) {
    return { kind: "rejected", reason: "save_failed" };
  }
  if (Array.isArray(data) && data.length === 1) {
    return { kind: "completed", redirectTo };
  }

  const { data: row, error: readError } = await supabase
    .from("users")
    .select("onboarded")
    .eq("id", expectedUserId)
    .maybeSingle();

  if (readError) {
    return { kind: "rejected", reason: "save_failed" };
  }
  if (!row) {
    return { kind: "rejected", reason: "profile_unavailable" };
  }
  if (row.onboarded === true) {
    return { kind: "completed", redirectTo };
  }
  return { kind: "rejected", reason: "save_failed" };
}
