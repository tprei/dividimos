import { PushFailure } from "@/lib/push/failures";

/**
 * Whether the server still holds a subscription row for this endpoint
 * (/api/push/status). A row owned by another account answers false.
 */
export async function fetchPushSubscriptionStatus(endpoint: string): Promise<boolean> {
  const response = await fetch("/api/push/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  if (!response.ok) throw new PushFailure("server");
  const body = (await response.json()) as { subscribed?: unknown };
  return body.subscribed === true;
}

/** Uploads a web push subscription (/api/push/subscribe). */
export async function uploadPushSubscription(subscription: PushSubscription): Promise<boolean> {
  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  if (!response.ok) throw new PushFailure("server");
  return true;
}

/**
 * Detaches the server row for an endpoint (/api/push/unsubscribe). Reports
 * whether the server accepted it; the caller still unsubscribes locally
 * either way.
 */
export async function detachPushSubscription(endpoint: string): Promise<boolean> {
  const response = await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  return response.ok;
}