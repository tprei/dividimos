import { SignJWT, importPKCS8 } from "jose";
import type { PushPayload } from "./web-push";

/**
 * Firebase Cloud Messaging HTTP v1 sender.
 *
 * Uses a Google service account to obtain OAuth2 access tokens,
 * then sends via the FCM v1 REST API. No firebase-admin dependency.
 *
 * Required env vars:
 *   FCM_PROJECT_ID           — Firebase project ID
 *   FCM_SERVICE_ACCOUNT_EMAIL — Service account email
 *   FCM_PRIVATE_KEY           — PEM-encoded private key (RS256)
 */

const FCM_PROJECT_ID = process.env.FCM_PROJECT_ID;
const FCM_SERVICE_ACCOUNT_EMAIL = process.env.FCM_SERVICE_ACCOUNT_EMAIL;
const FCM_PRIVATE_KEY = process.env.FCM_PRIVATE_KEY;

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Check whether FCM credentials are configured.
 */
export function isFcmConfigured(): boolean {
  return Boolean(FCM_PROJECT_ID && FCM_SERVICE_ACCOUNT_EMAIL && FCM_PRIVATE_KEY);
}

/**
 * Obtain an OAuth2 access token using the service account JWT assertion flow.
 * Caches the token until 60s before expiry.
 */
async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  if (!FCM_SERVICE_ACCOUNT_EMAIL || !FCM_PRIVATE_KEY) {
    throw new Error("FCM service account credentials not configured");
  }

  const now = Math.floor(Date.now() / 1000);
  const privateKey = await importPKCS8(FCM_PRIVATE_KEY.replace(/\\n/g, "\n"), "RS256");

  const jwt = await new SignJWT({
    scope: FCM_SCOPE,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(FCM_SERVICE_ACCOUNT_EMAIL)
    .setSubject(FCM_SERVICE_ACCOUNT_EMAIL)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`FCM token exchange failed (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };

  return cachedToken.token;
}

/**
 * Send a push notification to a single FCM device token.
 * Returns true if delivered, false if the token is stale (unregistered).
 * Throws on unexpected errors.
 */
export async function sendFcmNotification(
  deviceToken: string,
  payload: PushPayload,
): Promise<boolean> {
  if (!FCM_PROJECT_ID) {
    throw new Error("FCM_PROJECT_ID not configured");
  }

  const accessToken = await getAccessToken();

  const url = `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`;

  // Do NOT set click_action. The legacy "FCM_PLUGIN_ACTIVITY" value from
  // old Cordova/Capacitor templates only works if the AndroidManifest has a
  // matching intent filter, which we don't have — and that caused taps to
  // silently do nothing. Omitting click_action lets Android fall back to
  // the launcher intent, which opens MainActivity (Capacitor entry point).
  // Capacitor's push-notifications plugin fires pushNotificationActionPerformed
  // on the JS side either way, and our AppShell listener reads data.url
  // from there to route via next/router.
  const message: Record<string, unknown> = {
    token: deviceToken,
    notification: {
      title: payload.title,
      body: payload.body,
    },
    android: {
      notification: {
        ...(payload.tag ? { tag: payload.tag } : {}),
        ...(payload.icon ? { icon: payload.icon } : {}),
      },
    },
    ...(payload.url ? { data: { url: payload.url } } : {}),
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
  });

  if (resp.ok) {
    return true;
  }

  // Token is stale / unregistered
  if (resp.status === 404 || resp.status === 400) {
    const body = await resp.json().catch(() => ({}));
    const errorCode = (body as { error?: { details?: Array<{ errorCode?: string }> } })?.error
      ?.details?.[0]?.errorCode;
    if (
      resp.status === 404 ||
      errorCode === "UNREGISTERED" ||
      errorCode === "INVALID_ARGUMENT"
    ) {
      return false;
    }
  }

  const text = await resp.text().catch(() => "");
  throw new Error(`FCM send failed (${resp.status}): ${text}`);
}

/**
 * Invalidate the cached access token (useful for testing).
 */
export function _resetTokenCache(): void {
  cachedToken = null;
}
