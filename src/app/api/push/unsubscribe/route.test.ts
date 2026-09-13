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


const mockHashEndpoint = vi.fn((value: string) => `digest:${value}`);
vi.mock("@/lib/crypto", () => ({
  hashEndpoint: (value: string) => mockHashEndpoint(value),
}));

import { POST } from "./route";

function makeRequest(body?: unknown): Request {
  if (body === undefined) {
    return new Request("http://localhost/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "bad{json",
    });
  }
  return new Request("http://localhost/api/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/push/unsubscribe", () => {
  beforeEach(() => {
    serverMock.reset();
    adminMock.reset();
    mockHashEndpoint.mockClear();
  });

  it("returns 401 when not authenticated", async () => {
    const res = await POST(makeRequest({ endpoint: "https://x.com/sub" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid JSON", async () => {
    serverMock.setUser({ id: "u1" });
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
  });

  it("returns 400 when endpoint is missing", async () => {
    serverMock.setUser({ id: "u1" });
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Endpoint");
  });

  it("rejects an unsupported channel instead of defaulting to web", async () => {
    serverMock.setUser({ id: "u1" });
    const res = await POST(makeRequest({ channel: "sms", endpoint: "https://x.com/sub" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Canal");
    expect(adminMock.findCalls("push_subscriptions")).toHaveLength(0);
  });

  it("deletes the current user's web subscription by endpoint digest", async () => {
    serverMock.setUser({ id: "u1" });
    const endpoint = "https://push.example.com/sub/abc";
    adminMock.onTable("push_subscriptions", {
      data: [{ id: "sub-1" }],
      error: null,
    });

    const res = await POST(makeRequest({ endpoint }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: 1 });
    expect(mockHashEndpoint).toHaveBeenCalledWith(endpoint);
    expect(adminMock.findCalls("push_subscriptions", "delete")).toHaveLength(1);
    expect(adminMock.findCalls("push_subscriptions", "eq").map((call) => call.args)).toEqual([
      ["user_id", "u1"],
      ["channel", "web"],
      ["endpoint_digest", `digest:${endpoint}`],
    ]);
  });

  it("uses the FCM token digest when removing a native subscription", async () => {
    serverMock.setUser({ id: "u1" });
    const token = "fcm-token";
    adminMock.onTable("push_subscriptions", { data: [], error: null });

    const res = await POST(makeRequest({ channel: "fcm", token }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: 0 });
    expect(adminMock.findCalls("push_subscriptions", "eq").map((call) => call.args)).toEqual([
      ["user_id", "u1"],
      ["channel", "fcm"],
      ["endpoint_digest", `digest:${token}`],
    ]);
  });

  it("returns 500 when the scoped delete fails", async () => {
    serverMock.setUser({ id: "u1" });
    adminMock.onTable("push_subscriptions", {
      data: null,
      error: { message: "db error" },
    });

    const res = await POST(makeRequest({ endpoint: "https://x.com/sub" }));

    expect(res.status).toBe(500);
  });
});
