import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "@/test/mock-supabase";

const serverMock = createMockSupabase();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverMock.client),
}));

const mockNotifyUser = vi.fn();
vi.mock("@/lib/push/notify-user", () => ({
  notifyUser: (...args: unknown[]) => mockNotifyUser(...args),
}));

import { POST } from "./route";

function makeRequest(body?: unknown): Request {
  if (body === undefined) {
    return new Request("http://localhost/api/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json{{{",
    });
  }
  return new Request("http://localhost/api/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/push/send", () => {
  beforeEach(() => {
    serverMock.reset();
    mockNotifyUser.mockReset();
  });

  it("returns 401 when not authenticated", async () => {
    const res = await POST(makeRequest({ userId: "u1", title: "t", body: "b" }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Não autenticado");
  });

  it("returns 400 for invalid JSON", async () => {
    serverMock.setUser({ id: "caller-1" });
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("JSON inválido");
  });

  it("returns 400 when required fields are missing", async () => {
    serverMock.setUser({ id: "caller-1" });
    const res = await POST(makeRequest({ userId: "u1", title: "t" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("obrigatórios");
  });

  it("returns 403 when caller has no accepted groups", async () => {
    serverMock.setUser({ id: "caller-1" });
    serverMock.onTable("group_members", { data: [] });

    const res = await POST(makeRequest({ userId: "u2", title: "t", body: "b" }));
    expect(res.status).toBe(403);
  });

  it("returns 403 when target user shares no group with caller", async () => {
    serverMock.setUser({ id: "caller-1" });
    serverMock.onTable("group_members", { data: [{ group_id: "g1" }] });
    serverMock.onTable("group_members", { data: null, error: null });

    const res = await POST(makeRequest({ userId: "u2", title: "t", body: "b" }));
    expect(res.status).toBe(403);
  });

  it("returns 403 when target membership count is 0", async () => {
    serverMock.setUser({ id: "caller-1" });
    serverMock.onTable("group_members", { data: [{ group_id: "g1" }] });
    serverMock.onTable("group_members", { data: null, error: null });

    const res = await POST(makeRequest({ userId: "u2", title: "t", body: "b" }));
    expect(res.status).toBe(403);
  });

  it("sends notification and returns result on success", async () => {
    serverMock.setUser({ id: "caller-1" });
    serverMock.onTable("group_members", { data: [{ group_id: "g1" }] });
    serverMock.onTable("group_members", {
      data: null,
      error: null,
      count: 1,
    } as never);

    mockNotifyUser.mockResolvedValue({ sent: 2, cleaned: 0 });

    const res = await POST(
      makeRequest({ userId: "u2", title: "Novo gasto", body: "R$ 50,00", url: "/app/groups/g1", tag: "expense" }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ sent: 2, cleaned: 0 });

    expect(mockNotifyUser).toHaveBeenCalledWith("u2", {
      title: "Novo gasto",
      body: "R$ 50,00",
      url: "/app/groups/g1",
      icon: "/icon-192.png",
      tag: "expense",
    });
  });
});
