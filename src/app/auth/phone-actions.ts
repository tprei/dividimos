"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { safeRedirect } from "@/lib/safe-redirect";
import { normalizePhone, phoneToTestEmail, redirectForProfile } from "./phone-utils";

async function createSessionForPhone(
  normalized: string,
  safePath: string,
): Promise<{ success: true; redirect: string } | { error: string }> {
  const admin = createAdminClient();
  const supabase = await createClient();
  const testEmail = phoneToTestEmail(normalized);

  const { data: existingProfile } = await admin
    .from("users")
    .select("id")
    .eq("email", testEmail)
    .maybeSingle();

  let userId: string;

  if (existingProfile) {
    userId = existingProfile.id;
  } else {
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        phone: normalized,
        phone_confirm: true,
        email: testEmail,
        email_confirm: true,
        user_metadata: { full_name: "", phone: normalized },
      });

    if (createError || !created.user) {
      console.error("createUser failed:", createError);
      return { error: `Erro ao criar conta: ${createError?.message}` };
    }
    userId = created.user.id;
  }

  const { data: linkData, error: linkError } =
    await admin.auth.admin.generateLink({
      type: "magiclink",
      email: testEmail,
    });

  if (linkError || !linkData) {
    console.error("generateLink failed:", linkError);
    return { error: `Erro ao gerar sessao: ${linkError?.message}` };
  }

  const linkUrl = new URL(linkData.properties.action_link);
  const tokenHash = linkUrl.searchParams.get("token_hash")
    ?? linkUrl.searchParams.get("token");
  if (!tokenHash) {
    return { error: "Erro ao gerar sessao: token ausente" };
  }

  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });

  if (verifyError) {
    console.error("verifyOtp failed:", verifyError);
    return { error: `Erro ao verificar sessao: ${verifyError.message}` };
  }

  const { data: profile } = await supabase
    .from("users")
    .select("onboarded")
    .eq("id", userId)
    .single();

  return { success: true, redirect: redirectForProfile(profile, safePath) };
}

export async function sendTestOtp(phone: string) {
  const normalized = normalizePhone(phone);
  if (normalized.replace(/\D/g, "").length < 12) {
    return { error: "Numero invalido" };
  }

  const isTestMode = process.env.NEXT_PUBLIC_AUTH_PHONE_TEST_MODE === "true";

  if (isTestMode) {
    return { success: true, phone: normalized };
  }

  try {
    const { sendVerificationCode } = await import("@/lib/twilio");
    const result = await sendVerificationCode(normalized);
    if (!result.success) {
      return { error: "Erro ao enviar codigo de verificacao" };
    }
  } catch (err) {
    console.error("Twilio send failed:", err);
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("unverified")) {
      return { error: "Numero nao verificado. Verifique o numero no painel Twilio (conta trial)." };
    }
    return { error: "Erro ao enviar SMS. Tente novamente." };
  }
  return { success: true, phone: normalized };
}

export async function verifyPhoneOtp(phone: string, code: string, next?: string) {
  const normalized = normalizePhone(phone);
  const safePath = safeRedirect(next);

  if (code.length !== 6 || !/^\d{6}$/.test(code)) {
    return { error: "Codigo deve ter 6 digitos" };
  }

  const isTestMode = process.env.NEXT_PUBLIC_AUTH_PHONE_TEST_MODE === "true";

  if (!isTestMode) {
    try {
      const { checkVerificationCode } = await import("@/lib/twilio");
      const result = await checkVerificationCode(normalized, code);
      if (!result.success) {
        return { error: "Codigo invalido ou expirado" };
      }
    } catch (err) {
      console.error("Twilio check failed:", err);
      return { error: "Erro ao verificar codigo. Tente novamente." };
    }
  }

  return createSessionForPhone(normalized, safePath);
}
