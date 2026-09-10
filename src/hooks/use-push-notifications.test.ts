import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---------- Capacitor mocks (must be before importing the hook) ----------
const mockCheckPermissions = vi.fn();
const mockRequestPermissions = vi.fn();
const mockRegister = vi.fn();
const mockUnregister = vi.fn();
let mockIsNativePlatform = false;

type RegistrationHandler = (payload: { value: string }) => void | Promise<void>;
type RegistrationErrorHandler = (payload: { error: string }) => void;
let registrationHandler: RegistrationHandler | null = null;

const mockAddListener = vi.fn(
  (
    event: string,
    handler: RegistrationHandler | RegistrationErrorHandler,
  ) => {
    if (event === "registration") {
      registrationHandler = handler as RegistrationHandler;
    }
    return Promise.resolve({ remove: vi.fn() });
  },
);

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => mockIsNativePlatform,
  },
}));

vi.mock("@capacitor/push-notifications", () => ({
  PushNotifications: {
    checkPermissions: (...args: unknown[]) => mockCheckPermissions(...args),
    requestPermissions: (...args: unknown[]) => mockRequestPermissions(...args),
    register: (...args: unknown[]) => mockRegister(...args),
    unregister: (...args: unknown[]) => mockUnregister(...args),
    addListener: (...args: unknown[]) =>
      mockAddListener(
        args[0] as string,
        args[1] as RegistrationHandler | RegistrationErrorHandler,
      ),
  },
}));

import { usePushNotifications } from "./use-push-notifications";
import { __resetNativeRegistrationForTests } from "@/lib/push/native-registration";

