import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";
import {
  createExpense,
  createGroupWithMembers,
  createTestUsers,
  equalSplitPayload,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";

const mockNotifyUser = vi.hoisted(() =>
  vi.fn<
    (
      userId: string,
      payload: unknown,
    ) => Promise<{ sent: number; cleaned: number; failed: number }>
  >(async () => ({ sent: 1, cleaned: 0, failed: 0 })),
);

vi.mock("@/lib/push/notify-user", () => ({
  notifyUser: (userId: string, payload: unknown) =>
    mockNotifyUser(userId, payload),
}));

const actorSession = vi.hoisted(() => ({
  current: null as SupabaseClient | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => actorSession.current,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => adminClient,
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: async () => {},
}));

import { POST } from "./route";

function browserClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function signInAs(user: TestUser): Promise<SupabaseClient> {
  const client = browserClient();
  const { error } = await client.auth.setSession({
    access_token: user.accessToken!,
    refresh_token: user.refreshToken!,
  });
  if (error) {
    throw new Error(`fixture failure: could not sign in ${user.handle}`);
  }
  return client;
}

async function blockAs(user: TestUser, targetId: string): Promise<void> {
  const client = await signInAs(user);
  const { error } = await client.rpc("block_user", { p_user_id: targetId });
  if (error) {
    throw new Error(`block_user failed: ${error.message}`);
  }
}

function notifyRequest(eventId: number): Request {
  return new Request("http://localhost/api/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventId }),
  });
}

async function notifiedAt(eventId: number): Promise<string | null> {
  return withPg(async (db) => {
    const result = await db.query<{ notified_at: string | null }>(
      "select notified_at from public.group_events where id = $1",
      [eventId],
    );
    return result.rows[0].notified_at;
  });
}

describe.skipIf(!isIntegrationTestReady)("notify route — blocked recipients", () => {
  beforeEach(() => {
    mockNotifyUser.mockClear();
    mockNotifyUser.mockResolvedValue({ sent: 1, cleaned: 0, failed: 0 });
  });

  it("suppresses a queued pre-block event at dispatch while delivering to an allowed recipient", async () => {
    const [ana, bruno, carla] = await createTestUsers(3);
    const groupId = await createGroupWithMembers(ana, [bruno, carla], "Grupo push");
    const created = await createExpense(bruno, {
      groupId,
      totalCents: 9000,
      payload: equalSplitPayload([bruno.id, ana.id, carla.id], 9000),
    });

    await blockAs(ana, bruno.id);

    actorSession.current = await signInAs(bruno);
    const res = await POST(notifyRequest(created.eventId));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: 1, recipients: 1 });
    expect(mockNotifyUser.mock.calls.map((call) => call[0])).toEqual([carla.id]);
    expect(await notifiedAt(created.eventId)).not.toBeNull();
  });

  it("does not suppress the reverse direction unless that recipient also blocked the actor", async () => {
    const [ana, bruno, carla] = await createTestUsers(3);
    const groupId = await createGroupWithMembers(ana, [bruno, carla], "Grupo reverso");
    const created = await createExpense(ana, {
      groupId,
      totalCents: 6000,
      payload: equalSplitPayload([ana.id, bruno.id, carla.id], 6000),
    });

    await blockAs(ana, bruno.id);

    actorSession.current = await signInAs(ana);
    const res = await POST(notifyRequest(created.eventId));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: 2, recipients: 2 });
    expect(mockNotifyUser.mock.calls.map((call) => call[0]).sort()).toEqual(
      [bruno.id, carla.id].sort(),
    );
  });

  it("keeps notification-preference suppression alongside blocking", async () => {
    const [ana, bruno, carla] = await createTestUsers(3);
    const groupId = await createGroupWithMembers(ana, [bruno, carla], "Grupo preferências");
    const created = await createExpense(bruno, {
      groupId,
      totalCents: 6000,
      payload: equalSplitPayload([bruno.id, ana.id, carla.id], 6000),
    });

    const { error } = await adminClient!
      .from("users")
      .update({ notification_preferences: { expenses: false } })
      .eq("id", carla.id);
    expect(error).toBeNull();
    await blockAs(ana, bruno.id);

    actorSession.current = await signInAs(bruno);
    const res = await POST(notifyRequest(created.eventId));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: 0, recipients: 0 });
    expect(mockNotifyUser).not.toHaveBeenCalled();
  });

  it("returns no targets without disclosing the block and keeps the claim consumed", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const groupId = await createGroupWithMembers(ana, [bruno], "Grupo silencioso");
    const created = await createExpense(bruno, {
      groupId,
      totalCents: 4000,
      payload: equalSplitPayload([bruno.id, ana.id], 4000),
    });

    await blockAs(ana, bruno.id);

    actorSession.current = await signInAs(bruno);
    const res = await POST(notifyRequest(created.eventId));

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toMatchObject({ sent: 0, recipients: 0 });
    expect(await notifiedAt(created.eventId)).not.toBeNull();
  });
});
