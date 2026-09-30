import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createTestUser,
  createTestUsers,
  expectRpcError,
  withPg,
} from "@/test/integration-helpers";

type RpcResult<T> = { data: T | null; error: { message: string } | null };

async function rpcOk<T>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = (await client.rpc(fn, args)) as RpcResult<T>;
  if (error) {
    throw new Error(`${fn} failed: ${error.message}`);
  }
  return data as T;
}

async function rpcErrorCode(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  return expectRpcError(Promise.resolve(client.rpc(fn, args)));
}

interface BootstrapPayload {
  groups: Array<{
    group: { id: string };
  }>;
}

async function createBulkUsers(count: number, prefix: string): Promise<Array<{ id: string }>> {
  return withPg(async (client) => {
    const res = await client.query<{ id: string }>(
      `
      WITH new_users AS (
        INSERT INTO auth.users (
          id, instance_id, aud, role, email, encrypted_password,
          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
          created_at, updated_at
        )
        SELECT
          gen_random_uuid(),
          '00000000-0000-0000-0000-000000000000',
          'authenticated',
          'authenticated',
          $1 || i || '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8) || '@test.local',
          'pass',
          now(),
          '{"provider":"email","providers":["email"]}',
          '{"full_name":"Bulk User"}',
          now(),
          now()
        FROM generate_series(1, $2) AS i
        RETURNING id
      )
      SELECT id FROM new_users;
      `,
      [prefix, count],
    );

    const userIds = res.rows.map((r) => r.id);
    await client.query(
      `
      UPDATE public.users u
      SET onboarded = true,
          handle = 'h_' || substr(replace(u.id::text, '-', ''), 1, 12)
      WHERE u.id = ANY($1::uuid[])
      `,
      [userIds],
    );
    return res.rows;
  });
}

