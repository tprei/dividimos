import { describe, it, expect, vi, beforeEach } from "vitest";
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
  createAdminClient: vi.fn(() => adminMock.client),
}));

const mockEnforceRateLimit = vi.fn<(bucket: string, subject: string) => Promise<void>>(
  async () => {},
);
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: (...args: [string, string]) => mockEnforceRateLimit(...args),
}));

vi.mock("@/lib/push/notify-user", () => ({
  notifyUser: (userId: string, payload: unknown) => mockNotifyUser(userId, payload),
}));

import { POST } from "./route";

const GROUP_ID = "dm-1";

const MEMBER_NAMES: Record<string, string> = {
  ana: "Ana",
  carol: "Carol",
};

interface MemberRowFixture {
  user_id: string;
  status: "accepted" | "invited";
  archived_at: string | null;
  users: { name: string; notification_preferences: Record<string, boolean> };
}

function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    group_id: GROUP_ID,
    sender_id: "ana",
    content: "bom dia",
    erased_at: null,
    ...overrides,
  };
}

function memberRow(
  userId: string,
  status: "accepted" | "invited",
  preferences: Record<string, boolean> = {},
  archivedAt: string | null = null,
): MemberRowFixture {
  return {
    user_id: userId,
    status,
    archived_at: archivedAt,
    users: { name: MEMBER_NAMES[userId] ?? userId, notification_preferences: preferences },
  };
}

function seedSend(overrides: {
  message?: unknown;
  group?: Record<string, unknown>;
  members?: MemberRowFixture[];
  blockers?: string[];
  claim?: unknown[];
}) {
  serverMock.setUser({ id: "ana" });
  adminMock.onTable("chat_messages", {
    data: overrides.message === undefined ? messageRow() : overrides.message,
  });
  adminMock.onTable("groups", { data: overrides.group ?? { id: GROUP_ID, kind: "dm" } });
  adminMock.onTable("group_members", {
    data: overrides.members ?? [memberRow("ana", "accepted"), memberRow("carol", "invited")],
  });
  adminMock.onRpc("get_push_blockers", { data: overrides.blockers ?? [] });
  adminMock.onTable("group_events", { data: overrides.claim ?? [{ id: 101 }] });
}

function makeRequest(body?: unknown): Request {
  return new Request("http://localhost/api/notify-dm-invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? "bad{json" : JSON.stringify(body),
  });
}

