import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "@/test/mock-supabase";

const serverMock = createMockSupabase();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverMock.client),
}));

// The admin client must no longer be touched by this route. Keeping the mock
// lets us assert it recorded zero calls.
const adminMock = createMockSupabase();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => adminMock.client),
}));

const mockEncrypt = vi.fn<(value: string) => string>(() => "encrypted-blob");
vi.mock("@/lib/crypto", () => ({
  encryptPixKey: (val: string) => mockEncrypt(val),
}));

const mockPushFingerprint = vi.fn<(channel: string, value: string) => string>(
  (channel, value) => `fp:${channel}:${value}`,
);
vi.mock("@/lib/push/fingerprint", () => ({
  pushFingerprint: (channel: string, value: string) =>
    mockPushFingerprint(channel, value),
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

const CLAIM = "rpc:claim_push_subscription";

function fingerprintOf(call: { args: unknown[] }): string {
  const args = call.args[1];
  if (args && typeof args === "object" && "p_fingerprint" in args) {
    const fp = (args as { p_fingerprint: unknown }).p_fingerprint;
    if (typeof fp === "string") return fp;
  }
  throw new Error("expected p_fingerprint in RPC args");
}

describe("POST /api/push/subscribe", () => {
  beforeEach(() => {
    serverMock.reset();
    adminMock.reset();
    mockEncrypt.mockClear();
    mockPushFingerprint.mockClear();
    mockEncrypt.mockReturnValue("encrypted-blob");
    mockPushFingerprint.mockImplementation(
      (channel: string, value: string) => `fp:${channel}:${value}`,
    );
  });

  it("returns 401 when not authenticated and makes zero RPC calls", async () => {
    const res = await POST(makeRequest({ subscription: validSubscription }));
    expect(res.status).toBe(401);
    expect(serverMock.findCalls(CLAIM, "rpc")).toHaveLength(0);
  });

  it("returns 400 for invalid JSON and makes zero RPC calls", async () => {
    serverMock.setUser({ id: "u1" });
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("JSON inválido");
    expect(serverMock.findCalls(CLAIM, "rpc")).toHaveLength(0);
  });

  it("returns 400 when subscription has no endpoint", async () => {
    serverMock.setUser({ id: "u1" });
    const res = await POST(
      makeRequest({ subscription: { keys: { p256dh: "a", auth: "b" } } }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("endpoint");
    expect(serverMock.findCalls(CLAIM, "rpc")).toHaveLength(0);
  });

  it("returns 400 when subscription has no keys", async () => {
    serverMock.setUser({ id: "u1" });
    const res = await POST(
      makeRequest({ subscription: { endpoint: "https://x.com/sub" } }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("keys");
    expect(serverMock.findCalls(CLAIM, "rpc")).toHaveLength(0);
  });

  it("returns 400 when fcm token is missing", async () => {
    serverMock.setUser({ id: "u1" });
    const res = await POST(makeRequest({ channel: "fcm" }));
    expect(res.status).toBe(400);
    expect(serverMock.findCalls(CLAIM, "rpc")).toHaveLength(0);
  });

  it("claims a web subscription via RPC with the exact fingerprint + ciphertext", async () => {
    serverMock.setUser({ id: "u1" });
    serverMock.onRpc("claim_push_subscription", { data: null, error: null });

    const res = await POST(makeRequest({ subscription: validSubscription }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(mockEncrypt).toHaveBeenCalledWith(JSON.stringify(validSubscription));
    const calls = serverMock.findCalls(CLAIM, "rpc");
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toBe("claim_push_subscription");
    expect(calls[0].args[1]).toEqual({
      p_channel: "web",
      p_fingerprint: `fp:web:${validSubscription.endpoint}`,
      p_subscription: "encrypted-blob",
    });
    expect(adminMock.calls).toHaveLength(0);
  });

  it("claims an fcm token via RPC with the exact fingerprint + ciphertext", async () => {
    serverMock.setUser({ id: "u1" });
    serverMock.onRpc("claim_push_subscription", { data: null, error: null });

    const res = await POST(makeRequest({ token: "fcm-token-123", channel: "fcm" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(mockEncrypt).toHaveBeenCalledWith("fcm-token-123");
    const calls = serverMock.findCalls(CLAIM, "rpc");
    expect(calls).toHaveLength(1);
    expect(calls[0].args[1]).toEqual({
      p_channel: "fcm",
      p_fingerprint: "fp:fcm:fcm-token-123",
      p_subscription: "encrypted-blob",
    });
    expect(adminMock.calls).toHaveLength(0);
  });

  it("returns 409 when the per-user cap is hit (PST09)", async () => {
    serverMock.setUser({ id: "u1" });
    serverMock.onRpc("claim_push_subscription", {
      data: null,
      error: { code: "PST09" },
    });

    const res = await POST(makeRequest({ subscription: validSubscription }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("dispositivos");
  });

  it("returns 500 on any other RPC error", async () => {
    serverMock.setUser({ id: "u1" });
    serverMock.onRpc("claim_push_subscription", {
      data: null,
      error: { code: "PST01", message: "no auth" },
    });

    const res = await POST(makeRequest({ subscription: validSubscription }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("salvar");
  });

  it("yields a byte-identical fingerprint for the same endpoint across calls", async () => {
    serverMock.setUser({ id: "u1" });
    serverMock.onRpc("claim_push_subscription", { data: null, error: null });
    serverMock.onRpc("claim_push_subscription", { data: null, error: null });

    await POST(makeRequest({ subscription: validSubscription }));
    await POST(makeRequest({ subscription: validSubscription }));

    const calls = serverMock.findCalls(CLAIM, "rpc");
    expect(calls).toHaveLength(2);
    const fp1 = (calls[0].args[1] as { p_fingerprint: string }).p_fingerprint;
    const fp2 = (calls[1].args[1] as { p_fingerprint: string }).p_fingerprint;
    expect(fp1).toBe(fp2);
  });

  it("yields different fingerprints for a different endpoint or channel", async () => {
    serverMock.setUser({ id: "u1" });
    serverMock.onRpc("claim_push_subscription", { data: null, error: null });
    serverMock.onRpc("claim_push_subscription", { data: null, error: null });
    serverMock.onRpc("claim_push_subscription", { data: null, error: null });

    await POST(makeRequest({ subscription: validSubscription }));
    await POST(
      makeRequest({
        subscription: {
          ...validSubscription,
          endpoint: "https://other.example.com/sub",
        },
      }),
    );
    await POST(makeRequest({ token: "fcm-token", channel: "fcm" }));

    const calls = serverMock.findCalls(CLAIM, "rpc");
    const fps = calls.map(fingerprintOf);
    expect(new Set(fps).size).toBe(3);
  });
});
