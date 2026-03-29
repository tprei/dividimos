import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const isTestMode = process.env.NEXT_PUBLIC_AUTH_PHONE_TEST_MODE === "true";

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  return digits.startsWith("55") ? `+${digits}` : `+55${digits}`;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const { action, phone, code } = body as {
    action: string;
    phone?: string;
    code?: string;
  };

  if (!phone) {
    return NextResponse.json({ error: "Telefone obrigatorio" }, { status: 400 });
  }

  const normalizedPhone = normalizePhone(phone);

  if (action === "send") {
    if (!isTestMode) {
      const { sendVerificationCode } = await import("@/lib/twilio");
      await sendVerificationCode(normalizedPhone);
    }
    return NextResponse.json({ success: true });
  }

  if (action === "verify") {
    if (!code || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "Codigo invalido" }, { status: 400 });
    }

    if (!isTestMode) {
      const { checkVerificationCode } = await import("@/lib/twilio");
      const result = await checkVerificationCode(normalizedPhone, code);
      if (!result.success) {
        return NextResponse.json({ error: "Codigo incorreto" }, { status: 400 });
      }
    }

    const { encryptPixKey } = await import("@/lib/crypto");
    const encryptedPhone = encryptPixKey(normalizedPhone);

    const { error } = await supabase
      .from("users")
      .update({ two_factor_enabled: true, two_factor_phone: encryptedPhone })
      .eq("id", user.id);

    if (error) {
      return NextResponse.json({ error: "Erro ao salvar configuracao 2FA" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Acao invalida" }, { status: 400 });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const { code } = body as { code?: string };

  if (!code || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Codigo invalido" }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("users")
    .select("two_factor_phone")
    .eq("id", user.id)
    .single();

  if (!profile?.two_factor_phone) {
    return NextResponse.json({ error: "2FA nao configurado" }, { status: 400 });
  }

  if (!isTestMode) {
    const { decryptPixKey } = await import("@/lib/crypto");
    const { checkVerificationCode } = await import("@/lib/twilio");

    const storedPhone = decryptPixKey(profile.two_factor_phone);
    const result = await checkVerificationCode(storedPhone, code);

    if (!result.success) {
      return NextResponse.json({ error: "Codigo incorreto" }, { status: 400 });
    }
  }

  const { error } = await supabase
    .from("users")
    .update({ two_factor_enabled: false, two_factor_phone: null })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: "Erro ao desativar 2FA" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
