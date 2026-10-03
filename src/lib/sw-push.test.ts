import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Tests for push notification handling in the service worker.
 */

type EventHandler = (event: Record<string, unknown>) => void;

/**
 * Peer-linked ports, so a fake window client can ack the relay by posting on
 * the transferred port and the worker's port1.onmessage fires.
 */
class FakeMessagePort {
  peer: FakeMessagePort | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  postMessage(data: unknown): void {
    queueMicrotask(() => this.peer?.onmessage?.({ data }));
  }
}

class FakeMessageChannel {
  port1 = new FakeMessagePort();
  port2 = new FakeMessagePort();

  constructor() {
    this.port1.peer = this.port2;
    this.port2.peer = this.port1;
  }
}

function createSWEnv(origin = "https://dividimos.app") {
  const listeners: Record<string, EventHandler[]> = {};

  const registration = {
    showNotification: vi.fn(async () => {}),
  };

  const env: Record<string, unknown> = {
    self: {},
    caches: {
      open: vi.fn(async () => ({
        addAll: vi.fn(async () => {}),
        put: vi.fn(async () => {}),
        match: vi.fn(async () => undefined),
      })),
      keys: vi.fn(async () => []),
      delete: vi.fn(async () => true),
    },
    clients: {
      claim: vi.fn(async () => {}),
      matchAll: vi.fn(async () => []),
      openWindow: vi.fn(async () => null),
    },
    location: new URL(origin),
    skipWaiting: vi.fn(),
    fetch: vi.fn(),
    addEventListener: (type: string, handler: EventHandler) => {
      (listeners[type] ??= []).push(handler);
    },
    registration,
    Response: class {
      ok = true;
      clone() { return this; }
    },
    Request: class {
      url: string;
      method = "GET";
      mode = "cors";
      constructor(url: string) { this.url = url; }
    },
    URL,
    Promise,
    Set,
    console,
    JSON,
    MessageChannel: FakeMessageChannel,
  };
  env.self = env;

  return { env, listeners, registration, clients: env.clients as {
    matchAll: ReturnType<typeof vi.fn>;
    openWindow: ReturnType<typeof vi.fn>;
  }};
}

function loadSW(env: Record<string, unknown>) {
  const src = readFileSync(resolve(__dirname, "../../public/sw.js"), "utf-8");
  const keys = Object.keys(env);
  const values = keys.map((k) => env[k]);
  const factory = new Function(...keys, src);
  factory(...values);
}

function makeExtendableEvent() {
  const promises: Promise<unknown>[] = [];
  return {
    waitUntil: (p: Promise<unknown>) => { promises.push(p); },
    _promises: promises,
  };
}

