import "server-only";

import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { encryptPixKey } from "@/lib/crypto";
import { resolveAuthProfile } from "@/lib/auth";
import { maskPixKey, validatePixKey } from "@/lib/pix";
import { createClient } from "@/lib/supabase/server";
import { safeRedirect } from "@/lib/safe-redirect";
import type { PixKeyType } from "@/types";
import type { OnboardingActionResult } from "./types";

const PIX_KEY_TYPES: readonly PixKeyType[] = ["cpf", "email", "phone", "random"];

function isPixKeyType(value: string): value is PixKeyType {
  return PIX_KEY_TYPES.some((type) => type === value);
}
function retryableError(): OnboardingActionResult {
  return { error: "Não foi possível carregar sua conta. Tente novamente." };
}

function sessionError(): OnboardingActionResult {
  return { error: "Sessão expirada" };
}

export async function completeOnboarding(
  expectedUserId: string,
  destination: string,
  formData: FormData,
): Promise<OnboardingActionResult> {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return retryableError();
  }

  let userData: Awaited<ReturnType<typeof supabase.auth.getUser>>;
  try {
    userData = await supabase.auth.getUser();
  } catch (error) {
    return isAuthSessionMissingError(error) ? sessionError() : retryableError();
  }

  if (userData.error != null) {
    return isAuthSessionMissingError(userData.error) ? sessionError() : retryableError();
  }
  if (userData.data.user == null || userData.data.user.id !== expectedUserId) {
    return sessionError();
  }

  let profile: Awaited<ReturnType<typeof resolveAuthProfile>>;
  try {
    profile = await resolveAuthProfile();
  } catch {
    return retryableError();
  }
  if (profile.kind === "unauthenticated") return sessionError();
  if (profile.kind !== "ok") return retryableError();
  if (profile.me.id !== expectedUserId) return sessionError();
  if (profile.me.onboarded) redirect(safeRedirect(destination));
  const handleValue = formData.get("handle");
  const nameValue = formData.get("name");
  const pixKeyValue = formData.get("pixKey");
  const pixKeyTypeValue = formData.get("pixKeyType");

  if (
    typeof handleValue !== "string" ||
    typeof nameValue !== "string" ||
    typeof pixKeyValue !== "string" ||
    typeof pixKeyTypeValue !== "string" ||
    handleValue.trim() === "" ||
    nameValue.trim() === "" ||
    pixKeyValue.trim() === ""
  ) {
    return { error: "Dados incompletos" };
  }

  const handle = handleValue.trim().toLowerCase();
  const name = nameValue.trim();
  const pixKey = pixKeyValue.trim();
  if (!/^[a-z0-9_]{3,30}$/.test(handle)) {
    return { error: "Handle inválido. Use 3 a 30 caracteres: letras, números e sublinhados." };
  }
  if (name.length > 80) return { error: "Nome inválido." };
  if (!isPixKeyType(pixKeyTypeValue)) {
    return { error: "Tipo de chave Pix inválido." };
  }
  if (!validatePixKey(pixKey, pixKeyTypeValue)) {
    return { error: "Chave Pix inválida para o tipo selecionado" };
  }

  const { error } = await supabase.rpc("complete_onboarding", {
    p_handle: handle,
    p_name: name,
    p_pix_key_encrypted: encryptPixKey(pixKey),
    p_pix_key_hint: maskPixKey(pixKey),
    p_pix_key_type: pixKeyTypeValue,
  });

  if (error != null) {
    if (error.message === "handle_taken") {
      return { error: "Handle já em uso. Escolha outro." };
    }
    if (error.message === "invalid_handle") {
      return { error: "Handle inválido. Use 3 a 30 caracteres: letras, números e sublinhados." };
    }
    return { error: "Não foi possível salvar sua conta. Tente novamente." };
  }

  redirect(safeRedirect(destination));
}
