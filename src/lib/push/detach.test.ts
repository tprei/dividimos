import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetPendingPushDetaches,
  detachPushForSignOut,
  pendingPushDetachCount,
  retryPendingPushDetaches,
} from "./detach";
import { __resetServiceWorkerForTests } from "./service-worker";

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
    __resetPendingPushDetaches();
    __resetServiceWorkerForTests();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
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

  it("does nothing when this browser has no subscription", async () => {
    withSubscription(null);
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    await detachPushForSignOut();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
