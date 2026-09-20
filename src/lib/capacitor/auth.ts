import { Capacitor } from "@capacitor/core";
import { SocialLogin } from "@capgo/capacitor-social-login";
import type { SupabaseClient } from "@supabase/supabase-js";

const GOOGLE_WEB_CLIENT_ID =
  "483045443985-tgldqmpqpg1467da1een2svcprvclmib.apps.googleusercontent.com";

const GOOGLE_IOS_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "";

const PENDING_SIGN_IN_KEY = "dividimos.google-sign-in";
const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

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
  if (initialized || !Capacitor.isNativePlatform()) return;

  const googleOptions: Record<string, string> =
    Capacitor.getPlatform() === "ios"
      ? {
          iOSClientId: GOOGLE_IOS_CLIENT_ID,
          iOSServerClientId: GOOGLE_WEB_CLIENT_ID,
        }
      : { webClientId: GOOGLE_WEB_CLIENT_ID };

  await SocialLogin.initialize({ google: googleOptions });
  initialized = true;
}

// A home-screen PWA gets null back from window.open, so web sign-in navigates
// the top-level document to Google and reads the id_token off the fragment
// when Google returns to /auth/popup.
export async function startGoogleRedirect(next: string): Promise<void> {
  const nonce = crypto.randomUUID();
  window.localStorage.setItem(PENDING_SIGN_IN_KEY, JSON.stringify({ nonce, next }));

  const params = new URLSearchParams({
    client_id: GOOGLE_WEB_CLIENT_ID,
    redirect_uri: `${window.location.origin}/auth/popup`,
    response_type: "id_token",
    scope: "openid email profile",
    nonce: await sha256Hex(nonce),
    prompt: "select_account",
  });
  window.location.assign(`${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`);
}

export async function completeGoogleRedirect(supabase: SupabaseClient): Promise<string | null> {
  const pending = window.localStorage.getItem(PENDING_SIGN_IN_KEY);
  window.localStorage.removeItem(PENDING_SIGN_IN_KEY);
  const token = new URLSearchParams(window.location.hash.slice(1)).get("id_token");
  if (!pending || !token) return null;

  const { nonce, next } = JSON.parse(pending) as { nonce: string; next: string };
  const signedIn = await exchangeIdToken(supabase, token, nonce);
  return signedIn ? next : null;
}

async function loginAndExtractToken(): Promise<string | undefined> {
  const result = await SocialLogin.login({
    provider: "google",
    options: {},
  });
  const loginResult = result.result as { idToken?: string } | undefined;
  return loginResult?.idToken;
}

async function exchangeIdToken(
  supabase: SupabaseClient,
  token: string,
  nonce?: string,
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

  const idToken = await loginAndExtractToken();
  if (!idToken) return false;

  const signedIn = await exchangeIdToken(supabase, idToken);
  if (signedIn || Capacitor.getPlatform() !== "ios") return signedIn;

  await SocialLogin.logout({ provider: "google" });
  const freshToken = await loginAndExtractToken();
  if (!freshToken) return false;
  return exchangeIdToken(supabase, freshToken);
}
