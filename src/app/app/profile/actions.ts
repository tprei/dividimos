"use server";

import { createClient } from "@/lib/supabase/server";
import { encryptPixKey } from "@/lib/crypto";
import { maskPixKey, validatePixKey } from "@/lib/pix";
import type { PixKeyType } from "@/types";

/**
 * Save the caller's Pix key.
 *
 * `expectedUserId` is untrusted evidence of which account the client believed
 * it was editing; a client that changed accounts mid-edit will send a stale
 * one. Fresh server auth decides, and the comparison happens before any
 * validation, encryption, logging, or storage work so a mismatched call does
 * nothing at all. The row written is always the verified current user.
 */
export async function updatePixKey(expectedUserId: string, formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.id !== expectedUserId) {
    return { error: "Sessao expirada" };
  }

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

  const { error } = await supabase
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

  return { success: true, hint };
}
