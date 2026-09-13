import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMockSupabase } from "@/test/mock-supabase";

const serverMock = createMockSupabase();
const adminMock = createMockSupabase();
const mockNotifyUser = vi.fn<
  (
    userId: string,
    payload: unknown,
  ) => Promise<{ sent: number; cleaned: number; failed: number }>
>(async () => ({ sent: 1, cleaned: 0, failed: 0 }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => serverMock.client),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => scopedAdminClient()),
}));

const mockEnforceRateLimit = vi.fn<(bucket: string, subject: string) => Promise<void>>(
  async () => {},
);
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: (bucket: string, subject: string) =>
    mockEnforceRateLimit(bucket, subject),
}));

vi.mock("@/lib/push/notify-user", () => ({
  notifyUser: (userId: string, payload: unknown) => mockNotifyUser(userId, payload),
}));

import { POST } from "./route";
import { AppError } from "@/lib/errors";

function eventRowFor(id: number) {
  return {
    id,
    group_id: "group-1",
    actor_id: "ana",
    kind: "nudge" as const,
    expense_id: null,
    settlement_id: null,
    subject_user_id: "bob",
    payload: { amountCents: 1000 },
    created_at: "2026-09-06T12:00:00Z",
    notified_at: null,
  };
}


interface MockQueryResult {
  data: unknown;
  error: unknown;
}

const MEMBER_NAMES: Record<string, string> = {
  ana: "Ana",
  bruno: "Bruno",
  carol: "Carol",
  david: "David",
  eva: "Eva",
  mallory: "Mallory",
};

function memberRow(
  userId: string,
  status: "accepted" | "invited" = "accepted",
  preferences: Record<string, boolean> = {},
) {
  return {
    group_id: "group-1",
    user_id: userId,
    status,
    users: { name: MEMBER_NAMES[userId], notification_preferences: preferences },
  };
}

// The shared mock resolves queued rows verbatim, but /api/notify scopes its
// group_members read with .eq("group_id", …). Mirror PostgREST here so the
// seeded rows are narrowed by the query the way they are in production.
function filteringChain(
  chain: object,
  filters: Array<[string, unknown]>,
): unknown {
  return new Proxy(chain, {
    get(target, key) {
      if (key === "then") {
        // The mock's chain proxies are thenable but statically opaque; they
        // always resolve to the queued MockQueryResult.
        const thenable = target as PromiseLike<MockQueryResult>;
        return (
          onFulfilled?: (value: MockQueryResult) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) =>
          Promise.resolve(thenable).then((result) => {
            const data = Array.isArray(result.data)
              ? result.data.filter(
                  (row) =>
                    isMemberRow(row) &&
                    filters.every(([column, value]) => row[column] === value),
                )
              : result.data;
            const narrowed: MockQueryResult = { ...result, data };
            return onFulfilled ? onFulfilled(narrowed) : narrowed;
          }, onRejected);
      }
      if (key === "eq") {
        return (column: string, value: unknown) => {
          filters.push([column, value]);
          const recordEq = Reflect.get(target, key, target);
          return filteringChain(recordEq(column, value), filters);
        };
      }
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) =>
        filteringChain(Reflect.apply(value, target, args), filters);
    },
  });
}

