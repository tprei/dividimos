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

// Supabase compares sha256(nonce) with the id_token's nonce claim, so Google
// receives the hash and Supabase receives the raw value.
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function prepareGoogleSignIn(): Promise<void> {
  if (initialized) return;

  const platform = Capacitor.getPlatform();
  const googleOptions: Record<string, string> =
    platform === "ios"
      ? {
          iOSClientId: GOOGLE_IOS_CLIENT_ID,
          iOSServerClientId: GOOGLE_WEB_CLIENT_ID,
        }
      : { webClientId: GOOGLE_WEB_CLIENT_ID };
  if (platform === "web") {
    googleOptions.redirectUrl = `${window.location.origin}/auth/popup`;
  }

  await SocialLogin.initialize({ google: googleOptions });
  initialized = true;
}

async function loginAndExtractToken(hashedNonce: string | undefined): Promise<string | undefined> {
  const result = await SocialLogin.login({
    provider: "google",
    options: hashedNonce === undefined ? {} : { nonce: hashedNonce },
  });
  const loginResult = result.result as { idToken?: string } | undefined;
  return loginResult?.idToken;
}

async function exchangeIdToken(
  supabase: SupabaseClient,
  token: string,
  nonce: string | undefined,
): Promise<boolean> {
  const { error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token,
    ...(nonce === undefined ? {} : { nonce }),
  });
  return !error;
}

export async function googleSignIn(supabase: SupabaseClient): Promise<boolean> {
  await prepareGoogleSignIn();

  const nonce = Capacitor.getPlatform() === "web" ? crypto.randomUUID() : undefined;
  const hashedNonce = nonce === undefined ? undefined : await sha256Hex(nonce);
  const idToken = await loginAndExtractToken(hashedNonce);
  if (!idToken) return false;

  const signedIn = await exchangeIdToken(supabase, idToken, nonce);
  if (signedIn || Capacitor.getPlatform() !== "ios") return signedIn;

  await SocialLogin.logout({ provider: "google" });
  const freshToken = await loginAndExtractToken(hashedNonce);
  if (!freshToken) return false;
  return exchangeIdToken(supabase, freshToken, nonce);
}