describe("Service Worker — push events", () => {
  let sw: ReturnType<typeof createSWEnv>;

  beforeEach(() => {
    sw = createSWEnv();
    loadSW(sw.env);
  });

  describe("push event", () => {
    it("shows notification with JSON payload", async () => {
      const payload = {
        title: "Nova despesa",
        body: "Alice adicionou uma despesa de R$ 50,00",
        url: "/app/groups/123",
        tag: "expense-456",
      };

      const event = {
        ...makeExtendableEvent(),
        data: {
          json: () => payload,
          text: () => JSON.stringify(payload),
        },
      };

      sw.listeners["push"]![0]!(event);
      await Promise.all(event._promises);

      expect(sw.registration.showNotification).toHaveBeenCalledWith("Nova despesa", {
        body: "Alice adicionou uma despesa de R$ 50,00",
        icon: "/icon-192.png",
        badge: "/badge-72.png",
        tag: "expense-456",
        data: { url: "/app/groups/123" },
      });
    });

    it("falls back to text when JSON parsing fails", async () => {
      const event = {
        ...makeExtendableEvent(),
        data: {
          json: () => { throw new Error("not json"); },
          text: () => "Plain text message",
        },
      };

      sw.listeners["push"]![0]!(event);
      await Promise.all(event._promises);

      expect(sw.registration.showNotification).toHaveBeenCalledWith("Dividimos", {
        body: "Plain text message",
        icon: "/icon-192.png",
        badge: "/badge-72.png",
        tag: undefined,
        data: { url: "/" },
      });
    });

    it("does nothing when push has no data", () => {
      const event = {
        ...makeExtendableEvent(),
        data: null,
      };

      sw.listeners["push"]![0]!(event);
      expect(event._promises).toHaveLength(0);
      expect(sw.registration.showNotification).not.toHaveBeenCalled();
    });
  });

  describe("notificationclick event", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("focuses the window, relays the url, and skips navigate when it acks", async () => {
      vi.useFakeTimers();
      const mockClient = {
        url: "https://dividimos.app/app",
        focus: vi.fn(async () => mockClient),
        postMessage: vi.fn((_data: unknown, transfer: FakeMessagePort[]) => {
          transfer[0].postMessage("ack");
        }),
        navigate: vi.fn(async () => mockClient),
      };
      sw.clients.matchAll.mockResolvedValue([mockClient]);

      const event = {
        ...makeExtendableEvent(),
        notification: {
          close: vi.fn(),
          data: { url: "/app/groups/123" },
        },
      };

      sw.listeners["notificationclick"]![0]!(event);
      await Promise.all(event._promises);
      await vi.advanceTimersByTimeAsync(1500);

      expect(event.notification.close).toHaveBeenCalled();
      expect(mockClient.focus).toHaveBeenCalled();
      expect(mockClient.postMessage).toHaveBeenCalled();
      expect(mockClient.navigate).not.toHaveBeenCalled();
    });

    it("navigates to the absolute url when no ack arrives in time", async () => {
      vi.useFakeTimers();
      const mockClient = {
        url: "https://dividimos.app/app",
        focus: vi.fn(async () => mockClient),
        postMessage: vi.fn(),
        navigate: vi.fn(async () => mockClient),
      };
      sw.clients.matchAll.mockResolvedValue([mockClient]);

      const event = {
        ...makeExtendableEvent(),
        notification: {
          close: vi.fn(),
          data: { url: "/app/groups/123" },
        },
      };

      sw.listeners["notificationclick"]![0]!(event);
      await vi.advanceTimersByTimeAsync(1500);

      expect(mockClient.focus).toHaveBeenCalled();
      expect(mockClient.navigate).toHaveBeenCalledWith(
        "https://dividimos.app/app/groups/123",
      );
      await Promise.all(event._promises);
    });

    it("opens new window when no client exists", async () => {
      sw.clients.matchAll.mockResolvedValue([]);

      const event = {
        ...makeExtendableEvent(),
        notification: {
          close: vi.fn(),
          data: { url: "/app/settings" },
        },
      };

      sw.listeners["notificationclick"]![0]!(event);
      await Promise.all(event._promises);

      expect(sw.clients.openWindow).toHaveBeenCalledWith("https://dividimos.app/app/settings");
    });

    it("defaults to /app when notification has no URL", async () => {
      sw.clients.matchAll.mockResolvedValue([]);

      const event = {
        ...makeExtendableEvent(),
        notification: {
          close: vi.fn(),
          data: {},
        },
      };

      sw.listeners["notificationclick"]![0]!(event);
      await Promise.all(event._promises);

      expect(sw.clients.openWindow).toHaveBeenCalledWith("https://dividimos.app/app");
    });

    it("falls back to /app for javascript: URLs", async () => {
      sw.clients.matchAll.mockResolvedValue([]);

      const event = {
        ...makeExtendableEvent(),
        notification: {
          close: vi.fn(),
          data: { url: "javascript:alert(1)" },
        },
      };

      sw.listeners["notificationclick"]![0]!(event);
      await Promise.all(event._promises);

      expect(sw.clients.openWindow).toHaveBeenCalledWith("https://dividimos.app/app");
    });

    it("falls back to /app for cross-origin URLs", async () => {
      sw.clients.matchAll.mockResolvedValue([]);

      const event = {
        ...makeExtendableEvent(),
        notification: {
          close: vi.fn(),
          data: { url: "https://evil.example.com/steal" },
        },
      };

      sw.listeners["notificationclick"]![0]!(event);
      await Promise.all(event._promises);

      expect(sw.clients.openWindow).toHaveBeenCalledWith("https://dividimos.app/app");
    });

    it("falls back to /app for malformed URLs that cannot be parsed", async () => {
      sw.clients.matchAll.mockResolvedValue([]);

      const event = {
        ...makeExtendableEvent(),
        notification: {
          close: vi.fn(),
          data: { url: "http://[::bad" },
        },
      };

      sw.listeners["notificationclick"]![0]!(event);
      await Promise.all(event._promises);

      expect(sw.clients.openWindow).toHaveBeenCalledWith("https://dividimos.app/app");
    });
  });

  describe("message event", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    async function parkPendingUrl(url: string): Promise<void> {
      sw.clients.matchAll.mockResolvedValue([]);
      const event = {
        ...makeExtendableEvent(),
        notification: {
          close: vi.fn(),
          data: { url },
        },
      };
      sw.listeners["notificationclick"]![0]!(event);
      await Promise.all(event._promises);
    }

    it("replies to a fresh window with the pending url once", async () => {
      await parkPendingUrl("/app/bill/1");

      const source = { postMessage: vi.fn() };
      sw.listeners["message"]![0]!({
        data: { type: "notification-navigate-ready" },
        source,
      });
      expect(source.postMessage).toHaveBeenCalledWith({
        type: "notification-navigate",
        url: "/app/bill/1",
      });

      source.postMessage.mockClear();
      sw.listeners["message"]![0]!({
        data: { type: "notification-navigate-ready" },
        source,
      });
      expect(source.postMessage).not.toHaveBeenCalled();
    });

    it("ignores message types other than the ready handshake", () => {
      const source = { postMessage: vi.fn() };

      sw.listeners["message"]![0]!({ data: { type: "skip-waiting" }, source });
      sw.listeners["message"]![0]!({ data: null, source });
      sw.listeners["message"]![0]!({ data: undefined, source });

      expect(source.postMessage).not.toHaveBeenCalled();
    });

    it("drops the pending url once it is older than 60s", async () => {
      vi.useFakeTimers();
      await parkPendingUrl("/app/bill/1");
      vi.advanceTimersByTime(61000);

      const source = { postMessage: vi.fn() };
      sw.listeners["message"]![0]!({
        data: { type: "notification-navigate-ready" },
        source,
      });

      expect(source.postMessage).not.toHaveBeenCalled();
    });

    it("clears a parked url once a click finds an open window", async () => {
      await parkPendingUrl("/app/bill/1");

      const mockClient = {
        url: "https://dividimos.app/app",
        focus: vi.fn(async () => mockClient),
        postMessage: vi.fn((_data: unknown, transfer: FakeMessagePort[]) => {
          transfer[0].postMessage("ack");
        }),
        navigate: vi.fn(async () => mockClient),
      };
      sw.clients.matchAll.mockResolvedValue([mockClient]);
      const click = {
        ...makeExtendableEvent(),
        notification: {
          close: vi.fn(),
          data: { url: "/app/bill/2" },
        },
      };
      sw.listeners["notificationclick"]![0]!(click);
      await Promise.all(click._promises);

      const source = { postMessage: vi.fn() };
      sw.listeners["message"]![0]!({
        data: { type: "notification-navigate-ready" },
        source,
      });

      expect(source.postMessage).not.toHaveBeenCalled();
    });
  });
});