describe("POST /api/notify-dm-invite", () => {
  beforeEach(() => {
    serverMock.reset();
    adminMock.reset();
    mockNotifyUser.mockClear();
    mockEnforceRateLimit.mockReset();
    mockEnforceRateLimit.mockResolvedValue(undefined);
    mockNotifyUser.mockResolvedValue({ sent: 1, cleaned: 0, failed: 0 });
  });

  it("returns 401 when not authenticated", async () => {
    const res = await POST(makeRequest({ groupId: GROUP_ID, messageId: "msg-1" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid JSON or missing fields", async () => {
    serverMock.setUser({ id: "ana" });
    expect((await POST(makeRequest())).status).toBe(400);
    expect((await POST(makeRequest({ groupId: GROUP_ID }))).status).toBe(400);
    expect((await POST(makeRequest({ messageId: "msg-1" }))).status).toBe(400);
  });

  it("pushes the pending invitee with the invite copy and deep link", async () => {
    seedSend({});

    const res = await POST(makeRequest({ groupId: GROUP_ID, messageId: "msg-1" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ recipients: 1, skipped: 0 });
    expect(mockNotifyUser).toHaveBeenCalledTimes(1);
    expect(mockNotifyUser).toHaveBeenCalledWith("carol", {
      title: "Ana",
      body: "quer conversar com você: bom dia",
      url: "/app/conversations/ana",
      tag: `chat-${GROUP_ID}`,
    });
  });

  it("pushes once per invite: a replayed POST claims nothing", async () => {
    seedSend({});
    await POST(makeRequest({ groupId: GROUP_ID, messageId: "msg-1" }));

    seedSend({ claim: [] });
    const res = await POST(makeRequest({ groupId: GROUP_ID, messageId: "msg-1" }));

    expect(res.status).toBe(204);
    expect(mockNotifyUser).toHaveBeenCalledTimes(1);
  });

  it("scopes the claim to the caller's member_invited event in that DM", async () => {
    seedSend({});

    await POST(makeRequest({ groupId: GROUP_ID, messageId: "msg-1" }));

    const eqCalls = adminMock.findCalls("group_events", "eq").map((call) => call.args);
    expect(eqCalls).toContainEqual(["group_id", GROUP_ID]);
    expect(eqCalls).toContainEqual(["kind", "member_invited"]);
    expect(eqCalls).toContainEqual(["actor_id", "ana"]);
    const isCalls = adminMock.findCalls("group_events", "is").map((call) => call.args);
    expect(isCalls).toContainEqual(["notified_at", null]);
  });

  it("answers 204 when the message does not exist", async () => {
    seedSend({ message: null });

    const res = await POST(makeRequest({ groupId: GROUP_ID, messageId: "msg-1" }));
    expect(res.status).toBe(204);
    expect(mockNotifyUser).not.toHaveBeenCalled();
  });

  it("pushes nothing and does not claim once the invitee accepted", async () => {
    seedSend({ members: [memberRow("ana", "accepted"), memberRow("carol", "accepted")] });

    const res = await POST(makeRequest({ groupId: GROUP_ID, messageId: "msg-1" }));

    expect(res.status).toBe(204);
    expect(adminMock.findCalls("group_events", "update")).toHaveLength(0);
    expect(mockNotifyUser).not.toHaveBeenCalled();
  });

  it("truncates long previews", async () => {
    seedSend({ message: messageRow({ content: "a".repeat(200) }) });

    await POST(makeRequest({ groupId: GROUP_ID, messageId: "msg-1" }));

    const body = mockNotifyUser.mock.calls[0]?.[1] as { body: string };
    expect(body.body).toBe(`quer conversar com você: ${"a".repeat(120)}…`);
  });

  it("pushes nothing when the invitee blocked the sender", async () => {
    seedSend({ blockers: ["carol"] });

    const res = await POST(makeRequest({ groupId: GROUP_ID, messageId: "msg-1" }));
    expect(res.status).toBe(204);
    expect(mockNotifyUser).not.toHaveBeenCalled();
  });

  it("pushes nothing when the invitee muted messages", async () => {
    seedSend({
      members: [memberRow("ana", "accepted"), memberRow("carol", "invited", { messages: false })],
    });

    const res = await POST(makeRequest({ groupId: GROUP_ID, messageId: "msg-1" }));
    expect(res.status).toBe(204);
    expect(mockNotifyUser).not.toHaveBeenCalled();
  });

  it("answers with no push when the message was not sent by the caller", async () => {
    serverMock.setUser({ id: "mallory" });
    adminMock.onTable("chat_messages", { data: messageRow() });
    adminMock.onTable("groups", { data: { id: GROUP_ID, kind: "dm" } });
    adminMock.onTable("group_members", { data: [memberRow("carol", "invited")] });
    adminMock.onRpc("get_push_blockers", { data: [] });
    adminMock.onTable("group_events", { data: [{ id: 101 }] });

    const res = await POST(makeRequest({ groupId: GROUP_ID, messageId: "msg-1" }));
    expect(res.status).toBe(204);
    expect(mockNotifyUser).not.toHaveBeenCalled();
  });

  it("answers with no push outside DMs and for erased messages", async () => {
    seedSend({ group: { id: "g1", kind: "group" } });
    expect(
      (await POST(makeRequest({ groupId: GROUP_ID, messageId: "msg-1" }))).status,
    ).toBe(204);

    adminMock.reset();
    seedSend({ message: messageRow({ erased_at: "2026-01-01T00:01:00Z" }) });
    expect(
      (await POST(makeRequest({ groupId: GROUP_ID, messageId: "msg-1" }))).status,
    ).toBe(204);
    expect(mockNotifyUser).not.toHaveBeenCalled();
  });
});
