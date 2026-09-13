import "server-only";
import webpush from "web-push";
import {
  createRebindingSafeAgent,
  validateWebSubscription,
} from "./validate-endpoint";

export const PUSH_SEND_TIMEOUT_MS = 10_000;

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:contato@dividimos.ai";

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

export type PushSendOutcome =
  | { status: "accepted" }
  | { status: "stale" }
  | { status: "failed" };

function statusCodeOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" ? statusCode : undefined;
}

function withSendDeadline<T>(promise: Promise<T>): Promise<T> {
  const deferred = Promise.withResolvers<never>();
  const timer = setTimeout(
    () => deferred.reject(new Error("push send timed out")),
    PUSH_SEND_TIMEOUT_MS,
  );
  return Promise.race([promise, deferred.promise]).finally(() => clearTimeout(timer));
}

/**
 * Send a push notification to a single subscription.
 *
 * The result is deliberately settled. Provider acceptance is not physical
 * delivery, and transient failures must not delete a subscription.
 */
export async function sendPushNotification(
  subscriptionJson: string,
  payload: PushPayload,
): Promise<PushSendOutcome> {
  try {
    ensureConfigured();

    const parsed: unknown = JSON.parse(subscriptionJson);
    const validation = await validateWebSubscription(parsed);
    if (!validation.ok) return { status: "failed" };

    const endpoint = new URL(validation.value.endpoint);
    const sendPromise = webpush.sendNotification(
      validation.value,
      JSON.stringify(payload),
      {
        agent: createRebindingSafeAgent(endpoint.hostname),
        timeout: PUSH_SEND_TIMEOUT_MS,
      },
    );

    await withSendDeadline(sendPromise);
    return { status: "accepted" };
  } catch (error) {
    const statusCode = statusCodeOf(error);
    if (statusCode === 404 || statusCode === 410) {
      return { status: "stale" };
    }
    return { status: "failed" };
  }
}

/**
 * Check whether VAPID keys are configured (useful for graceful degradation).
 */
export function isWebPushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}
