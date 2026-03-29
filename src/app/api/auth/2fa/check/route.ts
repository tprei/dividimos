import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHmac } from "crypto";

import { createClient } from "@/lib/supabase/server";

const COOKIE_NAME = "2fa-verified";
const COOKIE_MAX_AGE = 60 * 60 * 24; // 24 hours

function isTestMode(): boolean {
  return process.env.NEXT_PUBLIC_AUTH_PHONE_TEST_MODE === "true";
}

/**
 * Signs a cookie value with HMAC-SHA256 so it can't be forged.
 * Value format: userId:timestamp:signature
 */
function signCookieValue(userId: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = `${userId}:${timestamp}`;
  const secret = process.env.PIX_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("PIX_ENCRYPTION_KEY is required for 2FA cookie signing");
  }
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}:${signature}`;
}

export async function POST(request: NextRequest) {
  // Authenticate user
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Não autenticado" },
      { status: 401 },
    );
  }

  // Parse and validate body
  let body: { code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Corpo da requisição inválido" },
      { status: 400 },
    );
  }

  const { code } = body;
  if (!code || typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return NextResponse.json(
      { error: "Código deve ter 6 dígitos" },
      { status: 400 },
    );
  }

  // Check that user has 2FA enabled
  const { data: userData, error: userError } = await supabase
    .from("users")
    .select("two_factor_enabled, two_factor_phone")
    .eq("id", user.id)
    .single();

  if (userError || !userData) {
    return NextResponse.json(
      { error: "Usuário não encontrado" },
      { status: 404 },
    );
  }

  if (!userData.two_factor_enabled) {
    return NextResponse.json(
      { error: "2FA não está habilitado para esta conta" },
      { status: 400 },
    );
  }

  if (!userData.two_factor_phone) {
    return NextResponse.json(
      { error: "Telefone de 2FA não configurado" },
      { status: 400 },
    );
  }

  // Verify the code
  if (isTestMode()) {
    // In test mode, accept any valid 6-digit code
  } else {
    // Production: verify via Twilio
    const { checkVerificationCode } = await import("@/lib/twilio");
    const { decryptPixKey } = await import("@/lib/crypto");

    const phone = decryptPixKey(userData.two_factor_phone);
    const result = await checkVerificationCode(phone, code);

    if (!result.success) {
      return NextResponse.json(
        { error: "Código inválido ou expirado" },
        { status: 401 },
      );
    }
  }

  // Set signed 2FA verification cookie
  const cookieStore = await cookies();
  const signedValue = signCookieValue(user.id);

  cookieStore.set(COOKIE_NAME, signedValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });

  return NextResponse.json({ verified: true });
}
