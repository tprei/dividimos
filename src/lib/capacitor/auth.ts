import { Capacitor } from "@capacitor/core";
import { SocialLogin } from "@capgo/capacitor-social-login";
import type { SupabaseClient } from "@supabase/supabase-js";

const GOOGLE_WEB_CLIENT_ID =
  "483045443985-tgldqmpqpg1467da1een2svcprvclmib.apps.googleusercontent.com";

const GOOGLE_IOS_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "";

let initialized = false;

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

export function getPlatform(): string {
  return Capacitor.getPlatform();
}

async function ensureInitialized() {
  if (initialized) return;

  const platform = Capacitor.getPlatform();
  const googleOptions: Record<string, string> =
    platform === "ios"
      ? {
          iOSClientId: GOOGLE_IOS_CLIENT_ID,
          iOSServerClientId: GOOGLE_WEB_CLIENT_ID,
        }
      : { webClientId: GOOGLE_WEB_CLIENT_ID };

  await SocialLogin.initialize({ google: googleOptions });
  initialized = true;
}

async function loginAndExtractToken(): Promise<string | undefined> {
  const result = await SocialLogin.login({
    provider: "google",
    options: {},
  });
  const loginResult = result.result as { idToken?: string } | undefined;
  return loginResult?.idToken;
}

export async function nativeGoogleSignIn(
  supabase: SupabaseClient,
): Promise<boolean> {
  await ensureInitialized();

  const idToken = await loginAndExtractToken();
  if (!idToken) return false;

  const { error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
  });

  if (error && Capacitor.getPlatform() === "ios") {
    await SocialLogin.logout({ provider: "google" });
    const freshToken = await loginAndExtractToken();
    if (!freshToken) return false;
    const retry = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: freshToken,
    });
    return !retry.error;
  }

  return !error;
}
