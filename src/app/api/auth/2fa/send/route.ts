import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const isTestMode = process.env.NEXT_PUBLIC_AUTH_PHONE_TEST_MODE === "true";

export async function POST() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("users")
    .select("two_factor_phone, two_factor_enabled")
    .eq("id", user.id)
    .single();

  if (!profile?.two_factor_enabled || !profile?.two_factor_phone) {
    return NextResponse.json({ error: "2FA nao configurado" }, { status: 400 });
  }

  if (!isTestMode) {
    const { decryptPixKey } = await import("@/lib/crypto");
    const { sendVerificationCode } = await import("@/lib/twilio");

    const storedPhone = decryptPixKey(profile.two_factor_phone);
    await sendVerificationCode(storedPhone);
  }

  return NextResponse.json({ success: true });
}