function isMemberRow(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scopedAdminClient(): SupabaseClient {
  const client: SupabaseClient = adminMock.client;
  return new Proxy(client, {
    get(target, key) {
      if (key !== "from") return Reflect.get(target, key, target);
      return (table: string) => {
        const chain = target.from(table);
        return table === "group_members" ? filteringChain(chain, []) : chain;
      };
    },
  }) as unknown as SupabaseClient;
}

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
    mockEnforceRateLimit.mockReset();
    mockEnforceRateLimit.mockResolvedValue(undefined);
    mockNotifyUser.mockResolvedValue({ sent: 1, cleaned: 0, failed: 0 });
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
      data: [memberRow("ana"), memberRow("bruno"), memberRow("carol")],
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
    expect(json).toMatchObject({ sent: 2 });

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

  it("notifies only the event group's members, once each", async () => {
    serverMock.setUser({ id: "ana" });

    const eventRow = {
      id: 107,
      group_id: "group-1",
      actor_id: "ana",
      kind: "expense_created" as const,
      expense_id: null,
      settlement_id: null,
      subject_user_id: null,
      payload: {},
      created_at: "2026-09-06T12:00:00Z",
      notified_at: null,
    };

    adminMock.onTable("group_events", { data: eventRow });
    adminMock.onTable("groups", {
      data: { id: "group-1", kind: "regular", name: "Viagem" },
    });
    // Two disjoint groups: the event lives in group-1, carol also has a row
    // in group-2, and mallory is an accepted member of group-2 only.
    adminMock.onTable("group_members", {
      data: [
        memberRow("bruno"),
        memberRow("carol"),
        { ...memberRow("carol"), group_id: "group-2" },
        { ...memberRow("mallory"), group_id: "group-2" },
      ],
    });

    const res = await POST(makeRequest({ eventId: 107 }));
    expect(res.status).toBe(200);

    // The member read is scoped to the event's group…
    expect(adminMock.findCalls("group_members", "eq")).toContainEqual(
      expect.objectContaining({ args: ["group_id", "group-1"] }),
    );

    // …so only group-1's accepted members are pushed, once each: never the
    // group-2 outsider, and carol is not pushed twice for her second row.
    const targets = mockNotifyUser.mock.calls.map((call) => call[0]);
    expect(targets).toEqual(["bruno", "carol"]);
  });

  it("pushes to a recipient at most once per event", async () => {
    serverMock.setUser({ id: "ana" });

    const eventRow = {
      id: 108,
      group_id: "group-1",
      actor_id: "ana",
      kind: "expense_created" as const,
      expense_id: null,
      settlement_id: null,
      subject_user_id: null,
      payload: {},
      created_at: "2026-09-06T12:00:00Z",
      notified_at: null,
    };

    adminMock.onTable("group_events", { data: eventRow });
    adminMock.onTable("groups", {
      data: { id: "group-1", kind: "regular", name: "Viagem" },
    });
    // Duplicated membership rows for carol: the fan-out collapses them.
    adminMock.onTable("group_members", {
      data: [memberRow("bruno"), memberRow("carol"), memberRow("carol")],
    });

    const res = await POST(makeRequest({ eventId: 108 }));
    expect(res.status).toBe(200);

    const targets = mockNotifyUser.mock.calls.map((call) => call[0]);
    expect(targets).toEqual(["bruno", "carol"]);
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
        memberRow("ana"),
        memberRow("bruno", "accepted", { expenses: false }),
        memberRow("carol"),
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
    expect(json).toMatchObject({ sent: 1 });
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
      data: [memberRow("ana"), memberRow("bruno")],
    });

    const res = await POST(makeRequest({ eventId: 102 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ sent: 1 });

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
        memberRow("ana"),
        memberRow("david", "invited"),
        memberRow("eva", "invited"),
      ],
    });

    const res = await POST(makeRequest({ eventId: 103 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ sent: 2 });

    // member_invited sends to payload.userIds regardless of status
    expect(mockNotifyUser).toHaveBeenCalledTimes(2);
    expect(mockNotifyUser).toHaveBeenNthCalledWith(1, "david", expect.any(Object));
    expect(mockNotifyUser).toHaveBeenNthCalledWith(2, "eva", expect.any(Object));
  });

  it("aggregates sent count from multiple notifyUser calls", async () => {
    serverMock.setUser({ id: "ana" });

    mockNotifyUser.mockResolvedValueOnce({ sent: 2, cleaned: 0, failed: 0 });
    mockNotifyUser.mockResolvedValueOnce({ sent: 1, cleaned: 0, failed: 0 });

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
      data: [memberRow("ana"), memberRow("bruno"), memberRow("carol")],
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
    expect(json).toMatchObject({ sent: 3 });
  });

  it("fails the dispatch and releases the claim when it throws after claiming", async () => {
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
    // No response queued for "groups": the group read fails after the claim.

    const res = await POST(makeRequest({ eventId: 105 }));
    // A dispatch that reached nobody is not a success.
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ sent: 0, failed: 1 });

    // The claim is released so the same event can be dispatched again.
    const updates = adminMock.findCalls("group_events", "update");
    expect(updates.at(-1)?.args[0]).toEqual({ notified_at: null });
  });

  it("releases the claim when transport delivery fails after claiming", async () => {
    serverMock.setUser({ id: "ana" });
    mockNotifyUser.mockResolvedValue({ sent: 0, cleaned: 0, failed: 1 });

    adminMock.onTable("group_events", {
      data: {
        id: 130,
        group_id: "group-1",
        actor_id: "ana",
        kind: "nudge" as const,
        expense_id: null,
        settlement_id: null,
        subject_user_id: "bob",
        payload: { amountCents: 1000 },
        created_at: "2026-09-06T12:00:00Z",
        notified_at: null,
      },
    });
    adminMock.onTable("groups", { data: { id: "group-1", kind: "group", name: "Viagem" } });
    adminMock.onTable("group_members", {
      data: [
        { group_id: "group-1", user_id: "ana", status: "accepted", users: { name: "Ana", notification_preferences: { nudges: true } } },
        { group_id: "group-1", user_id: "bob", status: "accepted", users: { name: "Bob", notification_preferences: { nudges: true } } },
      ],
    });
    const res = await POST(makeRequest({ eventId: 130 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: 0, failed: 1 });

    const updates = adminMock.findCalls("group_events", "update");
    expect(updates).toHaveLength(2);
    expect(updates.at(-1)?.args[0]).toEqual({ notified_at: null });
  });
  it("treats an opted-out nudge as a terminal suppression", async () => {
    serverMock.setUser({ id: "ana" });
    adminMock.onTable("group_events", { data: eventRowFor(131) });
    adminMock.onTable("groups", { data: { id: "group-1", kind: "group", name: "Viagem" } });
    adminMock.onTable("group_members", {
      data: [memberRow("ana"), memberRow("bob", "accepted", { nudges: false })],
    });

    const res = await POST(makeRequest({ eventId: 131 }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      sent: 0,
      cleaned: 0,
      failed: 0,
      recipients: 0,
      skipped: 0,
    });
    expect(mockNotifyUser).not.toHaveBeenCalled();
    expect(adminMock.findCalls("group_events", "update")).toHaveLength(1);
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
      data: [memberRow("ana"), memberRow("bruno")],
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

  it("answers 429 and sends nothing when the actor's dispatch budget is spent", async () => {
    serverMock.setUser({ id: "ana" });
    mockEnforceRateLimit.mockImplementation(async (bucket) => {
      if (bucket === "push.send") {
        throw new AppError("RATE_LIMIT_EXCEEDED", "limite");
      }
    });

    adminMock.onTable("group_events", { data: eventRowFor(140) });

    const res = await POST(makeRequest({ eventId: 140 }));
    expect(res.status).toBe(429);
    expect(mockNotifyUser).not.toHaveBeenCalled();
    // The claim is released so a retry after the window can dispatch.
    const updates = adminMock.findCalls("group_events", "update");
    expect(updates.at(-1)?.args[0]).toEqual({ notified_at: null });
  });

  it("answers 503 and sends nothing when the limiter cannot decide", async () => {
    serverMock.setUser({ id: "ana" });
    mockEnforceRateLimit.mockRejectedValue(
      new AppError("RATE_LIMIT_UNAVAILABLE", "indisponível"),
    );

    adminMock.onTable("group_events", { data: eventRowFor(141) });

    const res = await POST(makeRequest({ eventId: 141 }));
    expect(res.status).toBe(503);
    expect(mockNotifyUser).not.toHaveBeenCalled();
  });

  it("skips only the recipient whose pair budget is spent", async () => {
    serverMock.setUser({ id: "ana" });
    mockEnforceRateLimit.mockImplementation(async (bucket, subject) => {
      if (bucket === "push.send-pair" && subject === "ana:david") {
        throw new AppError("RATE_LIMIT_EXCEEDED", "limite");
      }
    });

    adminMock.onTable("group_events", {
      data: {
        ...eventRowFor(142),
        kind: "member_invited" as const,
        subject_user_id: null,
        payload: { userIds: ["david", "eva"] },
      },
    });
    adminMock.onTable("groups", { data: { id: "group-1", kind: "regular", name: "Viagem" } });
    adminMock.onTable("group_members", {
      data: [memberRow("ana"), memberRow("david", "invited"), memberRow("eva", "invited")],
    });

    const res = await POST(makeRequest({ eventId: 142 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ skipped: 1 });

    const notified = mockNotifyUser.mock.calls.map((call) => call[0]);
    expect(notified).toContain("eva");
    expect(notified).not.toContain("david");
  });
});