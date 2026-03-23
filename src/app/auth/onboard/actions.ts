"use server";

import { createClient } from "@/lib/supabase/server";
import { encryptPixKey } from "@/lib/crypto";
import { maskPixKey, validatePixKey } from "@/lib/pix";
import { redirect } from "next/navigation";

export async function completeOnboarding(formData: FormData) {
  const handle = formData.get("handle") as string;
  const pixKey = formData.get("pixKey") as string;
  const pixKeyType = formData.get("pixKeyType") as string;

  if (!handle || !pixKey || !pixKeyType) {
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
      handle: handle.toLowerCase(),
      pix_key_encrypted: encrypted,
      pix_key_hint: hint,
      pix_key_type: pixKeyType,
      onboarded: true,
    })
    .eq("id", user.id);

  if (error) {
    if (error.code === "23505") {
      return { error: "Handle ja em uso. Escolha outro." };
    }
    return { error: "Erro ao salvar. Tente novamente." };
  }

  redirect("/app");
}
