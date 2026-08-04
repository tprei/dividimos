import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  isIntegrationTestReady,
  registerTestUser,
} from "@/test/integration-setup";
import {
  authenticateAs,
  createTestGroupWithMembers,
  createTestUsers,
  type TestUser,
} from "@/test/integration-helpers";

const databaseUrl = process.env.SUPABASE_DB_URL;
const canRun = isIntegrationTestReady && typeof databaseUrl === "string";

describe.skipIf(!canRun)("claim_nudge RPC (#491)", () => {
  let pg: Client;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let groupId: string;

  beforeAll(async () => {
    pg = new Client(databaseUrl!);
    await pg.connect();

    [alice, bob, carol] = await createTestUsers(3);
    for (const u of [alice, bob, carol]) registerTestUser(u.id);

    const group = await createTestGroupWithMembers(alice, [bob]);
    groupId = group.id;

    // Seed a balance where bob owes alice 5000 cents.
    const [minUser, maxUser] =
      alice.id < bob.id ? [alice.id, bob.id] : [bob.id, alice.id];
    const amount = minUser === bob.id ? 5000 : -5000;

    await pg.query("BEGIN");
    await pg.query("SET LOCAL session_replication_role = replica");
    await pg.query(
      `INSERT INTO public.balances (group_id, user_a, user_b, amount_cents)
       VALUES ($1, $2, $3, $4)`,
      [groupId, minUser, maxUser, amount],
    );
    await pg.query("COMMIT");
  });

  afterAll(async () => {
    if (pg) {
      await pg.query("DELETE FROM public.nudge_cooldowns WHERE group_id = $1", [groupId]);
      await pg.query("DELETE FROM public.balances WHERE group_id = $1", [groupId]);
      await pg.end();
    }
  });

  it("returns the owed amount on first call, then nothing on replay (cooldown)", async () => {
    const aliceClient = authenticateAs(alice);

    const first = await aliceClient.rpc("claim_nudge", {
      p_group_id: groupId,
      p_debtor_id: bob.id,
    });
    expect(first.error).toBeNull();
    expect(first.data).toHaveLength(1);
    expect((first.data as { amount_cents: number }[])[0].amount_cents).toBe(5000);

    const second = await aliceClient.rpc("claim_nudge", {
      p_group_id: groupId,
      p_debtor_id: bob.id,
    });
    expect(second.error).toBeNull();
    expect(second.data ?? []).toHaveLength(0);
  });

  it("returns nothing when the caller is not an accepted member", async () => {
    const carolClient = authenticateAs(carol);
    const { data, error } = await carolClient.rpc("claim_nudge", {
      p_group_id: groupId,
      p_debtor_id: bob.id,
    });

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("returns nothing when the caller is the debtor", async () => {
    const bobClient = authenticateAs(bob);
    const { data, error } = await bobClient.rpc("claim_nudge", {
      p_group_id: groupId,
      p_debtor_id: bob.id,
    });

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});
