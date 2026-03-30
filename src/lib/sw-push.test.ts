import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Tests for push notification handling in the service worker.
 */

type EventHandler = (event: Record<string, unknown>) => void;

function createSWEnv(origin = "https://pixwise.app") {
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
        badge: "/icon-192.png",
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

      expect(sw.registration.showNotification).toHaveBeenCalledWith("Pixwise", {
        body: "Plain text message",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
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
    it("focuses existing window and navigates to URL", async () => {
      const mockClient = {
        url: "https://pixwise.app/app",
        focus: vi.fn(async () => mockClient),
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

      expect(event.notification.close).toHaveBeenCalled();
      expect(mockClient.navigate).toHaveBeenCalledWith("/app/groups/123");
      expect(mockClient.focus).toHaveBeenCalled();
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

      expect(sw.clients.openWindow).toHaveBeenCalledWith("/app/settings");
    });

    it("defaults to / when notification has no URL", async () => {
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

      expect(sw.clients.openWindow).toHaveBeenCalledWith("/");
    });
  });
});