describe.skipIf(!isIntegrationTestReady)(
  "abuse rate limits and pending invitation bounds",
  () => {
    it("allows 30 group creations per hour and refuses the 31st with group_rate_limited", async () => {
      const creator = await createTestUser();
      const creatorClient = authenticateAs(creator);

      for (let i = 1; i <= 30; i++) {
        const res = await rpcOk<{ groupId: string }>(creatorClient, "create_group", {
          p_name: `Group Limit ${i}`,
          p_member_ids: [],
        });
        expect(res.groupId).toBeDefined();
      }

      const err = await rpcErrorCode(creatorClient, "create_group", {
        p_name: "Group Limit 31",
        p_member_ids: [],
      });
      expect(err).toBe("group_rate_limited");
    });

    it("allows 100 invites per hour and refuses the 101st with invite_rate_limited", async () => {
      const creator = await createTestUser();
      const creatorClient = authenticateAs(creator);

      const { groupId } = await rpcOk<{ groupId: string }>(creatorClient, "create_group", {
        p_name: "Invite Rate Group",
        p_member_ids: [],
      });

      const targets = await createBulkUsers(101, "inv_rl_");

      for (let i = 0; i < 100; i++) {
        const res = await rpcOk<{ groupId: string }>(creatorClient, "invite_member", {
          p_group_id: groupId,
          p_user_id: targets[i].id,
        });
        expect(res.groupId).toBe(groupId);
      }

      const err = await rpcErrorCode(creatorClient, "invite_member", {
        p_group_id: groupId,
        p_user_id: targets[100].id,
      });
      expect(err).toBe("invite_rate_limited");
    });

    it("caps one inviter at 10 pending invites per person while other inviters still reach them", async () => {
      const [victim, attacker, friend] = await createTestUsers(3);
      const attackerClient = authenticateAs(attacker);

      for (let i = 0; i < 10; i += 1) {
        await rpcOk<{ groupId: string }>(attackerClient, "create_group", {
          p_name: `Flood Group ${i + 1}`,
          p_member_ids: [victim.id],
        });
      }

      const createErr = await rpcErrorCode(attackerClient, "create_group", {
        p_name: "Flood Group 11",
        p_member_ids: [victim.id],
      });
      expect(createErr).toBe("invite_limit");

      const soloGroup = await rpcOk<{ groupId: string }>(attackerClient, "create_group", {
        p_name: "Attacker Solo Group",
        p_member_ids: [],
      });
      const inviteErr = await rpcErrorCode(attackerClient, "invite_member", {
        p_group_id: soloGroup.groupId,
        p_user_id: victim.id,
      });
      expect(inviteErr).toBe("invite_limit");

      const friendGroup = await rpcOk<{ groupId: string }>(authenticateAs(friend), "create_group", {
        p_name: "Real Friends",
        p_member_ids: [victim.id],
      });
      expect(friendGroup.groupId).toBeTruthy();

      const pendingCount = await withPg(async (client) => {
        const result = await client.query<{ count: string }>(
          "select count(*)::text as count from public.group_members where user_id = $1 and status = 'invited'",
          [victim.id],
        );
        return Number(result.rows[0].count);
      });
      expect(pendingCount).toBe(11);
    });

    it("allows 30 messages per 60s in one group (refuses 31st with message_rate_limited) while another group is unaffected", async () => {
      const user = await createTestUser();
      const client = authenticateAs(user);

      const g1 = await rpcOk<{ groupId: string }>(client, "create_group", {
        p_name: "Chat Group 1",
        p_member_ids: [],
      });
      const g2 = await rpcOk<{ groupId: string }>(client, "create_group", {
        p_name: "Chat Group 2",
        p_member_ids: [],
      });

      for (let i = 1; i <= 30; i++) {
        const res = await rpcOk<{ id: string }>(client, "send_message", {
          p_client_id: crypto.randomUUID(),
          p_group_id: g1.groupId,
          p_content: `Message ${i}`,
        });
        expect(res.id).toBeDefined();
      }

      const err = await rpcErrorCode(client, "send_message", {
        p_client_id: crypto.randomUUID(),
        p_group_id: g1.groupId,
        p_content: "Message 31",
      });
      expect(err).toBe("message_rate_limited");

      const msgG2 = await rpcOk<{ id: string }>(client, "send_message", {
        p_client_id: crypto.randomUUID(),
        p_group_id: g2.groupId,
        p_content: "Hello Group 2",
      });
      expect(msgG2.id).toBeDefined();
    });

    it("allows 30 new DM pairs per hour, does not count idempotent calls, and refuses the 31st new pair with dm_rate_limited", async () => {
      const user = await createTestUser();
      const client = authenticateAs(user);

      const targets = await createBulkUsers(31, "dm_tgt_");

      for (let i = 0; i < 30; i++) {
        const res = await rpcOk<{ groupId: string; created: boolean }>(
          client,
          "get_or_create_dm",
          { p_user_id: targets[i].id },
        );
        expect(res.groupId).toBeDefined();
        expect(res.created).toBe(true);
      }

      const repeat = await rpcOk<{ groupId: string; created: boolean }>(
        client,
        "get_or_create_dm",
        { p_user_id: targets[0].id },
      );
      expect(repeat.created).toBe(false);

      const err = await rpcErrorCode(client, "get_or_create_dm", {
        p_user_id: targets[30].id,
      });
      expect(err).toBe("dm_rate_limited");
    });

    it("allows 60 vendor charges per hour and refuses the 61st with charge_rate_limited", async () => {
      const user = await createTestUser();
      const client = authenticateAs(user);

      for (let i = 1; i <= 60; i++) {
        const res = await rpcOk<{ id: string }>(client, "record_vendor_charge", {
          p_amount_cents: 1000 + i,
          p_description: `Charge ${i}`,
        });
        expect(res.id).toBeDefined();
      }

      const err = await rpcErrorCode(client, "record_vendor_charge", {
        p_amount_cents: 9999,
        p_description: "Charge 61",
      });
      expect(err).toBe("charge_rate_limited");
    });

    it("block_user clears pending invites from the blocked user and removes the group from bootstrap", async () => {
      const [attacker, victim] = await createTestUsers(2);
      const attackerClient = authenticateAs(attacker);
      const victimClient = authenticateAs(victim);

      const attackGroup = await rpcOk<{ groupId: string }>(attackerClient, "create_group", {
        p_name: "Phishing Attack Group",
        p_member_ids: [victim.id],
      });
      const groupId = attackGroup.groupId;

      const invitedCountBefore = await withPg(async (client) => {
        const res = await client.query<{ count: string }>(
          "select count(*)::text as count from public.group_members where group_id = $1 and user_id = $2 and status = 'invited'",
          [groupId, victim.id],
        );
        return Number(res.rows[0].count);
      });
      expect(invitedCountBefore).toBe(1);

      const bootBefore = await rpcOk<BootstrapPayload>(victimClient, "bootstrap", {});
      expect(bootBefore.groups.some((g) => g.group.id === groupId)).toBe(true);

      await rpcOk(victimClient, "block_user", { p_user_id: attacker.id });

      const invitedCountAfter = await withPg(async (client) => {
        const res = await client.query<{ count: string }>(
          "select count(*)::text as count from public.group_members where group_id = $1 and user_id = $2",
          [groupId, victim.id],
        );
        return Number(res.rows[0].count);
      });
      expect(invitedCountAfter).toBe(0);

      const bootAfter = await rpcOk<BootstrapPayload>(victimClient, "bootstrap", {});
      expect(bootAfter.groups.some((g) => g.group.id === groupId)).toBe(false);
    });

    it("block_user keeps an invitation that already names the blocker on a bill, so decline can convert the share", async () => {
      const [attacker, victim] = await createTestUsers(2);
      const attackerClient = authenticateAs(attacker);
      const victimClient = authenticateAs(victim);

      const { groupId } = await rpcOk<{ groupId: string }>(attackerClient, "create_group", {
        p_name: "Conta com convite",
        p_member_ids: [victim.id],
      });
      await rpcOk(attackerClient, "create_expense", {
        p_client_id: crypto.randomUUID(),
        p_group_id: groupId,
        p_occurred_on: new Date().toISOString().slice(0, 10),
        p_title: "Jantar",
        p_merchant_name: null,
        p_expense_type: "single_amount",
        p_total_cents: 1000,
        p_service_fee_bps: 0,
        p_fixed_fee_cents: 0,
        p_chave_acesso: null,
        p_payload: {
          items: [],
          participants: [
            { kind: "user", userId: attacker.id },
            { kind: "user", userId: victim.id },
          ],
          shares: [0, 1000],
          payers: [{ participantIndex: 0, amountCents: 1000 }],
          itemAssignments: null,
        },
      });

      await rpcOk(victimClient, "block_user", { p_user_id: attacker.id });

      const membership = await withPg(async (client) => {
        const res = await client.query<{ status: string }>(
          "select status::text as status from public.group_members where group_id = $1 and user_id = $2",
          [groupId, victim.id],
        );
        return res.rows;
      });
      expect(membership).toEqual([{ status: "invited" }]);

      await rpcOk(victimClient, "decline_invitation", { p_group_id: groupId });

      const victimBalance = await withPg(async (client) => {
        const res = await client.query<{ count: string }>(
          "select count(*)::text as count from public.group_balances where group_id = $1 and kind = 'user' and participant_id = $2",
          [groupId, victim.id],
        );
        return Number(res.rows[0].count);
      });
      expect(victimBalance).toBe(0);
    });
  },
);
