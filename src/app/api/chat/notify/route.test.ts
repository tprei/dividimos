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
    return new Request("http://localhost/api/chat/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "invalid-json{{{",
    });
  }
  return new Request("http://localhost/api/chat/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/chat/notify", () => {
  beforeEach(() => {
    serverMock.reset();
    mockNotifyUser.mockReset();
  });

  it("returns 401 when not authenticated", async () => {
    const res = await POST(
      makeRequest({
        recipientUserId: "u2",
        senderName: "Alice",
        messagePreview: "Olá!",
        conversationGroupId: "group-1",
      }),
    );
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
    const res = await POST(
      makeRequest({ recipientUserId: "u2", senderName: "Alice" }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("obrigatórios");
  });

  it("returns 403 when caller is not a member of the group", async () => {
    serverMock.setUser({ id: "caller-1" });
    serverMock.onTable("group_members", { data: null, error: null });

    const res = await POST(
      makeRequest({
        recipientUserId: "u2",
        senderName: "Alice",
        messagePreview: "Olá!",
        conversationGroupId: "group-1",
      }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("Não autorizado");
  });

  it("sends notification and returns result on success", async () => {
    serverMock.setUser({ id: "caller-1" });
    serverMock.onTable("group_members", { data: null, error: null, count: 1 } as never);

    mockNotifyUser.mockResolvedValue({ sent: 1, cleaned: 0 });

    const res = await POST(
      makeRequest({
        recipientUserId: "u2",
        senderName: "Alice",
        messagePreview: "Olá mundo!",
        conversationGroupId: "group-1",
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ sent: 1, cleaned: 0 });

    expect(mockNotifyUser).toHaveBeenCalledWith("u2", {
      title: "Alice",
      body: "Olá mundo!",
      url: "/app/conversations/group-1",
      icon: "/icon-192.png",
      tag: "chat-group-1",
    });
  });

  it("sends notification to recipient even when recipient has no subscriptions", async () => {
    serverMock.setUser({ id: "caller-1" });
    serverMock.onTable("group_members", { data: null, error: null, count: 1 } as never);

    mockNotifyUser.mockResolvedValue({ sent: 0, cleaned: 0 });

    const res = await POST(
      makeRequest({
        recipientUserId: "u2",
        senderName: "Alice",
        messagePreview: "Mensagem",
        conversationGroupId: "group-1",
      }),
    );

    expect(res.status).toBe(200);
    expect(mockNotifyUser).toHaveBeenCalledWith("u2", expect.objectContaining({ title: "Alice" }));
  });
});
