import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { useNotificationNavigation } from "./use-notification-navigation";

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (url: string) => mockPush(url) }),
}));

type PostMessageSpy = Mock<(message: unknown) => void>;

class FakeServiceWorkerContainer extends EventTarget {
  controller: { postMessage: PostMessageSpy } | null;
  ready: Promise<unknown>;

  constructor() {
    super();
    this.controller = { postMessage: vi.fn() };
    this.ready = Promise.resolve({});
  }

  receive(data: unknown, ports: MessagePort[] = []): void {
    this.dispatchEvent(new MessageEvent("message", { data, ports }));
  }
}

const originalNavigator = globalThis.navigator;
let serviceWorker: FakeServiceWorkerContainer;

/** Lets the hook's async handshake settle before assertions. */
function settle(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

describe("useNotificationNavigation", () => {
  beforeEach(() => {
    mockPush.mockClear();
    serviceWorker = new FakeServiceWorkerContainer();
    Object.defineProperty(globalThis, "navigator", {
      value: { ...originalNavigator, serviceWorker },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  it("pushes an /app/ or /room/ path relayed by the worker", async () => {
    renderHook(() => useNotificationNavigation());
    await waitFor(() =>
      expect(serviceWorker.controller?.postMessage).toHaveBeenCalledWith({
        type: "notification-navigate-ready",
      }),
    );

    serviceWorker.receive({ type: "notification-navigate", url: "/app" });
    serviceWorker.receive({ type: "notification-navigate", url: "/app/bill/x" });
    serviceWorker.receive({ type: "notification-navigate", url: "/room/tok-1" });

    expect(mockPush).toHaveBeenCalledTimes(3);
    expect(mockPush).toHaveBeenNthCalledWith(1, "/app");
    expect(mockPush).toHaveBeenNthCalledWith(2, "/app/bill/x");
    expect(mockPush).toHaveBeenNthCalledWith(3, "/room/tok-1");
  });

  it("acks the relay over the transferred port", async () => {
    renderHook(() => useNotificationNavigation());
    await waitFor(() =>
      expect(serviceWorker.controller?.postMessage).toHaveBeenCalledWith({
        type: "notification-navigate-ready",
      }),
    );

    const port = new MessagePort();
    const postMessage = vi.spyOn(port, "postMessage");
    serviceWorker.receive(
      { type: "notification-navigate", url: "/app/bill/x" },
      [port],
    );

    expect(postMessage).toHaveBeenCalledWith("ack");
    expect(mockPush).toHaveBeenCalledWith("/app/bill/x");
  });

  it("ignores urls that are not in-app notification paths", async () => {
    renderHook(() => useNotificationNavigation());
    await waitFor(() =>
      expect(serviceWorker.controller?.postMessage).toHaveBeenCalledWith({
        type: "notification-navigate-ready",
      }),
    );

    serviceWorker.receive({ type: "notification-navigate", url: "https://evil.example/app" });
    serviceWorker.receive({ type: "notification-navigate", url: "/api/x" });
    serviceWorker.receive({ type: "notification-navigate", url: "/appx" });
    serviceWorker.receive({ type: "notification-navigate", url: 42 });
    serviceWorker.receive({ type: "notification-navigate" });
    serviceWorker.receive({ type: "something-else", url: "/app/bill/x" });
    await settle();

    expect(mockPush).not.toHaveBeenCalled();
  });

  it("announces readiness to the controlling worker once", async () => {
    renderHook(() => useNotificationNavigation());

    await waitFor(() =>
      expect(serviceWorker.controller?.postMessage).toHaveBeenCalledWith({
        type: "notification-navigate-ready",
      }),
    );
    await settle();
    expect(serviceWorker.controller?.postMessage).toHaveBeenCalledTimes(1);
  });

  it("stays inert when service workers are unavailable", () => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });

    expect(() => renderHook(() => useNotificationNavigation())).not.toThrow();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
