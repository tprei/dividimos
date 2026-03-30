import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Unit tests for the service worker (public/sw.js).
 *
 * We evaluate the SW script in a minimal mock environment that simulates
 * the ServiceWorkerGlobalScope APIs (caches, clients, fetch, events).
 */

// ── Helpers ──────────────────────────────────────────────────────────

/** Minimal Response mock */
class MockResponse {
  ok: boolean;
  status: number;
  body: string;
  constructor(body = "", init: { status?: number } = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
  }
  clone() {
    return new MockResponse(this.body, { status: this.status });
  }
}

/** Minimal Request mock */
class MockRequest {
  url: string;
  method: string;
  mode: string;
  constructor(url: string, init: { method?: string; mode?: string } = {}) {
    this.url = url;
    this.method = init.method ?? "GET";
    this.mode = init.mode ?? "cors";
  }
}

/** Minimal Cache mock */
function createCacheMock() {
  const store = new Map<string, unknown>();
  return {
    addAll: vi.fn(async (urls: string[]) => {
      urls.forEach((u) => store.set(u, new MockResponse(u)));
    }),
    put: vi.fn(async (req: MockRequest | string, res: unknown) => {
      const key = typeof req === "string" ? req : req.url;
      store.set(key, res);
    }),
    match: vi.fn(async (req: MockRequest | string) => {
      const key = typeof req === "string" ? req : req.url;
      return store.get(key) ?? undefined;
    }),
    _store: store,
  };
}

/** Minimal CacheStorage mock */
function createCacheStorageMock() {
  const caches = new Map<string, ReturnType<typeof createCacheMock>>();
  return {
    open: vi.fn(async (name: string) => {
      if (!caches.has(name)) caches.set(name, createCacheMock());
      return caches.get(name)!;
    }),
    keys: vi.fn(async () => Array.from(caches.keys())),
    delete: vi.fn(async (name: string) => {
      return caches.delete(name);
    }),
    match: vi.fn(async (req: MockRequest | string) => {
      const key = typeof req === "string" ? req : req.url;
      for (const cache of caches.values()) {
        const hit = cache._store.get(key);
        if (hit) return hit;
      }
      return undefined;
    }),
    _caches: caches,
  };
}

type EventHandler = (event: Record<string, unknown>) => void;

function createSWEnv(origin = "https://pixwise.app") {
  const listeners: Record<string, EventHandler[]> = {};
  const cacheStorage = createCacheStorageMock();
  const clientsClaimed = { value: false };

  const env: Record<string, unknown> = {
    self: {},
    caches: cacheStorage,
    clients: { claim: vi.fn(async () => { clientsClaimed.value = true; }) },
    location: new URL(origin),
    skipWaiting: vi.fn(),
    // fetch will be overridden per test
    fetch: vi.fn(),
    addEventListener: (type: string, handler: EventHandler) => {
      (listeners[type] ??= []).push(handler);
    },
    Response: MockResponse,
    Request: MockRequest,
    URL: URL,
    Promise,
    Set,
    console,
  };
  // self === globalThis in SW
  env.self = env;

  return { env, listeners, cacheStorage, clientsClaimed };
}

