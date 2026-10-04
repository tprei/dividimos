import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type RegistrationHandler = (payload: { value: string }) => void | Promise<void>;
type RegistrationErrorHandler = (payload: { error: string }) => void;

let mockIsNativePlatform = true;
let mockPlatform = "ios";
let mockFcmPluginAvailable = true;
let registrationHandler: RegistrationHandler | null = null;
let registrationErrorHandler: RegistrationErrorHandler | null = null;

const mockAddListener = vi.fn(
  (
    event: string,
    handler: RegistrationHandler | RegistrationErrorHandler,
  ) => {
    if (event === "registration") {
      registrationHandler = handler as RegistrationHandler;
    } else if (event === "registrationError") {
      registrationErrorHandler = handler as RegistrationErrorHandler;
    }
    return Promise.resolve({ remove: vi.fn() });
  },
);
const mockRegister = vi.fn();
const mockUnregister = vi.fn();
const mockDeleteToken = vi.fn();

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => mockIsNativePlatform,
    getPlatform: () => mockPlatform,
    isPluginAvailable: (name: string) =>
      name === "FcmToken" && mockFcmPluginAvailable,
  },
}));

vi.mock("./fcm-token-plugin", () => ({
  FcmToken: { deleteToken: (...args: unknown[]) => mockDeleteToken(...args) },
}));

vi.mock("@capacitor/push-notifications", () => ({
  PushNotifications: {
    addListener: (...args: unknown[]) =>
      mockAddListener(
        args[0] as string,
        args[1] as RegistrationHandler | RegistrationErrorHandler,
      ),
    register: (...args: unknown[]) => mockRegister(...args),
    unregister: (...args: unknown[]) => mockUnregister(...args),
  },
}));

import {
  __resetNativeRegistrationForTests,
  getCachedFcmToken,
  registerNativePushToken,
  subscribeToFcmToken,
  unregisterNativePushToken,
} from "./native-registration";

