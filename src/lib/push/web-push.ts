import webpush from "web-push";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:contato@pagajaja.app";

let configured = false;

function ensureConfigured() {
  if (configured) return;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    throw new Error(
      "VAPID keys not configured. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY env vars.",
    );
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  tag?: string;
}

/**
 * Send a push notification to a single subscription.
 * Returns true if delivered, false if the subscription is stale (410/404).
 * Throws on unexpected errors.
 */
export async function sendPushNotification(
  subscriptionJson: string,
  payload: PushPayload,
): Promise<boolean> {
  ensureConfigured();

  const subscription = JSON.parse(subscriptionJson) as webpush.PushSubscription;
  const body = JSON.stringify(payload);

  try {
    await webpush.sendNotification(subscription, body);
    return true;
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) {
      return false;
    }
    throw err;
  }
}

/**
 * Check whether VAPID keys are configured (useful for graceful degradation).
 */
export function isWebPushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}
