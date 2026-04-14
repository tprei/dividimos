import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "@/test/mock-supabase";

const serverMock = createMockSupabase();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverMock.client),
}));

const adminMock = createMockSupabase();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => adminMock.client),
}));

const mockEncrypt = vi.fn((_val: string) => "encrypted-blob");
const mockDecrypt = vi.fn((_val: string) => "decrypted");
vi.mock("@/lib/crypto", () => ({
  encryptPixKey: (val: string) => mockEncrypt(val),
  decryptPixKey: (val: string) => mockDecrypt(val),
}));

import { POST } from "./route";

const validSubscription = {
  endpoint: "https://push.example.com/sub/abc",
  keys: { p256dh: "key1", auth: "key2" },
};

function makeRequest(body?: unknown): Request {
  if (body === undefined) {
    return new Request("http://localhost/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "bad{json",
    });
  }
  return new Request("http://localhost/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/push/subscribe", () => {
  beforeEach(() => {
    serverMock.reset();
    adminMock.reset();
    mockEncrypt.mockClear();
    mockDecrypt.mockReset();
    mockEncrypt.mockReturnValue("encrypted-blob");
  });

  it("returns 401 when not authenticated", async () => {
    const res = await POST(makeRequest({ subscription: validSubscription }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid JSON", async () => {
    serverMock.setUser({ id: "u1" });
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("JSON inválido");
  });

  it("returns 400 when subscription has no endpoint", async () => {
    serverMock.setUser({ id: "u1" });
    // count check for subscription cap
    adminMock.onTable("push_subscriptions", { data: null, count: 0 } as never);
    const res = await POST(makeRequest({ subscription: { keys: { p256dh: "a", auth: "b" } } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("endpoint");
  });

  it("returns 400 when subscription has no keys", async () => {
    serverMock.setUser({ id: "u1" });
    adminMock.onTable("push_subscriptions", { data: null, count: 0 } as never);
    const res = await POST(makeRequest({ subscription: { endpoint: "https://x.com/sub" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("keys");
  });

  it("returns 429 when subscription limit reached", async () => {
    serverMock.setUser({ id: "u1" });
    adminMock.onTable("push_subscriptions", { data: null, count: 20 } as never);

    const res = await POST(makeRequest({ subscription: validSubscription }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain("Limite");
  });

  it("inserts new subscription when no duplicates exist", async () => {
    serverMock.setUser({ id: "u1" });
    adminMock.onTable("push_subscriptions", { data: null, count: 0 } as never);
    adminMock.onTable("push_subscriptions", { data: [] });
    adminMock.onTable("push_subscriptions", { data: null, error: null });

    const res = await POST(makeRequest({ subscription: validSubscription }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(mockEncrypt).toHaveBeenCalledWith(JSON.stringify(validSubscription));
    const insertCalls = adminMock.findCalls("push_subscriptions", "insert");
    expect(insertCalls.length).toBe(1);
  });

  it("deletes duplicate subscriptions before inserting", async () => {
    serverMock.setUser({ id: "u1" });
    adminMock.onTable("push_subscriptions", { data: null, count: 2 } as never);

    mockDecrypt.mockImplementation((encrypted: string) => {
      if (encrypted === "enc-dup")
        return JSON.stringify({ endpoint: validSubscription.endpoint });
      if (encrypted === "enc-other")
        return JSON.stringify({ endpoint: "https://other.example.com/sub" });
      throw new Error("unknown");
    });

    adminMock.onTable("push_subscriptions", {
      data: [
        { id: "dup-1", subscription: "enc-dup" },
        { id: "other-1", subscription: "enc-other" },
      ],
    });
    adminMock.onTable("push_subscriptions", { data: null, error: null });
    adminMock.onTable("push_subscriptions", { data: null, error: null });

    const res = await POST(makeRequest({ subscription: validSubscription }));
    expect(res.status).toBe(200);

    const deleteCalls = adminMock.findCalls("push_subscriptions", "delete");
    expect(deleteCalls.length).toBe(1);
  });

  it("skips rows that fail to decrypt without error", async () => {
    serverMock.setUser({ id: "u1" });
    adminMock.onTable("push_subscriptions", { data: null, count: 1 } as never);

    mockDecrypt.mockImplementation(() => {
      throw new Error("decrypt failed");
    });

    adminMock.onTable("push_subscriptions", {
      data: [{ id: "bad-1", subscription: "garbage" }],
    });
    adminMock.onTable("push_subscriptions", { data: null, error: null });

    const res = await POST(makeRequest({ subscription: validSubscription }));
    expect(res.status).toBe(200);

    const deleteCalls = adminMock.findCalls("push_subscriptions", "delete");
    expect(deleteCalls.length).toBe(0);
  });

  it("returns 500 when insert fails", async () => {
    serverMock.setUser({ id: "u1" });
    adminMock.onTable("push_subscriptions", { data: null, count: 0 } as never);
    adminMock.onTable("push_subscriptions", { data: [] });
    adminMock.onTable("push_subscriptions", { data: null, error: { message: "db error" } });

    const res = await POST(makeRequest({ subscription: validSubscription }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("salvar");
  });
});
