import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePushNotifications } from "./use-push-notifications";

describe("usePushNotifications", () => {
  const originalNavigator = globalThis.navigator;
  const originalNotification = globalThis.Notification;

  let mockPushManager: {
    getSubscription: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  };
  let mockRegistration: { pushManager: typeof mockPushManager };

  beforeEach(() => {
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

    // Mock fetch
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
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
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (globalThis as Record<string, unknown>)["PushManager"];

    const { result } = renderHook(() => usePushNotifications());
    expect(result.current.permission).toBe("unsupported");
    expect(result.current.isSubscribed).toBe(false);
  });

  it("detects existing subscription", async () => {
    const existingSub = { endpoint: "https://fcm.example.com/abc" };
    mockPushManager.getSubscription.mockResolvedValue(existingSub);

    const { result } = renderHook(() => usePushNotifications());

    // Wait for the async check to complete
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(result.current.isSubscribed).toBe(true);
    expect(result.current.permission).toBe("default");
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
});
