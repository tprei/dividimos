"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PushPermission = "default" | "granted" | "denied" | "unsupported";

interface UsePushNotificationsReturn {
  /** Current permission state */
  permission: PushPermission;
  /** Whether the user is subscribed on this device */
  isSubscribed: boolean;
  /** Whether a subscribe/unsubscribe operation is in progress */
  isLoading: boolean;
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

export function usePushNotifications(): UsePushNotificationsReturn {
  const [permission, setPermission] = useState<PushPermission>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const checkedRef = useRef(false);

  // Check initial state
  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;

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
  }, []);

  const subscribe = useCallback(async () => {
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
  }, []);

  const unsubscribe = useCallback(async () => {
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
  }, []);

  return { permission, isSubscribed, isLoading, subscribe, unsubscribe };
}
