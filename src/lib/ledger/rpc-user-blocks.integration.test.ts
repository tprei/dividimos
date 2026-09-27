import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";
import { forceLockContentionRace } from "@/test/db-race-barrier";
import {
  authenticateAs,
  createExpense,
  createGroupWithMembers,
  createTestUser,
  createTestUsers,
  equalSplitPayload,
  expectRpcError,
  getBalances,
  withPg,
} from "@/test/integration-helpers";

interface BlockProfile {
  id: string;
  handle: string;
  name: string;
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

async function anonRpc(fn: string, args: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const body = (await response.json()) as { message?: string };
  expect(response.ok).toBe(false);
  expect(body.message).toMatch(new RegExp(`permission denied for function ${fn}`));
}

describe.skipIf(!isIntegrationTestReady)("user blocks — lifecycle", () => {
  it("blocks and unblocks an onboarded user idempotently without shared membership", async () => {
    const [blocker, target] = await createTestUsers(2);
    const blockerClient = authenticateAs(blocker);

    const blocked = await rpcOk<BlockProfile[]>(blockerClient, "block_user", {
      p_user_id: target.id,
    });
    expect(blocked).toEqual([
      {
        id: target.id,
        handle: target.handle,
        name: target.name,
        avatarUrl: null,
        isBot: false,
      },
    ]);

    const repeat = await rpcOk<BlockProfile[]>(blockerClient, "block_user", {
      p_user_id: target.id,
    });
    expect(repeat).toEqual(blocked);

    const rows = await withPg(async (client) => {
      const result = await client.query<{ blocker_id: string; blocked_id: string }>(
        "select blocker_id, blocked_id from public.user_blocks where blocker_id = $1",
        [blocker.id],
      );
      return result.rows;
    });
    expect(rows).toEqual([{ blocker_id: blocker.id, blocked_id: target.id }]);

    const emptied = await rpcOk<BlockProfile[]>(blockerClient, "unblock_user", {
      p_user_id: target.id,
    });
    expect(emptied).toEqual([]);

    const repeatUnblock = await rpcOk<BlockProfile[]>(blockerClient, "unblock_user", {
      p_user_id: target.id,
    });
    expect(repeatUnblock).toEqual([]);
  });

  it("rejects anonymous callers and direct browser table access", async () => {
    const [blocker, target] = await createTestUsers(2);
    const blockerClient = authenticateAs(blocker);

    await anonRpc("block_user", { p_user_id: target.id });
    await anonRpc("unblock_user", { p_user_id: target.id });
    await anonRpc("get_user_blocks", {});

    const selectError = await blockerClient.from("user_blocks").select("*");
    expect(selectError.error?.message).toMatch(
      /permission denied for table user_blocks/,
    );

    const insertError = await blockerClient.from("user_blocks").insert({
      blocker_id: blocker.id,
      blocked_id: target.id,
    });
    expect(insertError.error?.message).toMatch(
      /permission denied for table user_blocks/,
    );

    const deleteError = await blockerClient
      .from("user_blocks")
      .delete()
      .eq("blocker_id", blocker.id);
    expect(deleteError.error?.message).toMatch(
      /permission denied for table user_blocks/,
    );

    const guardError = await rpcErrorCode(blockerClient, "assert_user_contact_allowed", {
      p_actor: blocker.id,
      p_other: target.id,
    });
    expect(guardError).toMatch(
      /permission denied for function assert_user_contact_allowed/,
    );

    const pushError = await rpcErrorCode(blockerClient, "get_push_blockers", {
      p_actor_id: blocker.id,
    });
    expect(pushError).toMatch(/permission denied for function get_push_blockers/);
  });

  it("does not expose incoming blocks to the blocked account", async () => {
    const [blocker, blocked, third] = await createTestUsers(3);
    const blockerClient = authenticateAs(blocker);
    await rpcOk(blockerClient, "block_user", { p_user_id: blocked.id });

    const blockedClient = authenticateAs(blocked);
    const blockedList = await rpcOk<BlockProfile[]>(blockedClient, "get_user_blocks", {});
    expect(blockedList).toEqual([]);

    const thirdClient = authenticateAs(third);
    const thirdList = await rpcOk<BlockProfile[]>(thirdClient, "get_user_blocks", {});
    expect(thirdList).toEqual([]);

    const blockerList = await rpcOk<BlockProfile[]>(blockerClient, "get_user_blocks", {});
    expect(blockerList.map((profile) => profile.id)).toEqual([blocked.id]);
  });

  it("rejects self null unknown and non-onboarded targets", async () => {
    const actor = await createTestUser();
    const notOnboarded = await createTestUser({ onboarded: false });
    const actorClient = authenticateAs(actor);

    expect(
      await rpcErrorCode(actorClient, "block_user", { p_user_id: actor.id }),
    ).toBe("invalid_argument");
    expect(await rpcErrorCode(actorClient, "block_user", { p_user_id: null })).toBe(
      "invalid_argument",
    );
    expect(
      await rpcErrorCode(actorClient, "unblock_user", { p_user_id: actor.id }),
    ).toBe("invalid_argument");
    expect(await rpcErrorCode(actorClient, "unblock_user", { p_user_id: null })).toBe(
      "invalid_argument",
    );

    expect(
      await rpcErrorCode(actorClient, "block_user", {
        p_user_id: crypto.randomUUID(),
      }),
    ).toBe("user_not_found");
    expect(
      await rpcErrorCode(actorClient, "block_user", { p_user_id: notOnboarded.id }),
    ).toBe("user_not_found");

    const list = await rpcOk<BlockProfile[]>(actorClient, "get_user_blocks", {});
    expect(list).toEqual([]);
  });

  it("refuses blocks past the hourly limit without changing the list", async () => {
    const [actor, target] = await createTestUsers(2);
    const actorClient = authenticateAs(actor);
    await withPg(async (client) => {
      await client.query(
        "insert into rate_limit_counters (bucket, subject, window_start, count) values ('user_blocks', $1, now(), 30)",
        [actor.id],
      );
    });

    expect(await rpcErrorCode(actorClient, "block_user", { p_user_id: target.id })).toBe(
      "block_rate_limited",
    );
    expect(await rpcOk<BlockProfile[]>(actorClient, "get_user_blocks", {})).toEqual([]);
  });

  it("unblocking preserves the reverse block and dm opt-outs", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);
    const brunoClient = authenticateAs(bruno);

    await withPg(async (client) => {
      await client.query(
        "insert into public.dm_opt_outs (user_id, other_user_id) values ($1, $2)",
        [ana.id, bruno.id],
      );
    });

    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });
    await rpcOk(brunoClient, "block_user", { p_user_id: ana.id });
    await rpcOk(anaClient, "unblock_user", { p_user_id: bruno.id });

