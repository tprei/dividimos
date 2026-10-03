import { Capacitor } from "@capacitor/core";
import { SocialLogin } from "@capgo/capacitor-social-login";
import {
  isAuthRetryableFetchError,
  type AuthTokenResponse,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { setPendingSignInName } from "@/lib/pending-sign-in-name";

const GOOGLE_WEB_CLIENT_ID =
  "483045443985-tgldqmpqpg1467da1een2svcprvclmib.apps.googleusercontent.com";

const GOOGLE_IOS_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "";

// iOS ignores this value; the plugin only needs a non-empty id to enable Apple.
const APPLE_CLIENT_ID = "ai.dividimos.app";

const PENDING_SIGN_IN_KEY = "dividimos.google-sign-in";
const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

// The plugin rejects with message-only errors, so cancellation is recognized
// by the exact texts in the installed native sources: ASAuthorizationError
// .canceled (localized, so only the domain and code are stable), GoogleSignIn's
// kUserCanceledError, and the Credential Manager cancellation the Android
// provider prefixes with "Google Sign-In failed: ".
const CANCELLATION_PATTERNS: readonly RegExp[] = [
  /com\.apple\.AuthenticationServices\.AuthorizationError\D*1001\b/,
  /^The user canceled the sign-in flow\.$/,
  /^Google Sign-In failed: .*cancell?ed by the user/i,
];

export type NativeProvider = "apple" | "google";

export type NativeSignInFailure = "network" | "rejected" | "unavailable" | "busy";

export type NativeSignInResult =
  | { status: "signed_in"; provider: NativeProvider; authorizationCode: string | null }
  | { status: "cancelled" }
  | { status: "failed"; reason: NativeSignInFailure };

type NativeCredential =
  | {
      status: "credential";
      idToken: string;
      rawNonce: string | undefined;
      authorizationCode: string | null;
      name: string;
    }
  | { status: "cancelled" }
  | { status: "failed" };

let googleInitialized = false;
let appleInitialized = false;
let attemptInFlight = false;

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

export function isAppleSignInAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

export function isNativeGoogleSignInAvailable(): boolean {
  if (!Capacitor.isNativePlatform()) return false;
  const platform = Capacitor.getPlatform();
  if (platform === "android") return true;
  return platform === "ios" && GOOGLE_IOS_CLIENT_ID !== "";
}

// Supabase compares sha256(nonce) with the id_token's nonce claim, so the
// provider receives the hash and Supabase receives the raw value.
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function isNativeCancellation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return CANCELLATION_PATTERNS.some((pattern) => pattern.test(message));
}

// One native sheet at a time across providers: a second sheet would replace
// the first one's completion inside the plugin.
async function singleFlight<T>(busy: T, attempt: () => Promise<T>): Promise<T> {
  if (attemptInFlight) return busy;
  attemptInFlight = true;
  try {
    return await attempt();
  } finally {
    attemptInFlight = false;
  }
}

export async function prepareGoogleSignIn(): Promise<void> {
  if (googleInitialized || !Capacitor.isNativePlatform()) return;

  const googleOptions: Record<string, string> =
    Capacitor.getPlatform() === "ios"
      ? {
          iOSClientId: GOOGLE_IOS_CLIENT_ID,
          iOSServerClientId: GOOGLE_WEB_CLIENT_ID,
        }
      : { webClientId: GOOGLE_WEB_CLIENT_ID };

  await SocialLogin.initialize({ google: googleOptions });
  googleInitialized = true;
}

async function prepareAppleSignIn(): Promise<void> {
  if (appleInitialized) return;
  // useProperTokenExchange returns Apple's authorization code as its own
  // field; the server exchanges it for the token revoked at account deletion.
  await SocialLogin.initialize({
    apple: { clientId: APPLE_CLIENT_ID, useProperTokenExchange: true },
  });
  appleInitialized = true;
}