describe("usePushNotifications", () => {
  const originalNavigator = globalThis.navigator;
  const originalNotification = globalThis.Notification;

  let mockPushManager: {
    getSubscription: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  };
  let mockRegistration: { pushManager: typeof mockPushManager };

  const VAPID_KEY =
    "BBFHYPW1DmrRx70PNTDn7G7v6GYpyno04I0DwwVdBwQaqek4oi65LJ34e-p4meJR7VfEn5UBpOeoVHGMYzGCpwc";

  /** The bytes the hook derives from the configured key. */
  function configuredKeyBytes(): ArrayBuffer {
    const padding = "=".repeat((4 - (VAPID_KEY.length % 4)) % 4);
    const base64 = (VAPID_KEY + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes.buffer;
  }

  function subscriptionWithCurrentKey() {
    return {
      endpoint: "https://fcm.example.com/abc",
      options: { applicationServerKey: configuredKeyBytes() },
      unsubscribe: vi.fn().mockResolvedValue(true),
      toJSON: () => ({
        endpoint: "https://fcm.example.com/abc",
        keys: { p256dh: "pk", auth: "ak" },
      }),
    };
  }

  async function settle() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }

  beforeEach(() => {
    mockIsNativePlatform = false;
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = VAPID_KEY;
    __resetNativeRegistrationForTests();
    registrationHandler = null;
    mockAddListener.mockClear();
    mockCheckPermissions.mockReset();
    mockRequestPermissions.mockReset();
    mockRegister.mockReset().mockResolvedValue(undefined);
    mockUnregister.mockReset().mockResolvedValue(undefined);

    mockPushManager = {
      getSubscription: vi.fn().mockResolvedValue(null),
      subscribe: vi.fn(),
    };
    mockRegistration = { pushManager: mockPushManager };

    // Mock navigator.serviceWorker
    Object.defineProperty(globalThis, "navigator", {
      value: {
        ...originalNavigator,
        serviceWorker: {
          ready: Promise.resolve(mockRegistration),
        },
      },
      writable: true,
      configurable: true,
    });

    // Mock PushManager on window
    Object.defineProperty(globalThis, "PushManager", {
      value: class {},
      writable: true,
      configurable: true,
    });

    // Mock Notification
    Object.defineProperty(globalThis, "Notification", {
      value: Object.assign(vi.fn(), { permission: "default", requestPermission: vi.fn() }),
      writable: true,
      configurable: true,
    });

    // Mock fetch: status answers "owned", subscribe answers ok.
    globalThis.fetch = vi.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(url === "/api/push/status" ? { subscribed: true } : { ok: true }),
      }),
    );
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis, "Notification", {
      value: originalNotification,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it("returns unsupported when PushManager is not available", () => {
    // Remove PushManager
    delete (globalThis as Record<string, unknown>)["PushManager"];

    const { result } = renderHook(() => usePushNotifications());
    expect(result.current.permission).toBe("unsupported");
    expect(result.current.isSubscribed).toBe(false);
    expect(result.current.isNative).toBe(false);
  });

  it("starts isInitializing true, flips to false once mount check resolves", async () => {
    mockPushManager.getSubscription.mockResolvedValue(null);

    const { result } = renderHook(() => usePushNotifications());
    expect(result.current.isInitializing).toBe(true);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(result.current.isInitializing).toBe(false);
  });

  it("reports subscribed only when the server says this account owns the endpoint", async () => {
    mockPushManager.getSubscription.mockResolvedValue(subscriptionWithCurrentKey());
    globalThis.fetch = vi.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(url === "/api/push/status" ? { subscribed: true } : { ok: true }),
      }),
    );

    const { result } = renderHook(() => usePushNotifications());
    await settle();

    expect(result.current.isSubscribed).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("re-uploads the subscription when the server row is gone", async () => {
    const sub = subscriptionWithCurrentKey();
    mockPushManager.getSubscription.mockResolvedValue(sub);
    const calls: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      calls.push(url);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(url === "/api/push/status" ? { subscribed: false } : { ok: true }),
      });
    });

    const { result } = renderHook(() => usePushNotifications());
    await settle();

    // No gesture involved: a lost row is repaired on init.
    expect(calls).toEqual(["/api/push/status", "/api/push/subscribe"]);
    expect(result.current.isSubscribed).toBe(true);
  });

  it("replaces a subscription made with a rotated VAPID key", async () => {
    const stale = {
      endpoint: "https://fcm.example.com/stale",
      options: { applicationServerKey: new Uint8Array([9, 9, 9]).buffer },
      unsubscribe: vi.fn().mockResolvedValue(true),
      toJSON: () => ({ endpoint: "https://fcm.example.com/stale" }),
    };
    const fresh = subscriptionWithCurrentKey();
    mockPushManager.getSubscription.mockResolvedValue(stale);
    mockPushManager.subscribe.mockResolvedValue(fresh);
    (globalThis.Notification as unknown as { permission: string }).permission = "granted";

    const { result } = renderHook(() => usePushNotifications());
    await settle();

    expect(stale.unsubscribe).toHaveBeenCalled();
    expect(mockPushManager.subscribe).toHaveBeenCalled();
    expect(result.current.isSubscribed).toBe(true);
  });

  it("is not subscribed, with a retryable error, when the server rejects the upload", async () => {
    mockPushManager.getSubscription.mockResolvedValue(subscriptionWithCurrentKey());
    globalThis.fetch = vi.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: url !== "/api/push/subscribe",
        json: () => Promise.resolve(url === "/api/push/status" ? { subscribed: false } : {}),
      }),
    );

    const { result } = renderHook(() => usePushNotifications());
    await settle();

    expect(result.current.isSubscribed).toBe(false);
    expect(result.current.error?.code).toBe("server");
    expect(result.current.error?.retryable).toBe(true);
  });

  it("subscribe requests permission and saves subscription", async () => {
    const mockSub = {
      endpoint: "https://fcm.example.com/new",
      toJSON: () => ({
        endpoint: "https://fcm.example.com/new",
        keys: { p256dh: "pk", auth: "ak" },
      }),
      unsubscribe: vi.fn(),
    };

    (Notification.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue("granted");
    mockPushManager.subscribe.mockResolvedValue(mockSub);

    // Set VAPID key
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "BBFHYPW1DmrRx70PNTDn7G7v6GYpyno04I0DwwVdBwQaqek4oi65LJ34e-p4meJR7VfEn5UBpOeoVHGMYzGCpwc";

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.subscribe();
    });

    expect(Notification.requestPermission).toHaveBeenCalled();
    expect(mockPushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(ArrayBuffer),
    });
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/push/subscribe", expect.objectContaining({
      method: "POST",
    }));
    expect(result.current.isSubscribed).toBe(true);

    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  });

  it("subscribe does not proceed when permission denied", async () => {
    (Notification.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue("denied");

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await result.current.subscribe();
    });

    expect(result.current.permission).toBe("denied");
    expect(result.current.isSubscribed).toBe(false);
    expect(mockPushManager.subscribe).not.toHaveBeenCalled();
  });

  it("unsubscribe removes subscription", async () => {
    const existingSub = {
      endpoint: "https://fcm.example.com/abc",
      unsubscribe: vi.fn().mockResolvedValue(true),
    };
    mockPushManager.getSubscription.mockResolvedValue(existingSub);

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    await act(async () => {
      await result.current.unsubscribe();
    });

    expect(existingSub.unsubscribe).toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/push/unsubscribe", expect.objectContaining({
      method: "POST",
    }));
    expect(result.current.isSubscribed).toBe(false);
  });

  // --- Native (Capacitor) tests ---

  describe("native platform", () => {
    beforeEach(() => {
      mockIsNativePlatform = true;
    });

    async function fireRegistration(token: string): Promise<void> {
      // Wait until the native-registration module has attached the listener
      await vi.waitFor(() => {
        expect(registrationHandler).not.toBeNull();
      });
      await registrationHandler!({ value: token });
    }

    it("returns isNative true on native platform", async () => {
      mockCheckPermissions.mockResolvedValue({ receive: "prompt" });

      const { result } = renderHook(() => usePushNotifications());
      expect(result.current.isNative).toBe(true);

      // Let the mount-time check resolve
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    });

    it("re-registers FCM token on startup when permission is already granted", async () => {
      mockCheckPermissions.mockResolvedValue({ receive: "granted" });

      const { result } = renderHook(() => usePushNotifications());

      await act(async () => {
        await fireRegistration("startup-token");
        await new Promise((r) => setTimeout(r, 10));
      });

      expect(mockRegister).toHaveBeenCalled();
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/push/subscribe",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ token: "startup-token", channel: "fcm" }),
        }),
      );
      expect(result.current.permission).toBe("granted");
      expect(result.current.isSubscribed).toBe(true);
    });

    it("maps prompt permission to default and skips startup registration", async () => {
      mockCheckPermissions.mockResolvedValue({ receive: "prompt" });

      const { result } = renderHook(() => usePushNotifications());

      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      expect(result.current.permission).toBe("default");
      expect(result.current.isSubscribed).toBe(false);
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it("maps prompt-with-rationale to default", async () => {
      mockCheckPermissions.mockResolvedValue({ receive: "prompt-with-rationale" });

      const { result } = renderHook(() => usePushNotifications());

      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      expect(result.current.permission).toBe("default");
    });

    it("maps denied native permission correctly", async () => {
      mockCheckPermissions.mockResolvedValue({ receive: "denied" });

      const { result } = renderHook(() => usePushNotifications());

      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      expect(result.current.permission).toBe("denied");
      expect(result.current.isSubscribed).toBe(false);
      expect(mockRegister).not.toHaveBeenCalled();
    });

    it("native subscribe requests permission, registers, and POSTs token", async () => {
      mockCheckPermissions.mockResolvedValue({ receive: "prompt" });
      mockRequestPermissions.mockResolvedValue({ receive: "granted" });

      const { result } = renderHook(() => usePushNotifications());

      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      const subscribePromise = act(async () => {
        await result.current.subscribe();
      });

      await act(async () => {
        await fireRegistration("opt-in-token");
      });

      await subscribePromise;

      expect(mockRequestPermissions).toHaveBeenCalled();
      expect(mockRegister).toHaveBeenCalled();
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/push/subscribe",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ token: "opt-in-token", channel: "fcm" }),
        }),
      );
      expect(result.current.permission).toBe("granted");
      expect(result.current.isSubscribed).toBe(true);
    });

    it("native subscribe does not register when denied", async () => {
      mockCheckPermissions.mockResolvedValue({ receive: "prompt" });
      mockRequestPermissions.mockResolvedValue({ receive: "denied" });

      const { result } = renderHook(() => usePushNotifications());

      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      await act(async () => {
        await result.current.subscribe();
      });

      expect(mockRequestPermissions).toHaveBeenCalled();
      expect(mockRegister).not.toHaveBeenCalled();
      expect(result.current.permission).toBe("denied");
      expect(result.current.isSubscribed).toBe(false);
    });

    it("native unsubscribe POSTs token and calls PushNotifications.unregister", async () => {
      mockCheckPermissions.mockResolvedValue({ receive: "granted" });

      const { result } = renderHook(() => usePushNotifications());

      await act(async () => {
        await fireRegistration("live-token");
        await new Promise((r) => setTimeout(r, 10));
      });

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();

      await act(async () => {
        await result.current.unsubscribe();
      });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/push/unsubscribe",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ token: "live-token", channel: "fcm" }),
        }),
      );
      expect(mockUnregister).toHaveBeenCalled();
      expect(result.current.isSubscribed).toBe(false);
    });

    it("does not use web push APIs on native", async () => {
      mockCheckPermissions.mockResolvedValue({ receive: "prompt" });
      mockRequestPermissions.mockResolvedValue({ receive: "granted" });

      const { result } = renderHook(() => usePushNotifications());

      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });

      const subscribePromise = act(async () => {
        await result.current.subscribe();
      });

      await act(async () => {
        await fireRegistration("native-only-token");
      });

      await subscribePromise;

      expect(mockPushManager.subscribe).not.toHaveBeenCalled();
    });
  });
});
