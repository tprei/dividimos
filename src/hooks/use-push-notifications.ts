"use client";

import { getAuthGeneration } from "@/lib/sync/client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  isNativePlatform,
  registerNativePushToken,
  unregisterNativePushToken,
} from "@/lib/push/native-registration";
import { PushFailure } from "@/lib/push/failures";
import { hasNativePushConsent, setNativePushConsent } from "@/lib/push/native-consent";
import { serviceWorkerReady } from "@/lib/push/service-worker";
import { retryPendingPushDetaches } from "@/lib/push/detach";
import { useAppStore } from "@/stores/app-store";

export type PushPermission = "default" | "granted" | "denied" | "unsupported";

export interface UsePushNotificationsReturn {
  /** Current permission state */
  permission: PushPermission;
  /** Whether the user is subscribed on this device */
  isSubscribed: boolean;
  /** Whether a subscribe/unsubscribe operation is in progress */
  isLoading: boolean;
  /** True until the initial permission + subscription check resolves. */
  isInitializing: boolean;
  /** Whether running inside a native Capacitor shell */
  isNative: boolean;
  /** Why activation failed, if it did. Null once a retry succeeds. */
  error: PushFailure | null;
  /** Re-read server state for the current account and repair what drifted. */
  retry: () => Promise<void>;
  /** Request permission and subscribe to push notifications. Must be called from a user gesture. */
  subscribe: () => Promise<void>;
  /** Unsubscribe from push notifications on this device */
  unsubscribe: () => Promise<void>;
}

function getVapidKey(): ArrayBuffer | null {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) return null;
  const padding = "=".repeat((4 - (key.length % 4)) % 4);
  const base64 = (key + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new ArrayBuffer(raw.length);
  const view = new Uint8Array(bytes);
  for (let i = 0; i < raw.length; i++) {
    view[i] = raw.charCodeAt(i);
  }
  return bytes;
}

function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Map Capacitor's PermissionState to our PushPermission type.
 * Capacitor uses 'prompt' | 'prompt-with-rationale' | 'granted' | 'denied'.
 */
function mapNativePermission(state: string): PushPermission {
  if (state === "granted") return "granted";
  if (state === "denied") return "denied";
  return "default";
}

/**
 * Does this subscription still target the deployed VAPID key? A rotated key
 * leaves a subscription that looks live locally but can never be delivered to.
 */
function matchesConfiguredKey(subscription: PushSubscription): boolean {
  const configured = getVapidKey();
  if (configured === null) return false;

  const applied = subscription.options?.applicationServerKey ?? null;
  if (applied === null) return false;

  const a = new Uint8Array(configured);
  const b = new Uint8Array(
    applied instanceof ArrayBuffer ? applied : new Uint8Array(0),
  );
  if (a.length === 0 || a.length !== b.length) return false;
  return a.every((byte, i) => byte === b[i]);
}

