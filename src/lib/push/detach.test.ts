import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/stores/app-store";
import {
  clearPendingPushDetaches,
  detachLocalPushForSignOut,
  detachPushForSignOut,
  pendingPushDetachCount,
  retryPendingPushDetaches,
} from "./detach";
import { __resetServiceWorkerForTests } from "./service-worker";

function setAccount(id: string): void {
  useAppStore.setState({
    me: {
      id,
      handle: id,
      name: "Alguém",
      avatarUrl: null,
      email: `${id}@example.com`,
      pixKeyType: null,
      pixKeyHint: null,
      onboarded: true,
      notificationPreferences: {
        expenses: true,
        settlements: true,
        nudges: true,
      },
    },
  });
}
const originalNavigator = globalThis.navigator;

function withSubscription(subscription: unknown) {
  const registration = {
    pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription) },
  };
  Object.defineProperty(globalThis, "navigator", {
    value: {
      ...originalNavigator,
      serviceWorker: {
        register: vi.fn().mockResolvedValue(registration),
        ready: Promise.resolve(registration),
      },
    },
    writable: true,
    configurable: true,
  });
}

describe("detachPushForSignOut", () => {
  beforeEach(() => {
    clearPendingPushDetaches();
    __resetServiceWorkerForTests();
    setAccount("account-a");
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
    useAppStore.getState().reset();
  });

  it("tells the server to drop the row and unsubscribes locally", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    withSubscription({ endpoint: "https://push.example.com/a", unsubscribe });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock;

    await detachPushForSignOut();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/push/unsubscribe",
      expect.objectContaining({ method: "POST" }),
    );
    expect(unsubscribe).toHaveBeenCalled();
    expect(pendingPushDetachCount()).toBe(0);
  });

  it("stops delivery on this device even when the server request fails", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    withSubscription({ endpoint: "https://push.example.com/b", unsubscribe });
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));

    await detachPushForSignOut();

    expect(unsubscribe).toHaveBeenCalled();
    // The unfinished server work is kept so a later attempt clears the row.
    expect(pendingPushDetachCount()).toBe(1);
  });

  it("queues the old owner and unsubscribes locally after an external sign-out", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    withSubscription({ endpoint: "https://push.example.com/external", unsubscribe });
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    await detachLocalPushForSignOut("account-a");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalled();
    expect(pendingPushDetachCount()).toBe(1);
  });

  it("clears queued detaches on a later successful attempt", async () => {
    withSubscription({
      endpoint: "https://push.example.com/c",
      unsubscribe: vi.fn().mockResolvedValue(true),
    });
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });

    await detachPushForSignOut();
    expect(pendingPushDetachCount()).toBe(1);

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    await retryPendingPushDetaches();
    expect(pendingPushDetachCount()).toBe(0);
  });
  it("keeps a failed detach for the owning account only", async () => {
    withSubscription({
      endpoint: "https://push.example.com/owned",
      unsubscribe: vi.fn().mockResolvedValue(true),
    });
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));

    await detachPushForSignOut();
    expect(pendingPushDetachCount()).toBe(1);

    setAccount("account-b");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock;
    await retryPendingPushDetaches();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(pendingPushDetachCount()).toBe(1);

    setAccount("account-a");
    await retryPendingPushDetaches();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(pendingPushDetachCount()).toBe(0);
  });

  it("does nothing when this browser has no subscription", async () => {
    withSubscription(null);
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    await detachPushForSignOut();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
