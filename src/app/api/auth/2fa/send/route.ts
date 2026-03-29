import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { data: userData, error: userError } = await supabase
    .from("users")
    .select("two_factor_enabled, two_factor_phone")
    .eq("id", user.id)
    .single();

  if (userError || !userData) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  if (!userData.two_factor_enabled) {
    return NextResponse.json(
      { error: "Autenticação de dois fatores não está ativada" },
      { status: 400 },
    );
  }

  if (!userData.two_factor_phone) {
    return NextResponse.json(
      { error: "Nenhum telefone configurado para autenticação de dois fatores" },
      { status: 400 },
    );
  }

  if (process.env.NEXT_PUBLIC_AUTH_PHONE_TEST_MODE === "true") {
    return NextResponse.json({ success: true });
  }

  const { decryptPixKey } = await import("@/lib/crypto");
  const { sendVerificationCode } = await import("@/lib/twilio");

  let phone: string;
  try {
    phone = decryptPixKey(userData.two_factor_phone);
  } catch {
    return NextResponse.json(
      { error: "Erro ao processar telefone de autenticação" },
      { status: 500 },
    );
  }

  try {
    await sendVerificationCode(phone);
  } catch {
    return NextResponse.json(
      { error: "Erro ao enviar código de verificação" },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
