import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createExpense,
  createGroupWithMembers,
  createTestUsers,
  equalSplitPayload,
  expectRpcError,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";

interface NudgeAck {
  groupId: string;
  ledgerVersion: number;
  eventId: number;
}

type RpcResult<T> = { data: T | null; error: { message: string } | null };

async function rpcOk<T>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
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
  args: Record<string, unknown>,
): Promise<string> {
  return expectRpcError(Promise.resolve(client.rpc(fn, args)));
}

describe.skipIf(!isIntegrationTestReady)(
  "nudge RPC — send_nudge lifecycle",
  () => {
    // Alice paid 6000 split equally with Bob, so Bob owes Alice 3000.
    // Carol is a member of the group but has no debts with Alice.
    // Outsider is not a member of the group.
    let alice: TestUser;
    let bob: TestUser;
    let carol: TestUser;
    let outsider: TestUser;
    let clientAlice: SupabaseClient;
    let clientBob: SupabaseClient;
    let clientOutsider: SupabaseClient;
    let groupId: string;
    let nudgeAck: NudgeAck;
    let otherGroupId: string;

    beforeAll(async () => {
      [alice, bob, carol, outsider] = await createTestUsers(4);
      clientAlice = authenticateAs(alice);
      clientBob = authenticateAs(bob);
      clientOutsider = authenticateAs(outsider);

      groupId = await createGroupWithMembers(alice, [bob, carol], "Grupo Nudge");
      await createExpense(alice, {
        groupId,
        title: "Almoço de Domingo",
        totalCents: 6000,
        payload: equalSplitPayload([alice.id, bob.id], 6000),
      });

      // Second group with the same debtor/creditor pair so the cooldown
      // can be proven scoped per group rather than per pair.
      otherGroupId = await createGroupWithMembers(alice, [bob], "Grupo Nudge 2");
      await createExpense(alice, {
        groupId: otherGroupId,
        title: "Churrasco",
        totalCents: 4000,
        payload: equalSplitPayload([alice.id, bob.id], 4000),
      });
    });

    it("rejects a nudge attempt by an outsider with not_a_member", async () => {
      await expect(
        rpcErrorCode(clientOutsider, "send_nudge", {
          p_group_id: groupId,
          p_user_id: bob.id,
        }),
      ).resolves.toBe("not_a_member");
    });

    it("rejects a nudge when the target is not a member with counterparty_not_member", async () => {
      await expect(
        rpcErrorCode(clientAlice, "send_nudge", {
          p_group_id: groupId,
          p_user_id: outsider.id,
        }),
      ).resolves.toBe("counterparty_not_member");
    });

    it("rejects nudging oneself with invalid_argument", async () => {
      await expect(
        rpcErrorCode(clientAlice, "send_nudge", {
          p_group_id: groupId,
          p_user_id: alice.id,
        }),
      ).resolves.toBe("invalid_argument");
    });

    it("rejects a nudge when there is no debt (debtor nudging creditor) with no_debt", async () => {
      await expect(
        rpcErrorCode(clientBob, "send_nudge", {
          p_group_id: groupId,
          p_user_id: alice.id,
        }),
      ).resolves.toBe("no_debt");
    });

    it("rejects a nudge when there is no debt between the parties with no_debt", async () => {
      await expect(
        rpcErrorCode(clientAlice, "send_nudge", {
          p_group_id: groupId,
          p_user_id: carol.id,
        }),
      ).resolves.toBe("no_debt");
    });

    it("sends a nudge and returns mutation ack with eventId", async () => {
      nudgeAck = await rpcOk<NudgeAck>(clientAlice, "send_nudge", {
        p_group_id: groupId,
        p_user_id: bob.id,
      });

      expect(Object.keys(nudgeAck).sort()).toEqual([
        "eventId",
        "groupId",
        "ledgerVersion",
      ]);
      expect(nudgeAck.groupId).toBe(groupId);
      expect(typeof nudgeAck.ledgerVersion).toBe("number");
      expect(typeof nudgeAck.eventId).toBe("number");
    });

    it("emits a nudge event with amount in group_events", async () => {
      const { rows } = await withPg((client) =>
        client.query<{
          kind: string;
          actor_id: string;
          subject_user_id: string;
          payload: { amountCents: number };
          notified_at: string | null;
        }>(
          "SELECT kind, actor_id, subject_user_id, payload, notified_at FROM public.group_events WHERE id = $1",
          [nudgeAck.eventId],
        ),
      );

      expect(rows).toHaveLength(1);
      const event = rows[0];
      expect(event.kind).toBe("nudge");
      expect(event.actor_id).toBe(alice.id);
      expect(event.subject_user_id).toBe(bob.id);
      expect(event.payload).toEqual({ amountCents: 3000 });
      expect(event.notified_at).toBeNull();
    });

    it("scopes the cooldown per group: the same pair can be nudged in a second group", async () => {
      await expect(
        rpcErrorCode(clientAlice, "send_nudge", {
          p_group_id: groupId,
          p_user_id: bob.id,
        }),
      ).resolves.toBe("nudge_cooldown");

      const secondGroupAck = await rpcOk<NudgeAck>(clientAlice, "send_nudge", {
        p_group_id: otherGroupId,
        p_user_id: bob.id,
      });
      expect(secondGroupAck.groupId).toBe(otherGroupId);
      expect(typeof secondGroupAck.eventId).toBe("number");

      await expect(
        rpcErrorCode(clientAlice, "send_nudge", {
          p_group_id: otherGroupId,
          p_user_id: bob.id,
        }),
      ).resolves.toBe("nudge_cooldown");
    });

    it("rejects a second nudge within 24 hours with nudge_cooldown", async () => {
      await expect(
        rpcErrorCode(clientAlice, "send_nudge", {
          p_group_id: groupId,
          p_user_id: bob.id,
        }),
      ).resolves.toBe("nudge_cooldown");
    });

    it("holds the cooldown for a delivered nudge but frees an undelivered one", async () => {
      // Age the existing nudge past the in-flight grace window and mark it
      // delivered: that is the case the 24h cooldown exists for.
      await withPg(async (pg) => {
        await pg.query(
          `UPDATE group_events SET notified_at = now(), created_at = now() - interval '10 minutes'
           WHERE group_id = $1 AND kind = 'nudge' AND actor_id = $2 AND subject_user_id = $3`,
          [groupId, alice.id, bob.id],
        );
      });

      await expect(
        rpcErrorCode(clientAlice, "send_nudge", {
          p_group_id: groupId,
          p_user_id: bob.id,
        }),
      ).resolves.toBe("nudge_cooldown");

      // The same nudge, never delivered, must not cost the sender a day.
      await withPg(async (pg) => {
        await pg.query(
          `UPDATE group_events SET notified_at = NULL
           WHERE group_id = $1 AND kind = 'nudge' AND actor_id = $2 AND subject_user_id = $3`,
          [groupId, alice.id, bob.id],
        );
      });

      const retry = await rpcOk<NudgeAck>(clientAlice, "send_nudge", {
        p_group_id: groupId,
        p_user_id: bob.id,
      });
      expect(typeof retry.eventId).toBe("number");

      // That retry is itself undelivered and recent, so the grace window
      // still blocks a burst.
      await expect(
        rpcErrorCode(clientAlice, "send_nudge", {
          p_group_id: groupId,
          p_user_id: bob.id,
        }),
      ).resolves.toBe("nudge_cooldown");
    });
  },
);