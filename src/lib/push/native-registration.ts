"use client";

import { Capacitor } from "@capacitor/core";

type TokenHandler = (token: string | null) => void;

interface PendingResolver {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
}

let cachedToken: string | null = null;
let listenersAttached = false;
let attachPromise: Promise<void> | null = null;
const pendingResolvers: PendingResolver[] = [];
const subscribers = new Set<TokenHandler>();

function notifySubscribers(token: string | null): void {
  for (const handler of subscribers) handler(token);
}

export function isNativePlatform(): boolean {
  try {
    return typeof window !== "undefined" && Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function getCachedFcmToken(): string | null {
  return cachedToken;
}

export function subscribeToFcmToken(handler: TokenHandler): () => void {
  subscribers.add(handler);
  return () => {
    subscribers.delete(handler);
  };
}

async function postSubscribe(token: string): Promise<void> {
  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, channel: "fcm" }),
  });
  if (!response.ok) {
    throw new Error(`Failed to save FCM token on server (${response.status})`);
  }
}

async function postUnsubscribe(token: string): Promise<void> {
  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, channel: "fcm" }),
  });
}

function resolvePending(token: string): void {
  const pending = pendingResolvers.splice(0);
  for (const p of pending) p.resolve(token);
}

function rejectPending(error: Error): void {
  const pending = pendingResolvers.splice(0);
  for (const p of pending) p.reject(error);
}

async function ensureListenersAttached(): Promise<void> {
  if (listenersAttached) return;
  if (attachPromise) return attachPromise;

  attachPromise = (async () => {
    const { PushNotifications } = await import("@capacitor/push-notifications");

    await PushNotifications.addListener("registration", async (token) => {
      cachedToken = token.value;
      notifySubscribers(cachedToken);
      try {
        await postSubscribe(token.value);
        resolvePending(token.value);
      } catch (error) {
        rejectPending(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });

    await PushNotifications.addListener("registrationError", (err) => {
      const message =
        err && typeof err.error === "string"
          ? err.error
          : "FCM registration failed";
      rejectPending(new Error(message));
    });

    listenersAttached = true;
  })();

  return attachPromise;
}

/**
 * Kick off native FCM registration and upload the token to the server.
 *
 * Idempotent across calls within a single app lifetime. Capacitor listeners
 * are attached exactly once; every `registration` event (including refresh
 * events after the initial one) re-POSTs the latest token so the server
 * stays in sync. Safe to call on every app startup — FCM tokens can rotate
 * between launches.
 */
export async function registerNativePushToken(): Promise<string | null> {
  if (!isNativePlatform()) return null;

  const { PushNotifications } = await import("@capacitor/push-notifications");
  await ensureListenersAttached();

  return new Promise<string>((resolve, reject) => {
    pendingResolvers.push({ resolve, reject });
    PushNotifications.register().catch((error) => {
      const err = error instanceof Error ? error : new Error(String(error));
      rejectPending(err);
    });
  });
}

/**
 * Unregister the current FCM token from the server and the native plugin.
 * Safe to call even if we never successfully registered.
 */
export async function unregisterNativePushToken(): Promise<void> {
  if (!isNativePlatform()) return;

  const token = cachedToken;
  const { PushNotifications } = await import("@capacitor/push-notifications");

  if (token) {
    try {
      await postUnsubscribe(token);
    } catch {
      // Swallow — local cleanup should still proceed
    }
  }

  try {
    await PushNotifications.unregister();
  } finally {
    cachedToken = null;
    notifySubscribers(null);
  }
}

/** Test-only: reset module state between tests. */
export function __resetNativeRegistrationForTests(): void {
  cachedToken = null;
  listenersAttached = false;
  attachPromise = null;
  pendingResolvers.splice(0);
  subscribers.clear();
}
