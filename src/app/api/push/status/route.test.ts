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

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/push/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/push/status", () => {
  beforeEach(() => {
    serverMock.reset();
    adminMock.reset();
  });

  it("requires a session", async () => {
    const res = await POST(makeRequest({ endpoint: "https://push.example.com/a" }));
    expect(res.status).toBe(401);
  });

  it("reports subscribed when this account owns the endpoint", async () => {
    serverMock.setUser({ id: "u1" });
    adminMock.onTable("push_subscriptions", { data: { user_id: "u1" } });

    const res = await POST(makeRequest({ endpoint: "https://push.example.com/a" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ subscribed: true });
  });

  it("reports not subscribed when another account owns the endpoint", async () => {
    serverMock.setUser({ id: "u1" });
    adminMock.onTable("push_subscriptions", { data: { user_id: "u2" } });

    const res = await POST(makeRequest({ endpoint: "https://push.example.com/a" }));
    expect(await res.json()).toEqual({ subscribed: false });
  });

  it("reports not subscribed when no row exists", async () => {
    serverMock.setUser({ id: "u1" });
    adminMock.onTable("push_subscriptions", { data: null });

    const res = await POST(makeRequest({ endpoint: "https://push.example.com/a" }));
    expect(await res.json()).toEqual({ subscribed: false });
  });

  it("rejects a request without an endpoint", async () => {
    serverMock.setUser({ id: "u1" });
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });
});
