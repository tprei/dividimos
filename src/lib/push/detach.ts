import { serviceWorkerReady } from "./service-worker";

/**
 * Server-side push detach at sign-out.
 *
 * Sign-out must not wait on the network, but leaving the row behind means the
 * previous account keeps receiving notifications on a shared browser. The
 * request is best-effort and, when it fails, the endpoint stays queued so the
 * next attempt (the next sign-out, or an explicit retry) clears it.
 */
const pendingDetachEndpoints = new Set<string>();

async function requestDetach(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Detaches this browser's subscription from the account being signed out and
 * drops it locally, so the next account starts from a clean device.
 */
export async function detachPushForSignOut(): Promise<void> {
  await retryPendingPushDetaches();

  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  let subscription: PushSubscription | null = null;
  try {
    const registration = await serviceWorkerReady(2000);
    subscription = await registration.pushManager.getSubscription();
  } catch {
    // No worker, no local subscription to detach.
    return;
  }

  if (subscription === null) return;

  const { endpoint } = subscription;
  if (!(await requestDetach(endpoint))) {
    pendingDetachEndpoints.add(endpoint);
  }

  // Dropping the local subscription is what stops delivery to this browser
  // even if the server row survived a failed request.
  try {
    await subscription.unsubscribe();
  } catch {
    // Already gone.
  }
}

export async function retryPendingPushDetaches(): Promise<void> {
  for (const endpoint of [...pendingDetachEndpoints]) {
    if (await requestDetach(endpoint)) pendingDetachEndpoints.delete(endpoint);
  }
}

/** Test seam: forget queued detaches. */
export function __resetPendingPushDetaches(): void {
  pendingDetachEndpoints.clear();
}

export function pendingPushDetachCount(): number {
  return pendingDetachEndpoints.size;
}
