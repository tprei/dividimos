import { Capacitor } from "@capacitor/core";
import { SocialLogin } from "@capgo/capacitor-social-login";
import type { SupabaseClient } from "@supabase/supabase-js";

const GOOGLE_WEB_CLIENT_ID =
  "325313268568-ou1thfu0qssdi2bb1amk4f23p7qlln74.apps.googleusercontent.com";

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
    options: { scopes: ["email", "profile"] },
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
