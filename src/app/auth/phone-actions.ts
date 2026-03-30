"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { safeRedirect } from "@/lib/safe-redirect";

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) return `+${digits}`;
  return `+55${digits}`;
}

function phoneToTestEmail(phone: string): string {
  return `${phone.replace("+", "")}@phone.pixwise.local`;
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

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ phone: normalized });
  if (error) {
    return { error: error.message };
  }
  return { success: true, phone: normalized };
}

export async function verifyPhoneOtp(phone: string, code: string, next?: string) {
  const normalized = normalizePhone(phone);
  const safePath = safeRedirect(next);
  const isTestMode = process.env.NEXT_PUBLIC_AUTH_PHONE_TEST_MODE === "true";

  if (isTestMode) {
    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
      return { error: "Codigo deve ter 6 digitos" };
    }

    const admin = createAdminClient();
    const supabase = await createClient();
    const testEmail = phoneToTestEmail(normalized);

    const { data: existing } = await admin.auth.admin.listUsers();
    const existingUser = existing?.users.find(
      (u) => u.phone === normalized || u.email === testEmail,
    );

    let userId: string;

    if (existingUser) {
      userId = existingUser.id;
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
      .select("onboarded, two_factor_enabled")
      .eq("id", userId)
      .single();

    if (!profile?.onboarded) {
      const onboardPath = safePath !== "/app"
        ? `/auth/onboard?next=${encodeURIComponent(safePath)}`
        : "/auth/onboard";
      return { success: true, redirect: onboardPath };
    }

    if (profile?.two_factor_enabled) {
      return { success: true, redirect: `/auth/verify-2fa?next=${encodeURIComponent(safePath)}` };
    }

    return { success: true, redirect: safePath };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    phone: normalized,
    token: code,
    type: "sms",
  });

  if (error) {
    return { error: "Codigo invalido ou expirado" };
  }

  if (data.user) {
    const { data: profile } = await supabase
      .from("users")
      .select("onboarded, two_factor_enabled")
      .eq("id", data.user.id)
      .single();

    if (!profile?.onboarded) {
      const onboardPath = safePath !== "/app"
        ? `/auth/onboard?next=${encodeURIComponent(safePath)}`
        : "/auth/onboard";
      return { success: true, redirect: onboardPath };
    }

    if (profile?.two_factor_enabled) {
      return { success: true, redirect: `/auth/verify-2fa?next=${encodeURIComponent(safePath)}` };
    }

    return { success: true, redirect: safePath };
  }

  return { error: "Erro inesperado" };
}
