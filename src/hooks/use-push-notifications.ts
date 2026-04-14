"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isNativePlatform,
  registerNativePushToken,
  unregisterNativePushToken,
} from "@/lib/push/native-registration";

export type PushPermission = "default" | "granted" | "denied" | "unsupported";

export interface UsePushNotificationsReturn {
  /** Current permission state */
  permission: PushPermission;
  /** Whether the user is subscribed on this device */
  isSubscribed: boolean;
  /** Whether a subscribe/unsubscribe operation is in progress */
  isLoading: boolean;
  /** Whether running inside a native Capacitor shell */
  isNative: boolean;
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

export function usePushNotifications(): UsePushNotificationsReturn {
  const [permission, setPermission] = useState<PushPermission>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const checkedRef = useRef(false);
  const native = isNativePlatform();

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;

    if (native) {
      (async () => {
        const { PushNotifications } = await import(
          /* @vite-ignore */ "@capacitor/push-notifications"
        );
        const result = await PushNotifications.checkPermissions();
        const mapped = mapNativePermission(result.receive);
        setPermission(mapped);

        if (mapped === "granted") {
          // Previously opted in — refresh the FCM token on startup so the
          // server always holds the current token (tokens can rotate).
          try {
            await registerNativePushToken();
            setIsSubscribed(true);
          } catch {
            setIsSubscribed(false);
          }
        }
      })();
      return;
    }

    if (!isPushSupported()) {
      setPermission("unsupported");
      return;
    }

    setPermission(Notification.permission as PushPermission);

    navigator.serviceWorker.ready.then((registration) => {
      registration.pushManager.getSubscription().then((sub) => {
        setIsSubscribed(sub !== null);
      });
    });
  }, [native]);

  const subscribe = useCallback(async () => {
    if (native) {
      setIsLoading(true);
      try {
        const { PushNotifications } = await import(
          /* @vite-ignore */ "@capacitor/push-notifications"
        );
        const result = await PushNotifications.requestPermissions();
        const mapped = mapNativePermission(result.receive);
        setPermission(mapped);

        if (mapped !== "granted") return;

        await registerNativePushToken();
        setIsSubscribed(true);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (!isPushSupported()) return;

    setIsLoading(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result as PushPermission);

      if (result !== "granted") return;

      const vapidKey = getVapidKey();
      if (!vapidKey) {
        throw new Error("VAPID public key not configured");
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKey,
      });

      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });

      if (!response.ok) {
        await subscription.unsubscribe();
        throw new Error("Failed to save subscription on server");
      }

      setIsSubscribed(true);
    } finally {
      setIsLoading(false);
    }
  }, [native]);

  const unsubscribe = useCallback(async () => {
    if (native) {
      setIsLoading(true);
      try {
        await unregisterNativePushToken();
        setIsSubscribed(false);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (!isPushSupported()) return;

    setIsLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });

        await subscription.unsubscribe();
      }

      setIsSubscribed(false);
    } finally {
      setIsLoading(false);
    }
  }, [native]);

  return {
    permission,
    isSubscribed,
    isLoading,
    isNative: native,
    subscribe,
    unsubscribe,
  };
}