describe("native-registration", () => {
  beforeEach(() => {
    __resetNativeRegistrationForTests();
    mockIsNativePlatform = true;
    mockPlatform = "ios";
    mockFcmPluginAvailable = true;
    registrationHandler = null;
    registrationErrorHandler = null;
    mockAddListener.mockClear();
    mockRegister.mockReset().mockResolvedValue(undefined);
    mockUnregister.mockReset().mockResolvedValue(undefined);
    mockDeleteToken.mockReset().mockResolvedValue(undefined);
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null on web platforms", async () => {
    mockIsNativePlatform = false;
    const token = await registerNativePushToken();
    expect(token).toBeNull();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("registers, captures token from listener, and POSTs to server", async () => {
    const resultPromise = registerNativePushToken();

    // Wait for listeners to attach + register() to be called
    await vi.waitFor(() => {
      expect(mockRegister).toHaveBeenCalled();
      expect(registrationHandler).not.toBeNull();
    });

    await registrationHandler!({ value: "fcm-token-abc" });

    const token = await resultPromise;
    expect(token).toBe("fcm-token-abc");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/push/subscribe",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ token: "fcm-token-abc", channel: "fcm" }),
      }),
    );
    expect(getCachedFcmToken()).toBe("fcm-token-abc");
  });

  it("rejects when registrationError fires", async () => {
    const resultPromise = registerNativePushToken();

    await vi.waitFor(() => {
      expect(registrationErrorHandler).not.toBeNull();
    });

    registrationErrorHandler!({ error: "network unavailable" });

    await expect(resultPromise).rejects.toThrow("network unavailable");
  });

  it("rejects when server returns non-ok for the subscribe POST", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    const resultPromise = registerNativePushToken();

    await vi.waitFor(() => {
      expect(registrationHandler).not.toBeNull();
    });

    await registrationHandler!({ value: "fcm-token-fail" });

    await expect(resultPromise).rejects.toThrow(/500/);
  });
  it("does not publish a token when auth changes during server registration", async () => {
    const { promise, resolve } = Promise.withResolvers<{ ok: boolean; status: number }>();
    globalThis.fetch = vi.fn().mockReturnValue(promise);

    const resultPromise = registerNativePushToken();
    await vi.waitFor(() => expect(registrationHandler).not.toBeNull());
    const registration = registrationHandler!({ value: "stale-token" });

    const { advanceAuthGeneration } = await import("@/lib/sync/client");
    advanceAuthGeneration();
    resolve({ ok: true, status: 200 });

    await registration;
    await expect(resultPromise).rejects.toThrow("expired");
    expect(getCachedFcmToken()).toBeNull();
  });

  it("reuses attached listeners across multiple register calls", async () => {
    const firstPromise = registerNativePushToken();

    await vi.waitFor(() => {
      expect(registrationHandler).not.toBeNull();
    });

    await registrationHandler!({ value: "token-1" });
    await firstPromise;

    mockAddListener.mockClear();

    const secondPromise = registerNativePushToken();
    await vi.waitFor(() => {
      expect(mockRegister).toHaveBeenCalledTimes(2);
    });

    await registrationHandler!({ value: "token-2" });
    expect(await secondPromise).toBe("token-2");

    // Listeners should only be attached once across both calls
    const registrationAdds = mockAddListener.mock.calls.filter(
      (args) => args[0] === "registration",
    );
    expect(registrationAdds).toHaveLength(0);
  });

  it("re-POSTs refreshed tokens via the persistent listener", async () => {
    const promise = registerNativePushToken();
    await vi.waitFor(() => {
      expect(registrationHandler).not.toBeNull();
    });
    await registrationHandler!({ value: "token-1" });
    await promise;

    // Token refresh (listener fires again, no pending caller)
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();
    await registrationHandler!({ value: "token-refreshed" });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/push/subscribe",
      expect.objectContaining({
        body: JSON.stringify({ token: "token-refreshed", channel: "fcm" }),
      }),
    );
    expect(getCachedFcmToken()).toBe("token-refreshed");
  });

  it("notifies subscribers when the token changes", async () => {
    const listener = vi.fn();
    const unsub = subscribeToFcmToken(listener);

    const promise = registerNativePushToken();
    await vi.waitFor(() => expect(registrationHandler).not.toBeNull());
    await registrationHandler!({ value: "notified-token" });
    await promise;

    expect(listener).toHaveBeenCalledWith("notified-token");
    unsub();
  });

  it("unregister POSTs unsubscribe and calls native unregister", async () => {
    const promise = registerNativePushToken();
    await vi.waitFor(() => expect(registrationHandler).not.toBeNull());
    await registrationHandler!({ value: "token-to-remove" });
    await promise;

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();
    await unregisterNativePushToken();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/push/unsubscribe",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ token: "token-to-remove", channel: "fcm" }),
      }),
    );
    expect(mockUnregister).toHaveBeenCalled();
    expect(getCachedFcmToken()).toBeNull();
  });

  it("unregister is a no-op on web platforms", async () => {
    mockIsNativePlatform = false;
    await unregisterNativePushToken();
    expect(mockUnregister).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("clears local state when server unsubscribe fails", async () => {
    const promise = registerNativePushToken();
    await vi.waitFor(() => expect(registrationHandler).not.toBeNull());
    await registrationHandler!({ value: "token-x" });
    await promise;

    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network"));
    await expect(unregisterNativePushToken()).rejects.toThrow("network");
    expect(mockUnregister).toHaveBeenCalled();
    expect(getCachedFcmToken()).toBeNull();
  });
  it("clears local state after the server detaches despite a bridge failure", async () => {
    const promise = registerNativePushToken();
    await vi.waitFor(() => expect(registrationHandler).not.toBeNull());
    await registrationHandler!({ value: "token-bridge-failure" });
    await promise;

    mockUnregister.mockRejectedValueOnce(new Error("bridge unavailable"));
    await expect(unregisterNativePushToken()).resolves.toBeUndefined();
    expect(getCachedFcmToken()).toBeNull();
  });

  it("deletes the FCM token through the iOS companion plugin on local unregister", async () => {
    const promise = registerNativePushToken();
    await vi.waitFor(() => expect(registrationHandler).not.toBeNull());
    await registrationHandler!({ value: "ios-token" });
    await promise;
    expect(getCachedFcmToken()).toBe("ios-token");

    const { unregisterNativePushTokenLocally } = await import(
      "./native-registration"
    );
    await unregisterNativePushTokenLocally();

    expect(mockUnregister).toHaveBeenCalled();
    expect(mockDeleteToken).toHaveBeenCalledTimes(1);
    expect(getCachedFcmToken()).toBeNull();
  });

  it("still clears the cached token when the FCM deletion fails", async () => {
    const promise = registerNativePushToken();
    await vi.waitFor(() => expect(registrationHandler).not.toBeNull());
    await registrationHandler!({ value: "ios-token-fail" });
    await promise;

    mockDeleteToken.mockRejectedValueOnce(new Error("firebase unavailable"));
    const { unregisterNativePushTokenLocally } = await import(
      "./native-registration"
    );
    await expect(unregisterNativePushTokenLocally()).resolves.toBeUndefined();

    expect(getCachedFcmToken()).toBeNull();
  });

  it("finishes a failed FCM deletion before registering the next account", async () => {
    const { unregisterNativePushTokenLocally } = await import("./native-registration");
    mockDeleteToken.mockRejectedValueOnce(new Error("firebase unavailable"));
    await unregisterNativePushTokenLocally();

    mockDeleteToken.mockRejectedValueOnce(new Error("still unavailable"));
    await expect(registerNativePushToken()).rejects.toThrow("still unavailable");
    expect(mockRegister).not.toHaveBeenCalled();

    const promise = registerNativePushToken();
    await vi.waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
    expect(mockDeleteToken).toHaveBeenCalledTimes(3);
    await registrationHandler!({ value: "ios-token-next" });
    await expect(promise).resolves.toBe("ios-token-next");
  });

  it("waits for an account switch's detach before registering, keeping the new token", async () => {
    const { unregisterNativePushTokenLocally } = await import("./native-registration");
    const deletion = Promise.withResolvers<void>();
    mockDeleteToken.mockReturnValueOnce(deletion.promise);
    const detach = unregisterNativePushTokenLocally();
    await vi.waitFor(() => expect(mockDeleteToken).toHaveBeenCalledTimes(1));

    const promise = registerNativePushToken();
    await vi.waitFor(() => expect(registrationHandler).not.toBeNull());
    expect(mockRegister).not.toHaveBeenCalled();

    deletion.resolve();
    await detach;
    await vi.waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1));
    await registrationHandler!({ value: "ios-token-b" });

    await expect(promise).resolves.toBe("ios-token-b");
    expect(getCachedFcmToken()).toBe("ios-token-b");
  });

  it("skips the FCM deletion when the plugin is not installed on iOS", async () => {
    mockFcmPluginAvailable = false;
    const promise = registerNativePushToken();
    await vi.waitFor(() => expect(registrationHandler).not.toBeNull());
    await registrationHandler!({ value: "old-build-token" });
    await promise;

    const { unregisterNativePushTokenLocally } = await import(
      "./native-registration"
    );
    await unregisterNativePushTokenLocally();

    expect(mockUnregister).toHaveBeenCalled();
    expect(mockDeleteToken).not.toHaveBeenCalled();
    expect(getCachedFcmToken()).toBeNull();
  });

  it("never touches the FCM token plugin on Android", async () => {
    mockPlatform = "android";
    const promise = registerNativePushToken();
    await vi.waitFor(() => expect(registrationHandler).not.toBeNull());
    await registrationHandler!({ value: "android-token" });
    await promise;

    const { unregisterNativePushTokenLocally } = await import(
      "./native-registration"
    );
    await unregisterNativePushTokenLocally();

    expect(mockUnregister).toHaveBeenCalled();
    expect(mockDeleteToken).not.toHaveBeenCalled();
    expect(getCachedFcmToken()).toBeNull();
  });

  it("drops a token that arrives after an account switch ran the local detach", async () => {
    const resultPromise = registerNativePushToken();
    await vi.waitFor(() => expect(registrationHandler).not.toBeNull());

    // A -> B: the auth listener advances the generation and runs the local
    // detach, then Firebase delivers the token A's registration asked for.
    const { advanceAuthGeneration } = await import("@/lib/sync/client");
    advanceAuthGeneration();
    const { unregisterNativePushTokenLocally } = await import(
      "./native-registration"
    );
    await unregisterNativePushTokenLocally();

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = fetchMock;
    await registrationHandler!({ value: "token-of-a" });

    await expect(resultPromise).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getCachedFcmToken()).toBeNull();
  });

  it("recovers from a failed listener attach without duplicating listeners", async () => {
    // Counts listeners that are actually live on the plugin, so a retry that
    // leaves an orphan behind shows up here.
    const live: string[] = [];
    let failFirst = true;
    mockAddListener.mockImplementation((event, handler) => {
      if (failFirst) {
        failFirst = false;
        return Promise.reject(new Error("bridge unavailable"));
      }
      if (event === "registration") {
        registrationHandler = handler as RegistrationHandler;
      } else {
        registrationErrorHandler = handler as RegistrationErrorHandler;
      }
      live.push(event);
      return Promise.resolve({
        remove: vi.fn().mockImplementation(() => {
          live.splice(live.indexOf(event), 1);
          return Promise.resolve();
        }),
      });
    });

    await expect(registerNativePushToken()).rejects.toThrow("bridge unavailable");

    const retry = registerNativePushToken();
    await vi.waitFor(() => expect(registrationHandler).not.toBeNull());
    registrationHandler?.({ value: "token-after-retry" });
    await expect(retry).resolves.toBe("token-after-retry");

    expect(live.filter((e) => e === "registration")).toHaveLength(1);
    expect(live.filter((e) => e === "registrationError")).toHaveLength(1);
  });

  it("removes an already-attached listener when a later attach fails", async () => {
    const removeFirst = vi.fn().mockResolvedValue(undefined);
    mockAddListener
      .mockImplementationOnce(() => Promise.resolve({ remove: removeFirst }))
      .mockImplementationOnce(() => Promise.reject(new Error("second failed")));

    await expect(registerNativePushToken()).rejects.toThrow("second failed");

    await vi.waitFor(() => expect(removeFirst).toHaveBeenCalledTimes(1));
  });
});