    const guard = await adminClient!.rpc("assert_user_contact_allowed", {
      p_actor: ana.id,
      p_other: bruno.id,
    });
    expect(guard.error?.message).toBe("member_excluded");

    const optOuts = await withPg(async (client) => {
      const result = await client.query<{ user_id: string; other_user_id: string }>(
        "select user_id, other_user_id from public.dm_opt_outs where (user_id, other_user_id) in (($1, $2), ($2, $1))",
        [ana.id, bruno.id],
      );
      return result.rows;
    });
    expect(optOuts).toEqual([{ user_id: ana.id, other_user_id: bruno.id }]);

    const brunoList = await rpcOk<BlockProfile[]>(brunoClient, "get_user_blocks", {});
    expect(brunoList.map((profile) => profile.id)).toEqual([ana.id]);
  });

  it("does not change financial facts membership or balances", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const groupId = await createGroupWithMembers(ana, [bruno], "Grupo bloqueável");
    await createExpense(ana, {
      groupId,
      totalCents: 10000,
      title: "Jantar",
      payload: equalSplitPayload([ana.id, bruno.id], 10000),
    });

    const snapshot = async () => {
      const balances = await getBalances(groupId);
      return withPg(async (client) => {
        const members = await client.query<{ user_id: string; status: string }>(
          "select user_id, status from public.group_members where group_id = $1 order by user_id",
          [groupId],
        );
        const events = await client.query<{ count: string }>(
          "select count(*)::text as count from public.group_events where group_id = $1",
          [groupId],
        );
        const versions = await client.query<{ count: string }>(
          "select count(*)::text as count from public.expense_versions e join public.expenses x on x.id = e.expense_id where x.group_id = $1",
          [groupId],
        );
        return {
          balances,
          members: members.rows,
          events: events.rows[0].count,
          versions: versions.rows[0].count,
        };
      });
    };

    const before = await snapshot();

    const anaClient = authenticateAs(ana);
    await rpcOk(anaClient, "block_user", { p_user_id: bruno.id });
    const during = await snapshot();
    expect(during).toEqual(before);

    await rpcOk(anaClient, "unblock_user", { p_user_id: bruno.id });
    const after = await snapshot();
    expect(after).toEqual(before);
  });
});

describe.skipIf(!isIntegrationTestReady)("user blocks — service reads", () => {
  it("exposes push blockers only through the service role", async () => {
    const [actor, blocker] = await createTestUsers(2);
    const blockerClient = authenticateAs(blocker);
    await rpcOk(blockerClient, "block_user", { p_user_id: actor.id });

    const { data } = (await adminClient!.rpc("get_push_blockers", {
      p_actor_id: actor.id,
    })) as RpcResult<string[]>;
    expect(data).toEqual([blocker.id]);

    const empty = (await adminClient!.rpc("get_push_blockers", {
      p_actor_id: blocker.id,
    })) as RpcResult<string[]>;
    expect(empty.data).toEqual([]);
  });

  it("rejects a service call without an authenticated subject", async () => {
    const actor = await createTestUser();
    const { error } = await adminClient!.rpc("block_user", { p_user_id: actor.id });
    expect(error?.message).toBe("unauthenticated");
  });
});

describe.skipIf(!isIntegrationTestReady)("user blocks under forced lock contention", () => {
  const databaseUrl = process.env.SUPABASE_DB_URL ?? "";

  it("lets two users block each other concurrently", async () => {
    const [ana, bruno] = await createTestUsers(2);
    const anaClient = authenticateAs(ana);
    const brunoClient = authenticateAs(bruno);

    const { result, contention } = await forceLockContentionRace(
      databaseUrl,
      {
        lockSql: "select id from public.users where id = any($1::uuid[]) for update",
        lockParams: [[ana.id, bruno.id]],
        queryContains: ["block_user"],
        expectedRacers: 2,
      },
      () =>
        Promise.allSettled([
          anaClient.rpc("block_user", { p_user_id: bruno.id }),
          brunoClient.rpc("block_user", { p_user_id: ana.id }),
        ]),
    );

    expect(contention.observed).toBe(true);
    for (const entry of result) {
      expect(entry.status).toBe("fulfilled");
      if (entry.status === "fulfilled") {
        expect(entry.value.error).toBeNull();
      }
    }

    const anaList = await rpcOk<{ id: string }[]>(anaClient, "get_user_blocks", {});
    expect(anaList.map((profile) => profile.id)).toEqual([bruno.id]);
    const brunoList = await rpcOk<{ id: string }[]>(brunoClient, "get_user_blocks", {});
    expect(brunoList.map((profile) => profile.id)).toEqual([ana.id]);
  });
});
