"use client";

import { getAuthGeneration } from "@/lib/sync/client";
import { Capacitor } from "@capacitor/core";

type TokenHandler = (token: string | null) => void;
interface PendingResolver {
  generation: number;
  resolve: (token: string) => void;
  reject: (error: Error) => void;
}

const REGISTER_TIMEOUT_MS = 10_000;
let cachedToken: string | null = null;
let lastPostedToken: string | null = null;
let activeRegistrationGeneration: number | null = null;
let listenersAttached = false;
let attachPromise: Promise<void> | null = null;
let registerInflight: Promise<string> | null = null;
let registerInflightGeneration: number | null = null;
let registerTimeout: ReturnType<typeof setTimeout> | null = null;
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
  const response = await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, channel: "fcm" }),
  });
  if (!response.ok) {
    throw new Error(`Failed to remove FCM token from server (${response.status})`);
  }
}

export async function unregisterNativePushTokenLocally(): Promise<void> {
  activeRegistrationGeneration = null;
  clearRegisterTimeout();
  registerInflight = null;
  registerInflightGeneration = null;
  rejectPending(new Error("Native push registration cancelled"));

  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    await Promise.allSettled([PushNotifications.unregister()]);
  } finally {
    cachedToken = null;
    lastPostedToken = null;
    notifySubscribers(null);
  }
}
function clearRegisterTimeout(): void {
  if (registerTimeout !== null) {
    clearTimeout(registerTimeout);
    registerTimeout = null;
  }
}

function resolvePending(token: string, generation: number): void {
  clearRegisterTimeout();
  const pending = pendingResolvers.splice(0);
  for (const resolver of pending) {
    if (resolver.generation === generation) {
      resolver.resolve(token);
    } else {
      resolver.reject(new Error("Native push registration expired"));
    }
  }
}

function rejectPending(error: Error, generation?: number): void {
  if (generation === undefined || registerInflightGeneration === generation) {
    clearRegisterTimeout();
  }
  const pending = pendingResolvers.splice(0);
  for (const resolver of pending) {
    if (generation === undefined || resolver.generation === generation) {
      resolver.reject(error);
    } else {
      pendingResolvers.push(resolver);
    }
  }
}

async function ensureListenersAttached(): Promise<void> {
  if (listenersAttached) return;
  if (attachPromise) return attachPromise;

  attachPromise = (async () => {
    // Handles are tracked as they attach so a failure partway through can
    // release what it already installed; otherwise a retry would add a
    // second registration listener beside the orphaned first.
    const attached: { remove: () => Promise<void> }[] = [];
    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");

      attached.push(
        await PushNotifications.addListener("registration", async (token) => {
          const generation = getAuthGeneration();
          const registrationGeneration = activeRegistrationGeneration;
          if (registrationGeneration !== generation) {
            rejectPending(
              new Error("Native push registration expired"),
              registrationGeneration ?? undefined,
            );
            return;
          }

          try {
            if (lastPostedToken !== token.value) {
              await postSubscribe(token.value);
            }
            if (
              getAuthGeneration() !== generation ||
              activeRegistrationGeneration !== generation
            ) {
              rejectPending(new Error("Native push registration expired"), generation);
              return;
            }
            cachedToken = token.value;
            lastPostedToken = token.value;
            notifySubscribers(cachedToken);
            resolvePending(token.value, generation);
          } catch (error) {
            rejectPending(
              error instanceof Error ? error : new Error(String(error)),
              generation,
            );
          }
        }),
      );

      attached.push(
        await PushNotifications.addListener("registrationError", (err) => {
          const generation = getAuthGeneration();
          const registrationGeneration = activeRegistrationGeneration;
          activeRegistrationGeneration = null;
          const message =
            err && typeof err.error === "string"
              ? err.error
              : "FCM registration failed";
          rejectPending(
            new Error(message),
            registrationGeneration ?? generation,
          );
        }),
      );

      listenersAttached = true;
    } catch (error) {
      for (const handle of attached) void handle.remove();
      // A transient failure must not disable opt-in for the whole session:
      // clearing the cached promise lets the next caller retry cleanly.
      attachPromise = null;
      throw error;
    }
  })();

  return attachPromise;
}

