import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "@/test/mock-supabase";

const serverMock = createMockSupabase();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverMock.client),
}));

// The admin client must no longer be touched by this route.
const adminMock = createMockSupabase();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => adminMock.client),
}));

const mockPushFingerprint = vi.fn<(channel: string, value: string) => string>(
  (channel, value) => `fp:${channel}:${value}`,
);
vi.mock("@/lib/push/fingerprint", () => ({
  pushFingerprint: (channel: string, value: string) =>
    mockPushFingerprint(channel, value),
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

const RELEASE = "rpc:release_push_subscription";

describe("POST /api/push/unsubscribe", () => {
  beforeEach(() => {
    serverMock.reset();
    adminMock.reset();
    mockPushFingerprint.mockClear();
    mockPushFingerprint.mockImplementation(
      (channel: string, value: string) => `fp:${channel}:${value}`,
    );
  });

  it("returns 401 when not authenticated and makes zero RPC calls", async () => {
    const res = await POST(makeRequest({ endpoint: "https://x.com/sub" }));
    expect(res.status).toBe(401);
    expect(serverMock.findCalls(RELEASE, "rpc")).toHaveLength(0);
  });

  it("returns 400 for invalid JSON", async () => {
    serverMock.setUser({ id: "u1" });
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    expect(serverMock.findCalls(RELEASE, "rpc")).toHaveLength(0);
  });

  it("returns 400 when endpoint is missing", async () => {
    serverMock.setUser({ id: "u1" });
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Endpoint");
    expect(serverMock.findCalls(RELEASE, "rpc")).toHaveLength(0);
  });

  it("returns 400 when fcm token is missing", async () => {
    serverMock.setUser({ id: "u1" });
    const res = await POST(makeRequest({ channel: "fcm" }));
    expect(res.status).toBe(400);
    expect(serverMock.findCalls(RELEASE, "rpc")).toHaveLength(0);
  });

  it("releases a web subscription via RPC with the exact fingerprint", async () => {
    serverMock.setUser({ id: "u1" });
    serverMock.onRpc("release_push_subscription", { data: 1, error: null });

    const res = await POST(
      makeRequest({ endpoint: "https://push.example.com/sub/abc" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: 1 });

    const calls = serverMock.findCalls(RELEASE, "rpc");
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toBe("release_push_subscription");
    expect(calls[0].args[1]).toEqual({
      p_channel: "web",
      p_fingerprint: "fp:web:https://push.example.com/sub/abc",
    });
    expect(adminMock.calls).toHaveLength(0);
  });

  it("releases an fcm token via RPC with the exact fingerprint", async () => {
    serverMock.setUser({ id: "u1" });
    serverMock.onRpc("release_push_subscription", { data: 1, error: null });

    const res = await POST(
      makeRequest({ token: "fcm-token-xyz", channel: "fcm" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: 1 });

    const calls = serverMock.findCalls(RELEASE, "rpc");
    expect(calls[0].args[1]).toEqual({
      p_channel: "fcm",
      p_fingerprint: "fp:fcm:fcm-token-xyz",
    });
  });

  it("returns deleted: 0 when nothing matched", async () => {
    serverMock.setUser({ id: "u1" });
    serverMock.onRpc("release_push_subscription", { data: 0, error: null });

    const res = await POST(makeRequest({ endpoint: "https://no-match.com/sub" }));
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(0);
  });

  it("returns 500 when the RPC errors", async () => {
    serverMock.setUser({ id: "u1" });
    serverMock.onRpc("release_push_subscription", {
      data: null,
      error: { code: "PST01", message: "db error" },
    });

    const res = await POST(makeRequest({ endpoint: "https://x.com/sub" }));
    expect(res.status).toBe(500);
  });
});
