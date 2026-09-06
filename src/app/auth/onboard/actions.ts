"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptPixKey } from "@/lib/crypto";
import { maskPixKey, validatePixKey } from "@/lib/pix";
import type { PixKeyType } from "@/types";
import { redirect } from "next/navigation";
import { safeRedirect } from "@/lib/safe-redirect";

export async function completeOnboarding(formData: FormData) {
  const handle = formData.get("handle") as string;
  const pixKey = formData.get("pixKey") as string;
  const pixKeyType = formData.get("pixKeyType") as string;
  const name = formData.get("name") as string | null;
  const next = safeRedirect(formData.get("next") as string | null);

  if (!handle || !pixKey || !pixKeyType) {
    return { error: "Dados incompletos" };
  }

  if (!validatePixKey(pixKey, pixKeyType as PixKeyType)) {
    return { error: "Chave Pix invalida para o tipo selecionado" };
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = !claimsError && claimsData?.claims?.sub ? (claimsData.claims.sub as string) : null;
  if (!userId) {
    return { error: "Sessao expirada" };
  }

  const encrypted = encryptPixKey(pixKey);
  const hint = maskPixKey(pixKey);

  const updates: Record<string, unknown> = {
    handle: handle.toLowerCase(),
    pix_key_encrypted: encrypted,
    pix_key_hint: hint,
    pix_key_type: pixKeyType,
    onboarded: true,
  };

  if (name?.trim()) {
    updates.name = name.trim();
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("users")
    .update(updates)
    .eq("id", userId);

  if (error) {
    if (error.code === "23505") {
      return { error: "Handle ja em uso. Escolha outro." };
    }
    console.error("[onboard] Failed to save profile:", error);
    return { error: "Erro ao salvar. Tente novamente." };
  }

  redirect(next);
}