async function requestAppleCredential(): Promise<NativeCredential> {
  await prepareAppleSignIn();
  const rawNonce = crypto.randomUUID();
  const { result } = await SocialLogin.login({
    provider: "apple",
    options: { nonce: await sha256Hex(rawNonce) },
  });
  if (!result.idToken) return { status: "failed" };
  const name = [result.profile.givenName, result.profile.familyName]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join(" ");
  return {
    status: "credential",
    idToken: result.idToken,
    rawNonce,
    // The plugin reports a missing code as an empty string.
    authorizationCode: result.authorizationCode || null,
    name,
  };
}

async function requestGoogleCredential(): Promise<NativeCredential> {
  await prepareGoogleSignIn();
  // Android keeps its nonce-less Credential Manager flow. On iOS the nonce
  // binds the id_token to this attempt, and forcePrompt skips GoogleSignIn's
  // restored session, whose cached id_token carries an older nonce.
  const rawNonce = Capacitor.getPlatform() === "ios" ? crypto.randomUUID() : undefined;
  const options =
    rawNonce === undefined ? {} : { nonce: await sha256Hex(rawNonce), forcePrompt: true };
  const { result } = await SocialLogin.login({ provider: "google", options });
  if (result.responseType !== "online" || !result.idToken) return { status: "failed" };
  return {
    status: "credential",
    idToken: result.idToken,
    rawNonce,
    authorizationCode: null,
    name: "",
  };
}

async function requestNativeCredential(provider: NativeProvider): Promise<NativeCredential> {
  try {
    return provider === "apple" ? await requestAppleCredential() : await requestGoogleCredential();
  } catch (error) {
    return isNativeCancellation(error) ? { status: "cancelled" } : { status: "failed" };
  }
}

async function nativeSignIn(
  supabase: SupabaseClient,
  provider: NativeProvider,
): Promise<NativeSignInResult> {
  const available = provider === "apple" ? isAppleSignInAvailable() : isNativeGoogleSignInAvailable();
  if (!available) return { status: "failed", reason: "unavailable" };

  return singleFlight<NativeSignInResult>({ status: "failed", reason: "busy" }, async () => {
    const credential = await requestNativeCredential(provider);
    if (credential.status === "cancelled") return credential;
    if (credential.status === "failed") return { status: "failed", reason: "rejected" };

    let exchange: AuthTokenResponse;
    try {
      exchange = await supabase.auth.signInWithIdToken({
        provider,
        token: credential.idToken,
        ...(credential.rawNonce === undefined ? {} : { nonce: credential.rawNonce }),
      });
    } catch (thrown) {
      return { status: "failed", reason: isAuthRetryableFetchError(thrown) ? "network" : "rejected" };
    }
    const { data, error } = exchange;
    if (error) {
      return { status: "failed", reason: isAuthRetryableFetchError(error) ? "network" : "rejected" };
    }

    // Apple shares the name only on the first authorization; onboarding
    // prefills it from here instead of the email-derived fallback.
    if (credential.name !== "" && data.user) {
      setPendingSignInName(data.user.id, credential.name);
    }
    return { status: "signed_in", provider, authorizationCode: credential.authorizationCode };
  });
}

export function appleSignIn(supabase: SupabaseClient): Promise<NativeSignInResult> {
  return nativeSignIn(supabase, "apple");
}

export function googleSignIn(supabase: SupabaseClient): Promise<NativeSignInResult> {
  return nativeSignIn(supabase, "google");
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
  const { error } = await supabase.auth.signInWithIdToken({ provider: "google", token, nonce });
  return error ? null : next;
}

// Credential Manager (Android) and the Google SDK (iOS) remember the last
// account; clearing it lets the next sign-in offer the account picker.
export async function forgetGoogleAccount(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await prepareGoogleSignIn();
    await SocialLogin.logout({ provider: "google" });
  } catch {
    // A remembered native account only costs one extra tap at the next
    // sign-in; it must never keep the user signed in to Dividimos.
  }
}

// Clears only the plugin's cached Apple credential. Revoking Apple's
// authorization happens server-side at account deletion, not at sign-out.
export async function forgetAppleAccount(): Promise<void> {
  if (!isAppleSignInAvailable()) return;
  try {
    await prepareAppleSignIn();
    await SocialLogin.logout({ provider: "apple" });
  } catch {
    // A stale cached credential has no effect on the Supabase session, which
    // is what keeps someone signed in; sign-out must not fail over it.
  }
}
