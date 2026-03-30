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

const mockDecrypt = vi.fn();
vi.mock("@/lib/crypto", () => ({
  decryptPixKey: (...args: unknown[]) => mockDecrypt(...args),
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
    mockDecrypt.mockReset();
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

  it("returns 500 when fetching subscriptions fails", async () => {
    serverMock.setUser({ id: "u1" });
    adminMock.onTable("push_subscriptions", { data: null, error: { message: "db error" } });

    const res = await POST(makeRequest({ endpoint: "https://x.com/sub" }));
    expect(res.status).toBe(500);
  });

  it("deletes matching subscriptions by endpoint", async () => {
    serverMock.setUser({ id: "u1" });

    const targetEndpoint = "https://push.example.com/sub/abc";
    mockDecrypt.mockImplementation((encrypted: string) => {
      if (encrypted === "enc-match")
        return JSON.stringify({ endpoint: targetEndpoint });
      if (encrypted === "enc-other")
        return JSON.stringify({ endpoint: "https://other.com/sub" });
      throw new Error("bad");
    });

    adminMock.onTable("push_subscriptions", {
      data: [
        { id: "match-1", subscription: "enc-match" },
        { id: "other-1", subscription: "enc-other" },
      ],
    });
    adminMock.onTable("push_subscriptions", { data: null, error: null });

    const res = await POST(makeRequest({ endpoint: targetEndpoint }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, deleted: 1 });

    const deleteCalls = adminMock.findCalls("push_subscriptions", "delete");
    expect(deleteCalls.length).toBe(1);
  });

  it("returns deleted: 0 when no endpoints match", async () => {
    serverMock.setUser({ id: "u1" });

    mockDecrypt.mockReturnValue(JSON.stringify({ endpoint: "https://other.com/sub" }));

    adminMock.onTable("push_subscriptions", {
      data: [{ id: "row-1", subscription: "enc-1" }],
    });

    const res = await POST(makeRequest({ endpoint: "https://no-match.com/sub" }));
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(0);

    const deleteCalls = adminMock.findCalls("push_subscriptions", "delete");
    expect(deleteCalls.length).toBe(0);
  });

  it("skips rows that fail to decrypt", async () => {
    serverMock.setUser({ id: "u1" });

    const targetEndpoint = "https://push.example.com/sub/abc";
    mockDecrypt.mockImplementation((encrypted: string) => {
      if (encrypted === "enc-good")
        return JSON.stringify({ endpoint: targetEndpoint });
      throw new Error("decrypt failed");
    });

    adminMock.onTable("push_subscriptions", {
      data: [
        { id: "bad-1", subscription: "garbage" },
        { id: "good-1", subscription: "enc-good" },
      ],
    });
    adminMock.onTable("push_subscriptions", { data: null, error: null });

    const res = await POST(makeRequest({ endpoint: targetEndpoint }));
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(1);
  });
});
