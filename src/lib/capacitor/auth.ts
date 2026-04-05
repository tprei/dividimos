import { Capacitor } from "@capacitor/core";
import { SocialLogin } from "@capgo/capacitor-social-login";
import type { SupabaseClient } from "@supabase/supabase-js";

const GOOGLE_WEB_CLIENT_ID =
  "483045443985-tgldqmpqpg1467da1een2svcprvclmib.apps.googleusercontent.com";

let initialized = false;

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

async function ensureInitialized() {
  if (initialized) return;
  await SocialLogin.initialize({
    google: { webClientId: GOOGLE_WEB_CLIENT_ID },
  });
  initialized = true;
}

export async function nativeGoogleSignIn(
  supabase: SupabaseClient,
): Promise<boolean> {
  await ensureInitialized();
  const result = await SocialLogin.login({
    provider: "google",
    options: {},
  });
  const loginResult = result.result as { idToken?: string } | undefined;
  const idToken = loginResult?.idToken;
  if (!idToken) return false;
  const { error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
  });
  return !error;
}