/**
 * Kick off native FCM registration and upload the token to the server.
 *
 * Concurrent callers share a single in-flight `register()` call, so the
 * listener fires exactly once per registration round. Token-refresh events
 * are deduplicated via `lastPostedToken`, so the server only receives a
 * POST when the token actually changes. Safe to call on every app startup.
 */
export async function registerNativePushToken(): Promise<string | null> {
  if (!isNativePlatform()) return null;

  const generation = getAuthGeneration();
  const { PushNotifications } = await import("@capacitor/push-notifications");
  await ensureListenersAttached();
  if (getAuthGeneration() !== generation) return null;

  if (
    registerInflight !== null &&
    registerInflightGeneration === generation
  ) {
    return registerInflight;
  }
  if (registerInflight !== null && registerInflightGeneration !== generation) {
    const previousGeneration = registerInflightGeneration;
    if (previousGeneration !== null) {
      clearRegisterTimeout();
      rejectPending(new Error("Native push registration expired"), previousGeneration);
    }
    registerInflight = null;
    registerInflightGeneration = null;
  }

  activeRegistrationGeneration = generation;
  const promise = new Promise<string>((resolve, reject) => {
    pendingResolvers.push({
      generation,
      resolve: (token) => {
        if (registerInflightGeneration === generation) {
          registerInflight = null;
          registerInflightGeneration = null;
        }
        resolve(token);
      },
      reject: (error) => {
        if (registerInflightGeneration === generation) {
          registerInflight = null;
          registerInflightGeneration = null;
        }
        reject(error);
      },
    });
    registerTimeout = setTimeout(() => {
      if (registerInflightGeneration !== generation) return;
      clearRegisterTimeout();
      registerInflight = null;
      registerInflightGeneration = null;
      activeRegistrationGeneration = null;
      rejectPending(new Error("FCM registration timed out"), generation);
    }, REGISTER_TIMEOUT_MS);
    PushNotifications.register().catch((error) => {
      if (registerInflightGeneration !== generation) return;
      const err = error instanceof Error ? error : new Error(String(error));
      clearRegisterTimeout();
      registerInflight = null;
      registerInflightGeneration = null;
      activeRegistrationGeneration = null;
      rejectPending(err, generation);
    });
  });
  registerInflight = promise;
  registerInflightGeneration = generation;
  return promise;
}

/**
 * Unregister the current FCM token from the server and the native plugin.
 */
export async function unregisterNativePushToken(): Promise<void> {
  if (!isNativePlatform()) return;

  const generation = getAuthGeneration();
  const token = cachedToken;
  let failure: { error: unknown } | null = null;

  if (token) {
    try {
      if (getAuthGeneration() !== generation) {
        throw new Error("Native push account changed during sign-out");
      }
      await postUnsubscribe(token);
      if (getAuthGeneration() !== generation) {
        throw new Error("Native push account changed during sign-out");
      }
    } catch (error: unknown) {
      failure = { error };
    }
  }

  try {
    await unregisterNativePushTokenLocally();
  } catch (error: unknown) {
    if (failure === null) failure = { error };
  }

  if (failure !== null) throw failure.error;
}

export function invalidateNativeRegistration(): void {
  activeRegistrationGeneration = null;
  clearRegisterTimeout();
  registerInflight = null;
  registerInflightGeneration = null;
  rejectPending(new Error("Native push registration expired"));
  cachedToken = null;
  lastPostedToken = null;
  notifySubscribers(null);
}

/** Test-only: reset module state between tests. */
export function __resetNativeRegistrationForTests(): void {
  activeRegistrationGeneration = null;
  clearRegisterTimeout();
  cachedToken = null;
  lastPostedToken = null;
  listenersAttached = false;
  attachPromise = null;
  registerInflight = null;
  registerInflightGeneration = null;
  pendingResolvers.splice(0);
  subscribers.clear();
}
