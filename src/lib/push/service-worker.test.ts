import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetServiceWorkerForTests,
  registerServiceWorker,
  serviceWorkerReady,
} from "./service-worker";
import { PushFailure } from "./failures";

const originalNavigator = globalThis.navigator;

function setServiceWorker(value: unknown) {
  Object.defineProperty(globalThis, "navigator", {
    value: { ...originalNavigator, serviceWorker: value },
    writable: true,
    configurable: true,
  });
}

describe("serviceWorkerReady", () => {
  beforeEach(() => {
    __resetServiceWorkerForTests();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  it("fails with a worker error when activation never settles", async () => {
    const registration = { pushManager: {} };
    setServiceWorker({
      register: vi.fn().mockResolvedValue(registration),
      // Activation that never completes is the hang the deadline exists for.
      ready: new Promise(() => {}),
    });

    const error = await serviceWorkerReady(20).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PushFailure);
    expect((error as PushFailure).code).toBe("worker");
    expect((error as PushFailure).retryable).toBe(true);
  });

  it("propagates a failed registration instead of hanging", async () => {
    setServiceWorker({
      register: vi.fn().mockRejectedValue(new Error("precache failed")),
      ready: new Promise(() => {}),
    });

    const error = await serviceWorkerReady(50).catch((e: unknown) => e);
    expect((error as PushFailure).code).toBe("worker");
  });

  it("registers once and lets a later attempt retry after a failure", async () => {
    const register = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ pushManager: {} });
    const registration = { pushManager: {} };
    setServiceWorker({ register, ready: Promise.resolve(registration) });

    await expect(registerServiceWorker()).rejects.toBeInstanceOf(PushFailure);
    await expect(registerServiceWorker()).resolves.toBe(registration);
    // The success is memoized: a third caller does not re-register.
    await registerServiceWorker();
    expect(register).toHaveBeenCalledTimes(2);
  });

  it("reports unsupported when the browser has no service worker", async () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      writable: true,
      configurable: true,
    });

    const error = await serviceWorkerReady(20).catch((e: unknown) => e);
    expect((error as PushFailure).code).toBe("unsupported");
  });
});
