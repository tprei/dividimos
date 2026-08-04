import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  adminClient,
  isIntegrationTestReady,
  registerTestUser,
} from "@/test/integration-setup";
import { createTestUsers, type TestUser } from "@/test/integration-helpers";

const databaseUrl = process.env.SUPABASE_DB_URL;
const canRun = isIntegrationTestReady && typeof databaseUrl === "string";

describe.skipIf(!canRun)("push subscription cap (#492)", () => {
  let user: TestUser;
  let pg: Client;
  const createdIds: string[] = [];

  beforeAll(async () => {
    [user] = await createTestUsers(1);
    registerTestUser(user.id);
    pg = new Client(databaseUrl!);
    await pg.connect();
  });

  afterAll(async () => {
    if (pg) {
      await pg.query("DELETE FROM public.push_subscriptions WHERE user_id = $1", [user.id]);
      await pg.end();
    }
  });

  it("caps subscriptions at 5 per user and rejects the 6th", async () => {
    for (let i = 0; i < 5; i++) {
      const { data, error } = await adminClient!
        .from("push_subscriptions")
        .insert({
          user_id: user.id,
          subscription: `test-encrypted-${i}`,
          channel: "web",
        })
        .select("id")
        .single();

      expect(error).toBeNull();
      if (data) createdIds.push(data.id);
    }

    const { error } = await adminClient!
      .from("push_subscriptions")
      .insert({
        user_id: user.id,
        subscription: "test-encrypted-overflow",
        channel: "web",
      });

    expect(error).not.toBeNull();
    expect(error!.code).toBe("PST09");
  });

  it("serializes concurrent inserts so the cap cannot be exceeded", async () => {
    // Use a fresh user so this test is independent of the one above.
    const [user2] = await createTestUsers(1);
    registerTestUser(user2.id);

    // Seed 4 subscriptions (one below the cap).
    for (let i = 0; i < 4; i++) {
      await pg.query(
        "INSERT INTO public.push_subscriptions (user_id, subscription, channel) VALUES ($1, $2, 'web')",
        [user2.id, `concurrent-seed-${i}`],
      );
    }

    const pg2 = new Client(databaseUrl!);
    await pg2.connect();

    try {
      // Connection 1: begin, insert the 5th subscription (trigger locks
      // the user row FOR UPDATE), but do NOT commit yet.
      await pg.query("BEGIN");
      await pg.query(
        "INSERT INTO public.push_subscriptions (user_id, subscription, channel) VALUES ($1, $2, 'web')",
        [user2.id, "conn1-sub"],
      );

      // Connection 2: try to insert — the trigger blocks on the user-row
      // lock held by connection 1's transaction.
      const conn2Promise = pg2
        .query(
          "INSERT INTO public.push_subscriptions (user_id, subscription, channel) VALUES ($1, $2, 'web')",
          [user2.id, "conn2-sub"],
        )
        .catch((e: unknown) => e);

      // Commit connection 1 — releases the lock. Connection 2's trigger
      // wakes up, sees count = 5, and must reject with PST09.
      // A real delay is unavoidable here: the test exercises real
      // concurrent database connections, not mocked timers.
      await new Promise((r) => setTimeout(r, 300));
      await pg.query("COMMIT");

      const result = await conn2Promise;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain("subscription_cap_exceeded");

      // Verify the user has exactly 5 subscriptions, not 6.
      const { rows } = await pg.query(
        "SELECT count(*)::int AS count FROM public.push_subscriptions WHERE user_id = $1",
        [user2.id],
      );
      expect(rows[0].count).toBe(5);
    } finally {
      await pg.query("DELETE FROM public.push_subscriptions WHERE user_id = $1", [user2.id]);
      await pg2.end();
    }
  });
});
