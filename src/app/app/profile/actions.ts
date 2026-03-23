"use server";

import { createClient } from "@/lib/supabase/server";
import { encryptPixKey } from "@/lib/crypto";
import { maskPixKey, validatePixKey } from "@/lib/pix";

export async function updatePixKey(formData: FormData) {
  const pixKey = formData.get("pixKey") as string;
  const pixKeyType = formData.get("pixKeyType") as string;

  if (!pixKey || !pixKeyType) {
    return { error: "Dados incompletos" };
  }

  if (!validatePixKey(pixKey)) {
    return { error: "Chave Pix invalida" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Sessao expirada" };
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
    return { error: `Erro ao salvar: ${error.message}` };
  }

  return { success: true, hint };
}
