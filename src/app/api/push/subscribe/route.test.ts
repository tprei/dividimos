import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "@/test/mock-supabase";

type MockValidationResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "invalid" | "resolution_failed" };

const mockValidateWebSubscription = vi.hoisted(() =>
  vi.fn<(value: unknown) => Promise<MockValidationResult>>(async (value) => {
    if (
      typeof value === "object" &&
      value !== null &&
      "endpoint" in value &&
      typeof value.endpoint === "string" &&
      "keys" in value
    ) {
      return { ok: true, value };
    }
    return { ok: false, reason: "invalid" };
  }),
);
vi.mock("@/lib/push/validate-endpoint", () => ({
  validateWebSubscription: mockValidateWebSubscription,
}));

const serverMock = createMockSupabase();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverMock.client),
}));

const adminMock = createMockSupabase();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => adminMock.client),
}));

const mockEncrypt = vi.fn<(value: string) => string>(() => "encrypted-blob");
const mockDecrypt = vi.fn<(value: string) => string>(() => "decrypted");
vi.mock("@/lib/crypto", () => ({
  encryptPixKey: (val: string) => mockEncrypt(val),
  decryptPixKey: (val: string) => mockDecrypt(val),
  hashEndpoint: (val: string) => `\\x${val}`,
}));

import { POST } from "./route";

const validSubscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: {
    p256dh:
      "BCNXu22ndNATY-RZtaeIvbY2I92MODTxto2tmvWhhpTM-FgTfREXkh2l8LyhFkoPOtCnMUE3ultxDvWJtINvgF8",
    auth: "AQEBAQEBAQEBAQEBAQEBAQ",
  },
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
    mockValidateWebSubscription.mockClear();
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
  it("returns 400 for primitive JSON without touching storage", async () => {
    serverMock.setUser({ id: "u1" });
    const res = await POST(makeRequest("not an object"));
    expect(res.status).toBe(400);
    expect(adminMock.findCalls("push_subscriptions", "insert")).toHaveLength(0);
  });

  it("returns retryable 503 when endpoint DNS cannot be resolved", async () => {
    serverMock.setUser({ id: "u1" });
    mockValidateWebSubscription.mockResolvedValueOnce({
      ok: false,
      reason: "resolution_failed",
    });
    const res = await POST(makeRequest({ subscription: validSubscription }));
    expect(res.status).toBe(503);
    expect(adminMock.findCalls("push_subscriptions", "insert")).toHaveLength(0);
  });

  it("returns 400 when subscription has no endpoint", async () => {
    serverMock.setUser({ id: "u1" });
    const res = await POST(makeRequest({ subscription: { keys: { p256dh: "a", auth: "b" } } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("inválida");
  });

  it("returns 400 when subscription has no keys", async () => {
    serverMock.setUser({ id: "u1" });
    const res = await POST(makeRequest({ subscription: { endpoint: "https://x.com/sub" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("inválida");
  });

  it("claims the endpoint for the signed-in account", async () => {
    serverMock.setUser({ id: "u1" });
    adminMock.onRpc("claim_push_subscription", { data: { transferred: false } });

    const res = await POST(makeRequest({ subscription: validSubscription }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const claims = adminMock.findCalls("rpc:claim_push_subscription", "rpc");
    expect(claims).toHaveLength(1);
    expect(claims[0]?.args[1]).toEqual({
      p_user_id: "u1",
      p_channel: "web",
      p_endpoint_digest: `\\x${validSubscription.endpoint}`,
      p_subscription_encrypted: "encrypted-blob",
    });
    expect(mockEncrypt).toHaveBeenCalledWith(JSON.stringify(validSubscription));
    // Ownership is resolved in one statement: no client-side read or delete
    // can interleave with a competing registration.
    expect(adminMock.findCalls("push_subscriptions", "select")).toHaveLength(0);
    expect(adminMock.findCalls("push_subscriptions", "delete")).toHaveLength(0);
  });

  it("claims an FCM token under its own channel", async () => {
    serverMock.setUser({ id: "u1" });
    adminMock.onRpc("claim_push_subscription", { data: { transferred: true } });

    const res = await POST(makeRequest({ channel: "fcm", token: "device-token" }));
    expect(res.status).toBe(200);

    const claims = adminMock.findCalls("rpc:claim_push_subscription", "rpc");
    expect(claims[0]?.args[1]).toMatchObject({
      p_user_id: "u1",
      p_channel: "fcm",
      p_endpoint_digest: "\\xdevice-token",
    });
  });

  it("returns 500 when the claim fails", async () => {
    serverMock.setUser({ id: "u1" });
    adminMock.onRpc("claim_push_subscription", { error: { message: "db error" } });

    const res = await POST(makeRequest({ subscription: validSubscription }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("salvar");
  });
});
