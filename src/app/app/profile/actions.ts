"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAuthProfile } from "@/lib/auth";
import { encryptPixKey } from "@/lib/crypto";
import { maskPixKey, validatePixKey } from "@/lib/pix";
import type { PixKeyType } from "@/types";

export interface UpdatePixKeySuccess {
  pixKeyType: PixKeyType;
  pixKeyHint: string;
}

export interface UpdatePixKeyError {
  error: string;
}

export type UpdatePixKeyResult = UpdatePixKeySuccess | UpdatePixKeyError;

/**
 * Save the caller's Pix key.
 *
 * `expectedUserId` is untrusted evidence of which account the client believed
 * it was editing; a client that changed accounts mid-edit will send a stale
 * one. Fresh server auth decides, and the comparison happens before any
 * validation, encryption, logging, or storage work so a mismatched call does
 * nothing at all. The row written is always the verified current user.
 */
export async function updatePixKey(
  expectedUserId: string,
  formData: FormData,
): Promise<UpdatePixKeyResult> {
  const profile = await resolveAuthProfile();

  if (profile.kind === "unauthenticated") {
    return { error: "Sessao expirada" };
  }
  if (profile.kind !== "ok") {
    return { error: "Nao foi possivel carregar sua conta. Tente novamente." };
  }
  if (profile.me.id !== expectedUserId) {
    return { error: "Sessao expirada" };
  }
  const user = profile.me;

  const pixKey = formData.get("pixKey") as string;
  const pixKeyType = formData.get("pixKeyType") as PixKeyType;

  if (!pixKey || !pixKeyType) {
    return { error: "Dados incompletos" };
  }

  if (!validatePixKey(pixKey, pixKeyType)) {
    return { error: "Chave Pix invalida para o tipo selecionado" };
  }

  const encrypted = encryptPixKey(pixKey);
  const hint = maskPixKey(pixKey);

  const admin = createAdminClient();
  const { error } = await admin
    .from("users")
    .update({
      pix_key_encrypted: encrypted,
      pix_key_hint: hint,
      pix_key_type: pixKeyType,
    })
    .eq("id", user.id);

  if (error) {
    console.error("[profile] Failed to update Pix key:", error);
    return { error: "Erro ao salvar. Tente novamente." };
  }

  return { pixKeyType, pixKeyHint: hint };
}