async function serverOwnsSubscription(endpoint: string): Promise<boolean> {
  const response = await fetch("/api/push/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  if (!response.ok) throw new PushFailure("server");
  const body = (await response.json()) as { subscribed?: unknown };
  return body.subscribed === true;
}

/** Uploads the subscription, reporting whether the server accepted it. */
async function uploadSubscription(subscription: PushSubscription): Promise<boolean> {
  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  if (!response.ok) throw new PushFailure("server");
  return true;
}
type PushAttempt = {
  id: number;
  accountId: string | null;
  authGeneration: number;
};

export function usePushNotifications(): UsePushNotificationsReturn {
  const [permission, setPermission] = useState<PushPermission>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [error, setError] = useState<PushFailure | null>(null);
  const accountId = useAppStore((s) => s.me?.id ?? null);
  const native = isNativePlatform();

  const attemptRef = useRef(0);
  const beginAttempt = useCallback((): PushAttempt => {
    const attempt = {
      id: attemptRef.current + 1,
      accountId,
      authGeneration: getAuthGeneration(),
    };
    attemptRef.current = attempt.id;
    return attempt;
  }, [accountId]);
  const isCurrentAttempt = useCallback(
    (attempt: PushAttempt): boolean =>
      attempt.id === attemptRef.current &&
      attempt.authGeneration === getAuthGeneration() &&
      (useAppStore.getState().me?.id ?? null) === accountId,
    [accountId],
  );

  const reconcile = useCallback(async () => {
    const attempt = beginAttempt();
    setError(null);
    setIsInitializing(true);

    if (native) {
      try {
        const { PushNotifications } = await import(
          "@capacitor/push-notifications"
        );
        const result = await PushNotifications.checkPermissions();
        if (!isCurrentAttempt(attempt)) return;
        const mapped = mapNativePermission(result.receive);
        setPermission(mapped);

        // OS permission is not consent: it outlives an in-app opt-out and
        // older Android reports it granted without ever asking. Only this
        // account's own recorded choice enrolls the device.
        if (mapped !== "granted" || !hasNativePushConsent(accountId)) {
          if (isCurrentAttempt(attempt)) setIsSubscribed(false);
          return;
        }

        // Opted in before: re-register so the server holds this account's
        // current token, since tokens rotate and the row may have moved.
        try {
          await registerNativePushToken();
          if (isCurrentAttempt(attempt)) setIsSubscribed(true);
        } catch (cause) {
          if (!isCurrentAttempt(attempt)) return;
          setIsSubscribed(false);
          setError(new PushFailure("native", cause));
        }
      } finally {
        if (isCurrentAttempt(attempt)) setIsInitializing(false);
      }
      return;
    }

    if (!isPushSupported()) {
      if (isCurrentAttempt(attempt)) {
        setPermission("unsupported");
        setIsSubscribed(false);
        setIsInitializing(false);
      }
      return;
    }

    if (!isCurrentAttempt(attempt)) return;
    setPermission(Notification.permission as PushPermission);

    try {
      await retryPendingPushDetaches();
      const registration = await serviceWorkerReady();
      if (!isCurrentAttempt(attempt)) return;
      let subscription = await registration.pushManager.getSubscription();
      if (!isCurrentAttempt(attempt)) return;

      if (subscription !== null && !matchesConfiguredKey(subscription)) {
        // The deployed VAPID key rotated: the old subscription can never be
        // delivered to again, so replace it rather than reporting enabled.
        if (!isCurrentAttempt(attempt)) return;
        await subscription.unsubscribe();
        if (!isCurrentAttempt(attempt)) return;
        subscription = null;

        const vapidKey = getVapidKey();
        if (vapidKey === null) {
          if (isCurrentAttempt(attempt)) {
            setIsSubscribed(false);
            setError(new PushFailure("config"));
          }
          return;
        }
        if (Notification.permission === "granted") {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: vapidKey,
          });
          if (!isCurrentAttempt(attempt)) return;
        }
      }

      if (subscription === null) {
        if (isCurrentAttempt(attempt)) setIsSubscribed(false);
        return;
      }

      // Server state decides: a row owned by another account, or no row at
      // all, means this account is not subscribed on this device.
      if (!isCurrentAttempt(attempt)) return;
      if (await serverOwnsSubscription(subscription.endpoint)) {
        if (isCurrentAttempt(attempt)) setIsSubscribed(true);
        return;
      }

      if (!isCurrentAttempt(attempt)) return;
      const uploaded = await uploadSubscription(subscription);
      if (isCurrentAttempt(attempt)) setIsSubscribed(uploaded);
    } catch (cause) {
      if (!isCurrentAttempt(attempt)) return;
      setIsSubscribed(false);
      setError(
        cause instanceof PushFailure ? cause : new PushFailure("worker", cause),
      );
    } finally {
      if (isCurrentAttempt(attempt)) setIsInitializing(false);
    }
  }, [accountId, beginAttempt, isCurrentAttempt, native]);

  // Re-runs on account change: the previous account's subscription state says
  // nothing about this one.
  useEffect(() => {
    void reconcile();
  }, [reconcile, accountId]);

  const subscribe = useCallback(async () => {
    const attempt = beginAttempt();
    setIsLoading(true);
    setError(null);

    if (native) {
      try {
        const { PushNotifications } = await import(
          "@capacitor/push-notifications"
        );
        const result = await PushNotifications.requestPermissions();
        if (!isCurrentAttempt(attempt)) return;
        const mapped = mapNativePermission(result.receive);
        setPermission(mapped);

        if (mapped !== "granted") {
          setError(new PushFailure("denied"));
          return;
        }

        await registerNativePushToken();
        if (!isCurrentAttempt(attempt)) return;
        setNativePushConsent(accountId, true);
        setIsSubscribed(true);
      } catch (cause) {
        if (!isCurrentAttempt(attempt)) return;
        setIsSubscribed(false);
        setError(new PushFailure("native", cause));
      } finally {
        if (isCurrentAttempt(attempt)) setIsLoading(false);
      }
      return;
    }

    try {
      if (!isPushSupported()) {
        if (isCurrentAttempt(attempt)) {
          setPermission("unsupported");
          setError(new PushFailure("unsupported"));
        }
        return;
      }

      const result = await Notification.requestPermission();
      if (!isCurrentAttempt(attempt)) return;
      setPermission(result as PushPermission);

      if (result !== "granted") {
        setError(new PushFailure("denied"));
        return;
      }

      const vapidKey = getVapidKey();
      if (vapidKey === null) throw new PushFailure("config");

      const registration = await serviceWorkerReady();
      if (!isCurrentAttempt(attempt)) return;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKey,
      });
      if (!isCurrentAttempt(attempt)) return;

      try {
        const uploaded = await uploadSubscription(subscription);
        if (isCurrentAttempt(attempt)) setIsSubscribed(uploaded);
      } catch (cause) {
        if (isCurrentAttempt(attempt)) await subscription.unsubscribe();
        throw cause;
      }
    } catch (cause) {
      if (!isCurrentAttempt(attempt)) return;
      setIsSubscribed(false);
      setError(
        cause instanceof PushFailure ? cause : new PushFailure("worker", cause),
      );
    } finally {
      if (isCurrentAttempt(attempt)) setIsLoading(false);
    }
  }, [accountId, beginAttempt, isCurrentAttempt, native]);

  const unsubscribe = useCallback(async () => {
    const attempt = beginAttempt();
    setIsLoading(true);
    setError(null);

    if (native) {
      try {
        await unregisterNativePushToken();
        if (!isCurrentAttempt(attempt)) return;
        // Recorded before anything else so the choice survives a restart
        // even though OS permission stays granted.
        setNativePushConsent(accountId, false);
        setIsSubscribed(false);
      } catch (cause) {
        if (isCurrentAttempt(attempt)) setError(new PushFailure("native", cause));
      } finally {
        if (isCurrentAttempt(attempt)) setIsLoading(false);
      }
      return;
    }

    try {
      if (!isPushSupported()) {
        if (isCurrentAttempt(attempt)) setPermission("unsupported");
        return;
      }

      const registration = await serviceWorkerReady();
      if (!isCurrentAttempt(attempt)) return;
      const subscription = await registration.pushManager.getSubscription();
      if (!isCurrentAttempt(attempt)) return;

      if (subscription !== null) {
        const response = await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        if (!isCurrentAttempt(attempt)) return;

        // Dropping it locally stops delivery here regardless, but a server
        // row left behind is a real failure the user can retry.
        await subscription.unsubscribe();
        if (!response.ok) throw new PushFailure("server");
      }

      if (isCurrentAttempt(attempt)) setIsSubscribed(false);
    } catch (cause) {
      if (!isCurrentAttempt(attempt)) return;
      setIsSubscribed(false);
      setError(
        cause instanceof PushFailure ? cause : new PushFailure("worker", cause),
      );
    } finally {
      if (isCurrentAttempt(attempt)) setIsLoading(false);
    }
  }, [accountId, beginAttempt, isCurrentAttempt, native]);


  return {
    permission,
    isSubscribed,
    isLoading,
    isInitializing,
    isNative: native,
    error,
    subscribe,
    unsubscribe,
    retry: reconcile,
  };
}
