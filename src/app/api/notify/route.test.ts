import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockSupabase } from "@/test/mock-supabase";

const serverMock = createMockSupabase();
const adminMock = createMockSupabase();
const mockNotifyUser =
  vi.fn<(userId: string, payload: unknown) => Promise<{ sent: number; cleaned: number }>>(
    async () => ({ sent: 1, cleaned: 0 }),
  );

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverMock.client),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => adminMock.client),
}));

vi.mock("@/lib/push/notify-user", () => ({
  notifyUser: (userId: string, payload: unknown) => mockNotifyUser(userId, payload),
}));

import { POST } from "./route";

function makeRequest(body?: unknown): Request {
  if (body === undefined) {
    return new Request("http://localhost/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "bad{json",
    });
  }
  return new Request("http://localhost/api/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/notify", () => {
  beforeEach(() => {
    serverMock.reset();
    adminMock.reset();
    mockNotifyUser.mockClear();
    mockNotifyUser.mockResolvedValue({ sent: 1, cleaned: 0 });
  });

  it("returns 401 when not authenticated", async () => {
    const res = await POST(makeRequest({ eventId: 1 }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Não autenticado");
  });

  it("returns 400 for invalid JSON", async () => {
    serverMock.setUser({ id: "user-1" });
    const res = await POST(makeRequest());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("JSON inválido");
  });

  it("returns 400 when eventId is missing", async () => {
    serverMock.setUser({ id: "user-1" });
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("eventId inválido");
  });

  it("returns 400 when eventId is not a number", async () => {
    serverMock.setUser({ id: "user-1" });
    const res = await POST(makeRequest({ eventId: "not-a-number" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("eventId inválido");
  });

  it("returns 400 when eventId is a float", async () => {
    serverMock.setUser({ id: "user-1" });
    const res = await POST(makeRequest({ eventId: 1.5 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("eventId inválido");
  });

  it("returns 204 when the claim update returns no row", async () => {
    serverMock.setUser({ id: "user-1" });
    adminMock.onTable("group_events", { data: null });

    const res = await POST(makeRequest({ eventId: 1 }));
    expect(res.status).toBe(204);
  });

  it("returns 200 { sent } for expense_created event", async () => {
    serverMock.setUser({ id: "ana" });

    const eventRow = {
      id: 101,
      group_id: "group-1",
      actor_id: "ana",
      kind: "expense_created" as const,
      expense_id: "expense-1",
      settlement_id: null,
      subject_user_id: null,
      payload: {},
      created_at: "2026-09-06T12:00:00Z",
      notified_at: null,
    };

    const groupRow = {
      id: "group-1",
      kind: "regular",
      name: "Viagem",
    };

    adminMock.onTable("group_events", { data: eventRow });
    adminMock.onTable("groups", { data: groupRow });
    adminMock.onTable("group_members", {
      data: [
        {
          user_id: "ana",
          status: "accepted",
          users: { name: "Ana", notification_preferences: {} },
        },
        {
          user_id: "bruno",
          status: "accepted",
          users: { name: "Bruno", notification_preferences: {} },
        },
        {
          user_id: "carol",
          status: "accepted",
          users: { name: "Carol", notification_preferences: {} },
        },
      ],
    });
    adminMock.onTable("expenses", { data: { current_version_no: 1 } });
    adminMock.onTable("expense_versions", {
      data: { title: "Jantar" },
    });
    adminMock.onTable("expense_participants", {
      data: [
        { user_id: "bruno", share_cents: 5000 },
        { user_id: "carol", share_cents: 5000 },
      ],
    });

    const res = await POST(makeRequest({ eventId: 101 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ sent: 2 });

    // expense_created notifies accepted members except the actor
    expect(mockNotifyUser).toHaveBeenCalledTimes(2);
    expect(mockNotifyUser).toHaveBeenNthCalledWith(
      1,
      "bruno",
      expect.objectContaining({ title: "Viagem" }),
    );
    expect(mockNotifyUser).toHaveBeenNthCalledWith(
      2,
      "carol",
      expect.objectContaining({ title: "Viagem" }),
    );
  });

  it("filters expense_created recipients by preferences", async () => {
    serverMock.setUser({ id: "ana" });

    const eventRow = {
      id: 101,
      group_id: "group-1",
      actor_id: "ana",
      kind: "expense_created" as const,
      expense_id: "expense-1",
      settlement_id: null,
      subject_user_id: null,
      payload: {},
      created_at: "2026-09-06T12:00:00Z",
      notified_at: null,
    };

    const groupRow = {
      id: "group-1",
      kind: "regular",
      name: "Viagem",
    };

    adminMock.onTable("group_events", { data: eventRow });
    adminMock.onTable("groups", { data: groupRow });
    adminMock.onTable("group_members", {
      data: [
        {
          user_id: "ana",
          status: "accepted",
          users: { name: "Ana", notification_preferences: {} },
        },
        {
          user_id: "bruno",
          status: "accepted",
          users: {
            name: "Bruno",
            notification_preferences: { expenses: false },
          },
        },
        {
          user_id: "carol",
          status: "accepted",
          users: { name: "Carol", notification_preferences: {} },
        },
      ],
    });
    adminMock.onTable("expenses", { data: { current_version_no: 1 } });
    adminMock.onTable("expense_versions", {
      data: { title: "Jantar" },
    });
    adminMock.onTable("expense_participants", {
      data: [{ user_id: "carol", share_cents: 5000 }],
    });

    const res = await POST(makeRequest({ eventId: 101 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    // Only carol notified; bruno filtered out by preference
    expect(json).toEqual({ sent: 1 });
    expect(mockNotifyUser).toHaveBeenCalledTimes(1);
    expect(mockNotifyUser).toHaveBeenCalledWith("carol", expect.any(Object));
  });

  it("sends settlement_recorded to only subject_user_id", async () => {
    serverMock.setUser({ id: "ana" });

    const eventRow = {
      id: 102,
      group_id: "group-1",
      actor_id: "ana",
      kind: "settlement_recorded" as const,
      expense_id: null,
      settlement_id: "settlement-1",
      subject_user_id: "bruno",
      payload: {},
      created_at: "2026-09-06T12:00:00Z",
      notified_at: null,
    };

    const groupRow = {
      id: "group-1",
      kind: "regular",
      name: "Viagem",
    };

    adminMock.onTable("group_events", { data: eventRow });
    adminMock.onTable("groups", { data: groupRow });
    adminMock.onTable("group_members", {
      data: [
        {
          user_id: "ana",
          status: "accepted",
          users: { name: "Ana", notification_preferences: {} },
        },
        {
          user_id: "bruno",
          status: "accepted",
          users: { name: "Bruno", notification_preferences: {} },
        },
      ],
    });

    const res = await POST(makeRequest({ eventId: 102 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ sent: 1 });

    // settlement_recorded sends only to subject_user_id
    expect(mockNotifyUser).toHaveBeenCalledTimes(1);
    expect(mockNotifyUser).toHaveBeenCalledWith("bruno", expect.any(Object));
  });

  it("sends member_invited to payload.userIds", async () => {
    serverMock.setUser({ id: "ana" });

    const eventRow = {
      id: 103,
      group_id: "group-1",
      actor_id: "ana",
      kind: "member_invited" as const,
      expense_id: null,
      settlement_id: null,
      subject_user_id: null,
      payload: { userIds: ["david", "eva"] },
      created_at: "2026-09-06T12:00:00Z",
      notified_at: null,
    };

    const groupRow = {
      id: "group-1",
      kind: "regular",
      name: "Viagem",
    };

    adminMock.onTable("group_events", { data: eventRow });
    adminMock.onTable("groups", { data: groupRow });
    adminMock.onTable("group_members", {
      data: [
        {
          user_id: "ana",
          status: "accepted",
          users: { name: "Ana", notification_preferences: {} },
        },
        {
          user_id: "david",
          status: "invited",
          users: { name: "David", notification_preferences: {} },
        },
        {
          user_id: "eva",
          status: "invited",
          users: { name: "Eva", notification_preferences: {} },
        },
      ],
    });

    const res = await POST(makeRequest({ eventId: 103 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ sent: 2 });

    // member_invited sends to payload.userIds regardless of status
    expect(mockNotifyUser).toHaveBeenCalledTimes(2);
    expect(mockNotifyUser).toHaveBeenNthCalledWith(1, "david", expect.any(Object));
    expect(mockNotifyUser).toHaveBeenNthCalledWith(2, "eva", expect.any(Object));
  });

  it("aggregates sent count from multiple notifyUser calls", async () => {
    serverMock.setUser({ id: "ana" });

    mockNotifyUser.mockResolvedValueOnce({ sent: 2, cleaned: 0 });
    mockNotifyUser.mockResolvedValueOnce({ sent: 1, cleaned: 0 });

    const eventRow = {
      id: 104,
      group_id: "group-1",
      actor_id: "ana",
      kind: "expense_created" as const,
      expense_id: "expense-1",
      settlement_id: null,
      subject_user_id: null,
      payload: {},
      created_at: "2026-09-06T12:00:00Z",
      notified_at: null,
    };

    const groupRow = {
      id: "group-1",
      kind: "regular",
      name: "Viagem",
    };

    adminMock.onTable("group_events", { data: eventRow });
    adminMock.onTable("groups", { data: groupRow });
    adminMock.onTable("group_members", {
      data: [
        {
          user_id: "ana",
          status: "accepted",
          users: { name: "Ana", notification_preferences: {} },
        },
        {
          user_id: "bruno",
          status: "accepted",
          users: { name: "Bruno", notification_preferences: {} },
        },
        {
          user_id: "carol",
          status: "accepted",
          users: { name: "Carol", notification_preferences: {} },
        },
      ],
    });
    adminMock.onTable("expenses", { data: { current_version_no: 1 } });
    adminMock.onTable("expense_versions", {
      data: { title: "Jantar" },
    });
    adminMock.onTable("expense_participants", {
      data: [
        { user_id: "bruno", share_cents: 5000 },
        { user_id: "carol", share_cents: 5000 },
      ],
    });

    const res = await POST(makeRequest({ eventId: 104 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ sent: 3 });
  });

  it("returns 200 { sent: 0 } on error after claim", async () => {
    serverMock.setUser({ id: "ana" });

    const eventRow = {
      id: 105,
      group_id: "group-1",
      actor_id: "ana",
      kind: "expense_created" as const,
      expense_id: "expense-1",
      settlement_id: null,
      subject_user_id: null,
      payload: {},
      created_at: "2026-09-06T12:00:00Z",
      notified_at: null,
    };

    adminMock.onTable("group_events", { data: eventRow });
    // Don't queue a response for "groups" — will return null, causing error
    // The route should catch this and return { sent: 0 }

    const res = await POST(makeRequest({ eventId: 105 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ sent: 0 });
  });

  it("uses share_cents in notification body for expense recipients", async () => {
    serverMock.setUser({ id: "ana" });

    const eventRow = {
      id: 106,
      group_id: "group-1",
      actor_id: "ana",
      kind: "expense_created" as const,
      expense_id: "expense-1",
      settlement_id: null,
      subject_user_id: null,
      payload: {},
      created_at: "2026-09-06T12:00:00Z",
      notified_at: null,
    };

    const groupRow = {
      id: "group-1",
      kind: "regular",
      name: "Viagem",
    };

    adminMock.onTable("group_events", { data: eventRow });
    adminMock.onTable("groups", { data: groupRow });
    adminMock.onTable("group_members", {
      data: [
        {
          user_id: "ana",
          status: "accepted",
          users: { name: "Ana", notification_preferences: {} },
        },
        {
          user_id: "bruno",
          status: "accepted",
          users: { name: "Bruno", notification_preferences: {} },
        },
      ],
    });
    adminMock.onTable("expenses", { data: { current_version_no: 1 } });
    adminMock.onTable("expense_versions", {
      data: { title: "Jantar" },
    });
    adminMock.onTable("expense_participants", {
      data: [{ user_id: "bruno", share_cents: 12345 }],
    });

    const res = await POST(makeRequest({ eventId: 106 }));
    expect(res.status).toBe(200);
    expect(mockNotifyUser).toHaveBeenCalledTimes(1);
    expect(mockNotifyUser).toHaveBeenCalledWith(
      "bruno",
      expect.objectContaining({ body: expect.stringContaining("sua parte:") }),
    );
  });
});
