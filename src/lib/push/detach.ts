import {
  isNativePlatform,
  unregisterNativePushToken,
  unregisterNativePushTokenLocally,
} from "./native-registration";
import { serviceWorkerReady } from "./service-worker";
import { useAppStore } from "@/stores/app-store";

/**
 * Server-side push detach at sign-out.
 *
 * The authenticated request runs before sign-out. If it fails, the endpoint
 * stays queued for a later sign-in by the same account.
 */
const pendingDetachEndpoints = new Map<string, string>();

export async function detachLocalPushForSignOut(
  accountId: string | null,
): Promise<void> {
  if (isNativePlatform()) {
    await Promise.allSettled([unregisterNativePushTokenLocally()]);
    return;
  }

  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  const registrationResult = await Promise.allSettled([serviceWorkerReady(2000)]);
  const registration = registrationResult[0];
  if (registration.status !== "fulfilled") return;

  const subscriptionResult = await Promise.allSettled([
    registration.value.pushManager.getSubscription(),
  ]);
  const subscription = subscriptionResult[0];
  if (subscription.status !== "fulfilled" || subscription.value === null) return;

  if (accountId !== null) {
    pendingDetachEndpoints.set(subscription.value.endpoint, accountId);
  }
  await Promise.allSettled([subscription.value.unsubscribe()]);
}

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

export async function detachPushForSignOut(): Promise<void> {
  if (isNativePlatform()) {
    await unregisterNativePushToken();
    return;
  }

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
  const accountId = useAppStore.getState().me?.id ?? null;
  if (!(await requestDetach(endpoint)) && accountId !== null) {
    pendingDetachEndpoints.set(endpoint, accountId);
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
  const accountId = useAppStore.getState().me?.id ?? null;
  if (accountId === null) return;

  for (const [endpoint, ownerId] of pendingDetachEndpoints) {
    if (ownerId !== accountId) continue;
    if (await requestDetach(endpoint)) pendingDetachEndpoints.delete(endpoint);
  }
}

export function clearPendingPushDetaches(): void {
  pendingDetachEndpoints.clear();
}

export function pendingPushDetachCount(): number {
  return pendingDetachEndpoints.size;
}