function loadSW(env: Record<string, unknown>) {
  const src = readFileSync(resolve(__dirname, "../../public/sw.js"), "utf-8");
  // Wrap in a function that receives the SW globals
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

// ── Tests ────────────────────────────────────────────────────────────

describe("Service Worker", () => {
  let env: ReturnType<typeof createSWEnv>;

  beforeEach(() => {
    env = createSWEnv();
    loadSW(env.env);
  });

  describe("install event", () => {
    it("precaches offline page and icons", async () => {
      const event = makeExtendableEvent();
      env.listeners["install"]![0]!(event);
      await Promise.all(event._promises);

      const staticCache = await env.cacheStorage.open("pixwise-static-v1");
      expect(staticCache.addAll).toHaveBeenCalledWith([
        "/offline.html",
        "/icon-192.png",
        "/icon-512.png",
      ]);
    });
  });

  describe("activate event", () => {
    it("deletes old caches", async () => {
      // Pre-populate an old cache
      await env.cacheStorage.open("pixwise-static-v0");
      await env.cacheStorage.open("pixwise-runtime-v0");
      // Also create current caches so they exist
      await env.cacheStorage.open("pixwise-static-v1");
      await env.cacheStorage.open("pixwise-runtime-v1");

      const event = makeExtendableEvent();
      env.listeners["activate"]![0]!(event);
      await Promise.all(event._promises);

      const remaining = await env.cacheStorage.keys();
      expect(remaining).toContain("pixwise-static-v1");
      expect(remaining).toContain("pixwise-runtime-v1");
      expect(remaining).not.toContain("pixwise-static-v0");
      expect(remaining).not.toContain("pixwise-runtime-v0");
    });

    it("claims clients", async () => {
      const event = makeExtendableEvent();
      env.listeners["activate"]![0]!(event);
      await Promise.all(event._promises);
      expect(env.clientsClaimed.value).toBe(true);
    });
  });

  describe("fetch event", () => {
    function makeFetchEvent(
      url: string,
      opts: { method?: string; mode?: string } = {}
    ) {
      let response: unknown;
      return {
        request: new MockRequest(url, opts),
        respondWith: (p: Promise<unknown> | unknown) => {
          response = p;
        },
        get _response() { return response; },
      };
    }

    it("ignores non-GET requests", () => {
      const event = makeFetchEvent("https://pixwise.app/api/test", { method: "POST" });
      env.listeners["fetch"]![0]!(event);
      expect(event._response).toBeUndefined();
    });

    it("ignores cross-origin requests", () => {
      const event = makeFetchEvent("https://cdn.example.com/script.js");
      env.listeners["fetch"]![0]!(event);
      expect(event._response).toBeUndefined();
    });

    it("ignores /api/ routes", () => {
      const event = makeFetchEvent("https://pixwise.app/api/pix/generate");
      env.listeners["fetch"]![0]!(event);
      expect(event._response).toBeUndefined();
    });

    it("ignores /auth/ routes", () => {
      const event = makeFetchEvent("https://pixwise.app/auth/callback");
      env.listeners["fetch"]![0]!(event);
      expect(event._response).toBeUndefined();
    });

    it("serves offline fallback when navigation fails", async () => {
      // Install first to precache offline page
      const installEvent = makeExtendableEvent();
      env.listeners["install"]![0]!(installEvent);
      await Promise.all(installEvent._promises);

      // Make fetch throw (simulate offline)
      (env.env.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("offline"));

      const event = makeFetchEvent("https://pixwise.app/app", { mode: "navigate" });
      env.listeners["fetch"]![0]!(event);

      const response = await event._response;
      expect(response).toBeDefined();
    });

    it("caches successful asset responses in runtime cache", async () => {
      const mockRes = new MockResponse("body", { status: 200 });
      (env.env.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(mockRes);

      const event = makeFetchEvent("https://pixwise.app/_next/static/chunk.js");
      env.listeners["fetch"]![0]!(event);
      const response = await event._response;

      expect(response).toBe(mockRes);

      // Give the cache.put a tick to complete
      await new Promise((r) => setTimeout(r, 10));
      const runtimeCache = await env.cacheStorage.open("pixwise-runtime-v1");
      expect(runtimeCache.put).toHaveBeenCalled();
    });

    it("falls back to cache when asset fetch fails", async () => {
      // Pre-populate runtime cache
      const runtimeCache = await env.cacheStorage.open("pixwise-runtime-v1");
      const cachedRes = new MockResponse("cached", { status: 200 });
      const assetUrl = "https://pixwise.app/_next/static/chunk.js";
      await runtimeCache.put(new MockRequest(assetUrl) as unknown as string, cachedRes);

      // Make fetch fail
      (env.env.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("offline"));

      const event = makeFetchEvent(assetUrl);
      env.listeners["fetch"]![0]!(event);
      const response = await event._response;

      expect(response).toBe(cachedRes);
    });
  });
});
