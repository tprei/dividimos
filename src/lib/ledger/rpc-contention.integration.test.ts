import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { forceLockContentionRace } from "@/test/db-race-barrier";
import {
  authenticateAs,
  createExpense,
  createGroupWithMembers,
  createTestUsers,
  equalSplitPayload,
  getBalances,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";
import { isIntegrationTestReady } from "@/test/integration-setup";
import { assertLedgerInvariantsAfterEach } from "@/test/ledger-invariants";
import type { ExpenseDetail } from "@/types/ledger";

assertLedgerInvariantsAfterEach();

const LOCK_GROUP_SQL = "select id from public.groups where id = $1 for update";
/**
 * The exact advisory key `lock_receipt_key(creator, chave_acesso)` takes:
 * pg_advisory_xact_lock(hashtextextended('<creator-id>:<chave>', 0)), held
 * inside the barrier's transaction so both racing RPC bodies queue on it.
 */
const LOCK_RECEIPT_KEY_SQL =
  "select pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2, 0))";

/** A Postgres-level failure reaching the client is a bug, never an outcome. */
const LEAKED_INTERNALS = /40001|40P01|deadlock|could not serialize|current transaction is aborted/i;

interface Settled {
  ok: boolean;
  value: unknown;
  message: string;
}

function summarize(results: PromiseSettledResult<{ data: unknown; error: { message: string } | null }>[]): Settled[] {
  return results.map((result) => {
    if (result.status === "rejected") {
      return { ok: false, value: null, message: String(result.reason) };
    }
    return {
      ok: result.value.error === null,
      value: result.value.data,
      message: result.value.error?.message ?? "",
    };
  });
}

function expectNoLeakedInternals(outcomes: readonly Settled[]): void {
  for (const outcome of outcomes) {
    expect(outcome.message).not.toMatch(LEAKED_INTERNALS);
  }
}

async function rpcOk<T>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`RPC ${fn} failed: ${error.message}`);
  return data as T;
}

describe.skipIf(!isIntegrationTestReady)("ledger RPCs under forced lock contention", () => {
  let alice: TestUser;
  let bruno: TestUser;
  let carla: TestUser;
  let aliceClient: SupabaseClient;
  let brunoClient: SupabaseClient;
  let carlaClient: SupabaseClient;
  let databaseUrl = "";

  beforeAll(async () => {
    [alice, bruno, carla] = await createTestUsers(3);
    aliceClient = authenticateAs(alice);
    brunoClient = authenticateAs(bruno);
    carlaClient = authenticateAs(carla);
    databaseUrl = process.env.SUPABASE_DB_URL ?? "";
    if (!databaseUrl) throw new Error("SUPABASE_DB_URL is required for contention tests");
  });

  function editArgs(
    expenseId: string,
    expectedVersionNo: number,
    totalCents: number,
    payload: unknown,
  ): Record<string, unknown> {
    return {
      p_expense_id: expenseId,
      p_expected_version_no: expectedVersionNo,
      p_occurred_on: "2026-02-01",
      p_title: `Disputa ${totalCents}`,
      p_merchant_name: null,
      p_expense_type: "single_amount",
      p_total_cents: totalCents,
      p_service_fee_bps: 0,
      p_fixed_fee_cents: 0,
      p_payload: payload,
    };
  }

  /** A valid NFe-style access key: 44 digits, unique per active receipt. */
  function receiptKey(): string {
    const digits = crypto.randomUUID().replace(/[^0-9]/g, "");
    return (digits + "0123456789".repeat(5)).slice(0, 44);
  }

  it("lets exactly one of two same-version edits win", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const created = await createExpense(alice, {
      groupId,
      totalCents: 4000,
      payload: equalSplitPayload([alice.id, bruno.id], 4000),
    });

    const { result, contention } = await forceLockContentionRace(
      databaseUrl,
      {
        lockSql: LOCK_GROUP_SQL,
        lockParams: [groupId],
        queryContains: ["edit_expense"],
        expectedRacers: 2,
      },
      () =>
        Promise.allSettled([
          aliceClient.rpc(
            "edit_expense",
            editArgs(created.expenseId, 1, 6000, equalSplitPayload([alice.id, bruno.id], 6000)),
          ),
          brunoClient.rpc(
            "edit_expense",
            editArgs(created.expenseId, 1, 8000, equalSplitPayload([alice.id, bruno.id], 8000)),
          ),
        ]),
    );

    expect(contention.observed).toBe(true);
    const outcomes = summarize(result);
    expectNoLeakedInternals(outcomes);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.find((outcome) => !outcome.ok)?.message).toBe("stale_version");

    const state = await withPg(async (client) => {
      const expense = await client.query<{ current_version_no: number }>(
        "select current_version_no from public.expenses where id = $1",
        [created.expenseId],
      );
      const versions = await client.query<{ count: string }>(
        "select count(*) as count from public.expense_versions where expense_id = $1",
        [created.expenseId],
      );
      return {
        versionNo: expense.rows[0].current_version_no,
        versionCount: Number(versions.rows[0].count),
      };
    });
    expect(state.versionNo).toBe(2);
    expect(state.versionCount).toBe(2);
  });

  it("resolves an edit racing a delete into one of two consistent end states", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const created = await createExpense(alice, {
      groupId,
      totalCents: 4000,
      payload: equalSplitPayload([alice.id, bruno.id], 4000),
    });

    const { result, contention } = await forceLockContentionRace(
      databaseUrl,
      {
        lockSql: LOCK_GROUP_SQL,
        lockParams: [groupId],
        queryContains: ["edit_expense", "delete_expense"],
        expectedRacers: 2,
      },
      () =>
        Promise.allSettled([
          aliceClient.rpc(
            "edit_expense",
            editArgs(created.expenseId, 1, 6000, equalSplitPayload([alice.id, bruno.id], 6000)),
          ),
          brunoClient.rpc("delete_expense", { p_expense_id: created.expenseId }),
        ]),
    );

    expect(contention.observed).toBe(true);
    const [edit, remove] = summarize(result);
    expectNoLeakedInternals([edit, remove]);
    expect(remove.ok).toBe(true);

    const state = await withPg(async (client) => {
      const expense = await client.query<{ status: string; current_version_no: number }>(
        "select status, current_version_no from public.expenses where id = $1",
        [created.expenseId],
      );
      const versions = await client.query<{ count: string }>(
        "select count(*) as count from public.expense_versions where expense_id = $1",
        [created.expenseId],
      );
      const balances = await client.query<{ count: string }>(
        "select count(*) as count from public.group_balances where group_id = $1",
        [groupId],
      );
      return {
        status: expense.rows[0].status,
        versionNo: expense.rows[0].current_version_no,
        versionCount: Number(versions.rows[0].count),
        balanceCount: Number(balances.rows[0].count),
      };
    });

    expect(state.status).toBe("deleted");
    expect(state.balanceCount).toBe(0);
    if (edit.ok) {
      expect(state.versionNo).toBe(2);
      expect(state.versionCount).toBe(2);
    } else {
      expect(edit.message).toBe("expense_deleted");
      expect(state.versionNo).toBe(1);
      expect(state.versionCount).toBe(1);
    }
  });

  it("keeps a settlement racing a delete of the expense that created the debt consistent", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const created = await createExpense(alice, {
      groupId,
      totalCents: 4000,
      payload: equalSplitPayload([alice.id, bruno.id], 4000),
    });

    const { result, contention } = await forceLockContentionRace(
      databaseUrl,
      {
        lockSql: LOCK_GROUP_SQL,
        lockParams: [groupId],
        queryContains: ["record_settlement", "delete_expense"],
        expectedRacers: 2,
      },
      () =>
        Promise.allSettled([
          brunoClient.rpc("record_settlement", {
            p_operation_id: crypto.randomUUID(),
            p_group_id: groupId,
            p_from_user_id: bruno.id,
            p_to_user_id: alice.id,
            p_amount_cents: 2000,
          }),
          aliceClient.rpc("delete_expense", { p_expense_id: created.expenseId }),
        ]),
    );

    expect(contention.observed).toBe(true);
    const [settlement, remove] = summarize(result);
    expectNoLeakedInternals([settlement, remove]);
    expect(remove.ok).toBe(true);

    const balances = await withPg(async (client) => {
      const rows = await client.query<{ participant_id: string; net_cents: string }>(
        "select participant_id, net_cents from public.group_balances where group_id = $1",
        [groupId],
      );
      return rows.rows.map((row) => ({
        participantId: row.participant_id,
        netCents: Number(row.net_cents),
      }));
    });

    if (settlement.ok) {
      expect(balances).toHaveLength(2);
      expect(balances.find((row) => row.participantId === bruno.id)?.netCents).toBe(2000);
      expect(balances.find((row) => row.participantId === alice.id)?.netCents).toBe(-2000);
    } else {
      expect(settlement.message).toBe("amount_exceeds_debt");
      expect(balances).toHaveLength(0);
    }
  });

  it("creates one expense when the same client id races itself", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const clientId = crypto.randomUUID();
    const args = {
      p_client_id: clientId,
      p_group_id: groupId,
      p_occurred_on: "2026-02-01",
      p_title: "Idempotente",
      p_merchant_name: null,
      p_expense_type: "single_amount",
      p_total_cents: 5000,
      p_service_fee_bps: 0,
      p_fixed_fee_cents: 0,
      p_payload: equalSplitPayload([alice.id, bruno.id], 5000),
    };

    const { result, contention } = await forceLockContentionRace(
      databaseUrl,
      {
        lockSql: LOCK_GROUP_SQL,
        lockParams: [groupId],
        queryContains: ["create_expense"],
        expectedRacers: 2,
      },
      () =>
        Promise.allSettled([
          aliceClient.rpc("create_expense", args),
          aliceClient.rpc("create_expense", args),
        ]),
    );

    expect(contention.observed).toBe(true);
    const outcomes = summarize(result);
    expectNoLeakedInternals(outcomes);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    const ids = outcomes.map((outcome) => {
      const ack = outcome.value;
      if (typeof ack !== "object" || ack === null || !("expenseId" in ack)) {
        throw new Error(`expected an expense ack, got ${JSON.stringify(ack)}`);
      }
      return ack.expenseId;
    });
    expect(new Set(ids).size).toBe(1);

    const counts = await withPg(async (client) => {
      const expenses = await client.query<{ count: string }>(
        "select count(*) as count from public.expenses where group_id = $1",
        [groupId],
      );
      const events = await client.query<{ count: string }>(
        "select count(*) as count from public.group_events " +
          "where group_id = $1 and kind = 'expense_created'",
        [groupId],
      );
      return {
        expenses: Number(expenses.rows[0].count),
        events: Number(events.rows[0].count),
      };
    });
    expect(counts.expenses).toBe(1);
    expect(counts.events).toBe(1);
  });

  it("records one settlement when the same operation id races itself", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno]);
    await createExpense(alice, {
      groupId,
      totalCents: 4000,
      payload: equalSplitPayload([alice.id, bruno.id], 4000),
    });
    const args = {
      p_operation_id: crypto.randomUUID(),
      p_group_id: groupId,
      p_from_user_id: bruno.id,
      p_to_user_id: alice.id,
      p_amount_cents: 2000,
    };

    const { result, contention } = await forceLockContentionRace(
      databaseUrl,
      {
        lockSql: LOCK_GROUP_SQL,
        lockParams: [groupId],
        queryContains: ["record_settlement"],
        expectedRacers: 2,
      },
      () =>
        Promise.allSettled([
          brunoClient.rpc("record_settlement", args),
          brunoClient.rpc("record_settlement", args),
        ]),
    );

    expect(contention.observed).toBe(true);
    const outcomes = summarize(result);
    expectNoLeakedInternals(outcomes);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    const ids = outcomes.map((outcome) => {
      const ack = outcome.value;
      if (typeof ack !== "object" || ack === null || !("settlementId" in ack)) {
        throw new Error(`expected a settlement ack, got ${JSON.stringify(ack)}`);
      }
      return ack.settlementId;
    });
    expect(new Set(ids).size).toBe(1);

    const settlements = await withPg(async (client) => {
      const rows = await client.query<{ count: string }>(
        "select count(*) as count from public.settlements where group_id = $1",
        [groupId],
      );
      return Number(rows.rows[0].count);
    });
    expect(settlements).toBe(1);
  });

  it("pays the debt once when two distinct settlements race for all of it", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno]);
    await createExpense(alice, {
      groupId,
      totalCents: 4000,
      payload: equalSplitPayload([alice.id, bruno.id], 4000),
    });

    const { result, contention } = await forceLockContentionRace(
      databaseUrl,
      {
        lockSql: LOCK_GROUP_SQL,
        lockParams: [groupId],
        queryContains: ["record_settlement"],
        expectedRacers: 2,
      },
      () =>
        Promise.allSettled([
          brunoClient.rpc("record_settlement", {
            p_operation_id: crypto.randomUUID(),
            p_group_id: groupId,
            p_from_user_id: bruno.id,
            p_to_user_id: alice.id,
            p_amount_cents: 2000,
          }),
          aliceClient.rpc("record_settlement", {
            p_operation_id: crypto.randomUUID(),
            p_group_id: groupId,
            p_from_user_id: bruno.id,
            p_to_user_id: alice.id,
            p_amount_cents: 2000,
          }),
        ]),
    );

    expect(contention.observed).toBe(true);
    const outcomes = summarize(result);
    expectNoLeakedInternals(outcomes);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.find((outcome) => !outcome.ok)?.message).toBe("amount_exceeds_debt");

    const balances = await withPg(async (client) => {
      const rows = await client.query<{ count: string }>(
        "select count(*) as count from public.group_balances where group_id = $1",
        [groupId],
      );
      return Number(rows.rows[0].count);
    });
    expect(balances).toBe(0);
  });

  it("resolves a guest claim racing an edit that drops the guest", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const created = await createExpense(alice, {
      groupId,
      totalCents: 6000,
      payload: {
        items: [],
        participants: [
          { kind: "user", userId: alice.id },
          { kind: "user", userId: bruno.id },
          { kind: "guest", guestId: null, displayName: "Convidada" },
        ],
        shares: [2000, 2000, 2000],
        payers: [{ participantIndex: 0, amountCents: 6000 }],
        itemAssignments: null,
      },
    });
    const guestId = await withPg(async (client) => {
      const rows = await client.query<{ id: string }>(
        "select id from public.guests where expense_id = $1",
        [created.expenseId],
      );
      return rows.rows[0].id;
    });
    const issued = await rpcOk<{ token: string }>(
      aliceClient,
      "create_guest_claim_token",
      { p_guest_id: guestId },
    );
    const token = issued.token;

    const { result, contention } = await forceLockContentionRace(
      databaseUrl,
      {
        lockSql: LOCK_GROUP_SQL,
        lockParams: [groupId],
        queryContains: ["claim_guest", "edit_expense"],
        expectedRacers: 2,
      },
      () =>
        Promise.allSettled([
          carlaClient.rpc("claim_guest", { p_token: token }),
          aliceClient.rpc(
            "edit_expense",
            editArgs(created.expenseId, 1, 4000, equalSplitPayload([alice.id, bruno.id], 4000)),
          ),
        ]),
    );

    expect(contention.observed).toBe(true);
    const [claim, edit] = summarize(result);
    expectNoLeakedInternals([claim, edit]);
    expect(edit.ok).toBe(true);

    // claim_guest rewrites the payload in place without bumping the version,
    // so the edit succeeds either way and strips the guest slot. What survives
    // a winning claim is the claimed guest row and the claimer's membership.
    const state = await withPg(async (client) => {
      const guest = await client.query<{ claimed_by: string | null }>(
        "select claimed_by from public.guests where id = $1",
        [guestId],
      );
      const member = await client.query<{ status: string }>(
        "select status from public.group_members where group_id = $1 and user_id = $2",
        [groupId, carla.id],
      );
      return {
        claimedBy: guest.rows[0]?.claimed_by ?? null,
        membership: member.rows[0]?.status ?? null,
      };
    });
    const afterRace = await rpcOk<ExpenseDetail>(aliceClient, "get_expense", {
      p_expense_id: created.expenseId,
    });

    expect(afterRace.participants).toHaveLength(2);
    expect(afterRace.participants.every((row) => row.kind === "user")).toBe(true);
    if (claim.ok) {
      expect(state.claimedBy).toBe(carla.id);
      expect(state.membership).toBe("accepted");
    } else {
      expect(claim.message).toBe("invalid_token");
      expect(state.claimedBy).toBeNull();
      expect(state.membership).toBeNull();
    }
  });

  /** Proves a backend is genuinely queued on a lock (not just slow). */
  async function waitForLockWait(
    monitor: Client,
    queryPattern: string,
    timeoutMs = 5000,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { rows } = await monitor.query<{ wait_event_type: string | null }>(
        "select wait_event_type from pg_stat_activity " +
          "where pid <> pg_backend_pid() and state = 'active' and query ilike $1",
        [`%${queryPattern}%`],
      );
      if (rows.some((row) => row.wait_event_type === "Lock")) return true;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return false;
  }

  async function guestWithToken(): Promise<{
    groupId: string;
    guestId: string;
    token: string;
  }> {
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const created = await createExpense(alice, {
      groupId,
      totalCents: 6000,
      payload: {
        items: [],
        participants: [
          { kind: "user", userId: alice.id },
          { kind: "user", userId: bruno.id },
          { kind: "guest", guestId: null, displayName: "Convidada" },
        ],
        shares: [2000, 2000, 2000],
        payers: [{ participantIndex: 0, amountCents: 6000 }],
        itemAssignments: null,
      },
    });
    const guestId = await withPg(async (client) => {
      const rows = await client.query<{ id: string }>(
        "select id from public.guests where expense_id = $1",
        [created.expenseId],
      );
      return rows.rows[0].id;
    });
    const issued = await rpcOk<{ token: string }>(
      aliceClient,
      "create_guest_claim_token",
      { p_guest_id: guestId },
    );
    return { groupId, guestId, token: issued.token };
  }

  it("lets exactly one of two concurrent claimants win the same token", async () => {
    const dave = (await createTestUsers(1))[0];
    const daveClient = authenticateAs(dave);
    const { groupId, guestId, token } = await guestWithToken();

    const { result, contention } = await forceLockContentionRace(
      databaseUrl,
      {
        lockSql: LOCK_GROUP_SQL,
        lockParams: [groupId],
        queryContains: ["claim_guest"],
        expectedRacers: 2,
      },
      () =>
        Promise.allSettled([
          carlaClient.rpc("claim_guest", { p_token: token }),
          daveClient.rpc("claim_guest", { p_token: token }),
        ]),
    );

    expect(contention.observed).toBe(true);
    const outcomes = summarize(result);
    expectNoLeakedInternals(outcomes);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.find((outcome) => !outcome.ok)?.message).toBe("already_claimed");

    const state = await withPg(async (client) => {
      const guest = await client.query<{ claimed_by: string | null }>(
        "select claimed_by from public.guests where id = $1",
        [guestId],
      );
      const members = await client.query<{ user_id: string }>(
        "select user_id from public.group_members where group_id = $1",
        [groupId],
      );
      return { claimedBy: guest.rows[0]?.claimed_by ?? null, members: members.rows };
    });
    expect([carla.id, dave.id]).toContain(state.claimedBy);
    const winnerMemberRows = state.members.filter((row) => row.user_id === state.claimedBy);
    const loserMemberRows = state.members.filter(
      (row) => row.user_id === (state.claimedBy === carla.id ? dave.id : carla.id),
    );
    expect(winnerMemberRows).toHaveLength(1);
    expect(loserMemberRows).toHaveLength(0);
  });

  it("fails the claim with invalid_token when a revoke commits while the claim waits on the group lock", async () => {
    const { groupId, guestId, token } = await guestWithToken();
    const beforeBalances = await getBalances(groupId);

    const holder = new Client(databaseUrl);
    const monitor = new Client(databaseUrl);
    await holder.connect();
    await monitor.connect();
    try {
      await holder.query("begin");
      await holder.query(LOCK_GROUP_SQL, [groupId]);
      const claimPromise = Promise.resolve().then(() => carlaClient.rpc("claim_guest", { p_token: token }));
      expect(await waitForLockWait(monitor, "claim_guest")).toBe(true);

      // The holder already owns the group lock, so revoke runs inside this
      // transaction without self-deadlock and deletes the credential.
      await holder.query("select set_config('request.jwt.claim.sub', $1, true)", [bruno.id]);
      await holder.query("select public.revoke_guest_claim_token($1)", [guestId]);
      await holder.query("commit");

      const claim = await claimPromise;
      expect(claim.error?.message).toBe("invalid_token");
    } finally {
      await holder.query("rollback").catch(() => {});
      await holder.end();
      await monitor.end();
    }

    const state = await withPg(async (client) => {
      const guest = await client.query<{ claimed_by: string | null }>(
        "select claimed_by from public.guests where id = $1",
        [guestId],
      );
      const member = await client.query<{ count: string }>(
        "select count(*) as count from public.group_members where group_id = $1 and user_id = $2",
        [groupId, carla.id],
      );
      return { claimedBy: guest.rows[0]?.claimed_by ?? null, memberCount: Number(member.rows[0].count) };
    });
    expect(state.claimedBy).toBeNull();
    expect(state.memberCount).toBe(0);
    expect(await getBalances(groupId)).toEqual(beforeBalances);
  });

  it("fails the old token with invalid_token when a rotation commits while the claim waits, then the new token claims", async () => {
    const { groupId, guestId, token: oldToken } = await guestWithToken();

    const holder = new Client(databaseUrl);
    const monitor = new Client(databaseUrl);
    await holder.connect();
    await monitor.connect();
    let newToken = "";
    try {
      await holder.query("begin");
      await holder.query(LOCK_GROUP_SQL, [groupId]);
      const claimPromise = Promise.resolve().then(() => carlaClient.rpc("claim_guest", { p_token: oldToken }));
      expect(await waitForLockWait(monitor, "claim_guest")).toBe(true);

      await holder.query("select set_config('request.jwt.claim.sub', $1, true)", [alice.id]);
      const rotated = await holder.query<{ create_guest_claim_token: { token: string } }>(
        "select public.create_guest_claim_token($1)",
        [guestId],
      );
      newToken = rotated.rows[0].create_guest_claim_token.token;
      expect(newToken).not.toBe(oldToken);
      await holder.query("commit");

      const claim = await claimPromise;
      expect(claim.error?.message).toBe("invalid_token");
    } finally {
      await holder.query("rollback").catch(() => {});
      await holder.end();
      await monitor.end();
    }

    const claimed = await withPg(async (client) => {
      const guest = await client.query<{ claimed_by: string | null }>(
        "select claimed_by from public.guests where id = $1",
        [guestId],
      );
      return guest.rows[0]?.claimed_by ?? null;
    });
    expect(claimed).toBeNull();

    const newClaim = await carlaClient.rpc("claim_guest", { p_token: newToken });
    expect(newClaim.error).toBeNull();
  });

  it("fails the claim with invalid_token when the token expires while the claim waits on the group lock", async () => {
    const { groupId, guestId, token } = await guestWithToken();
    await withPg((client) =>
      client.query(
        "update guest_credentials.claim_tokens " +
          "set expires_at = clock_timestamp() + interval '500 milliseconds' " +
          "where guest_id = $1",
        [guestId],
      ),
    );

    const holder = new Client(databaseUrl);
    const monitor = new Client(databaseUrl);
    await holder.connect();
    await monitor.connect();
    try {
      await holder.query("begin");
      await holder.query(LOCK_GROUP_SQL, [groupId]);
      const claimPromise = Promise.resolve().then(() => carlaClient.rpc("claim_guest", { p_token: token }));
      expect(await waitForLockWait(monitor, "claim_guest")).toBe(true);

      // Wait for wall-clock expiry while the claim is provably queued.
      const expired = await monitor
        .query<{ expired: boolean }>(
          "select clock_timestamp() > expires_at as expired " +
            "from guest_credentials.claim_tokens where guest_id = $1",
          [guestId],
        )
        .then(async (first) => {
          if (first.rows[0]?.expired) return true;
          await new Promise((resolve) => setTimeout(resolve, 700));
          const second = await monitor.query<{ expired: boolean }>(
            "select clock_timestamp() > expires_at as expired " +
              "from guest_credentials.claim_tokens where guest_id = $1",
            [guestId],
          );
          return second.rows[0]?.expired === true;
        });
      expect(expired).toBe(true);

      await holder.query("commit");
      const claim = await claimPromise;
      expect(claim.error?.message).toBe("invalid_token");
    } finally {
      await holder.query("rollback").catch(() => {});
      await holder.end();
      await monitor.end();
    }

    const state = await withPg(async (client) => {
      const member = await client.query<{ count: string }>(
        "select count(*) as count from public.group_members where group_id = $1 and user_id = $2",
        [groupId, carla.id],
      );
      return Number(member.rows[0].count);
    });
    expect(state).toBe(0);
  });

  it("fails the claim with invalid_token when an edit removes the guest while the claim waits on the group lock", async () => {
    const seeded = await guestWithToken();
    const expenseId = await withPg(async (client) => {
      const rows = await client.query<{ expense_id: string }>(
        "select expense_id from public.guests where id = $1",
        [seeded.guestId],
      );
      return rows.rows[0].expense_id;
    });

    const holder = new Client(databaseUrl);
    const monitor = new Client(databaseUrl);
    await holder.connect();
    await monitor.connect();
    try {
      await holder.query("begin");
      await holder.query(LOCK_GROUP_SQL, [seeded.groupId]);
      const claimPromise = Promise.resolve().then(() => carlaClient.rpc("claim_guest", { p_token: seeded.token }));
      expect(await waitForLockWait(monitor, "claim_guest")).toBe(true);

      const args = editArgs(expenseId, 1, 6000, equalSplitPayload([alice.id, bruno.id], 6000));
      await holder.query("select set_config('request.jwt.claim.sub', $1, true)", [alice.id]);
      await holder.query(
        "select public.edit_expense($1, $2, $3, $4, $5, $6::public.expense_type, $7, $8, $9, $10::jsonb)",
        [
          args.p_expense_id,
          args.p_expected_version_no,
          args.p_occurred_on,
          args.p_title,
          args.p_merchant_name,
          args.p_expense_type,
          args.p_total_cents,
          args.p_service_fee_bps,
          args.p_fixed_fee_cents,
          JSON.stringify(args.p_payload),
        ],
      );
      await holder.query("commit");

      const claim = await claimPromise;
      expect(claim.error?.message).toBe("invalid_token");
    } finally {
      await holder.query("rollback").catch(() => {});
      await holder.end();
      await monitor.end();
    }

    const state = await withPg(async (client) => {
      const member = await client.query<{ count: string }>(
        "select count(*) as count from public.group_members where group_id = $1 and user_id = $2",
        [seeded.groupId, carla.id],
      );
      return Number(member.rows[0].count);
    });
    expect(state).toBe(0);
  });

  it("keeps one active receipt when a restore races a create with the same chave", async () => {
    const groupId = await createGroupWithMembers(alice, [bruno]);
    const chave = receiptKey();
    const created = await createExpense(alice, {
      groupId,
      totalCents: 4000,
      payload: equalSplitPayload([alice.id, bruno.id], 4000),
      receiptAccessKey: chave,
    });
    await rpcOk<unknown>(aliceClient, "delete_expense", { p_expense_id: created.expenseId });

    // Both RPC bodies open with lock_receipt_key(creator, chave) — the
    // advisory xact lock on "creator:chave" — so holding exactly that key
    // forces the restore and the create to contend deterministically.
    const { result, contention } = await forceLockContentionRace(
      databaseUrl,
      {
        lockSql: LOCK_RECEIPT_KEY_SQL,
        lockParams: [alice.id, chave],
        queryContains: ["restore_expense", "create_expense"],
        expectedRacers: 2,
      },
      () =>
        Promise.allSettled([
          aliceClient.rpc("restore_expense", { p_expense_id: created.expenseId }),
          aliceClient.rpc("create_expense", {
            p_client_id: crypto.randomUUID(),
            p_group_id: groupId,
            p_occurred_on: "2026-02-01",
            p_title: "Restauração",
            p_merchant_name: null,
            p_expense_type: "single_amount",
            p_total_cents: 4000,
            p_service_fee_bps: 0,
            p_fixed_fee_cents: 0,
            p_chave_acesso: chave,
            p_payload: equalSplitPayload([alice.id, bruno.id], 4000),
          }),
        ]),
    );

    expect(contention.observed).toBe(true);
    const outcomes = summarize(result);
    expectNoLeakedInternals(outcomes);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.find((outcome) => !outcome.ok)?.message).toBe("duplicate_receipt");

    const state = await withPg(async (client) => {
      const receipts = await client.query<{ id: string; status: string }>(
        "select id, status from public.expenses where creator_id = $1 and chave_acesso = $2",
        [alice.id, chave],
      );
      const balances = await client.query<{ participant_id: string; net_cents: string }>(
        "select participant_id, net_cents from public.group_balances where group_id = $1",
        [groupId],
      );
      return {
        receipts: receipts.rows,
        balances: balances.rows.map((row) => ({
          participantId: row.participant_id,
          netCents: Number(row.net_cents),
        })),
      };
    });

    const active = state.receipts.filter((row) => row.status === "active");
    expect(active).toHaveLength(1);
    const acks = outcomes
      .filter((outcome) => outcome.ok)
      .map((outcome) => {
        const ack = outcome.value;
        if (typeof ack !== "object" || ack === null || !("expenseId" in ack)) {
          throw new Error(`expected an expense ack, got ${JSON.stringify(ack)}`);
        }
        return ack as { expenseId: string };
      });
    expect(acks).toHaveLength(1);
    expect(acks[0].expenseId).toBe(active[0].id);
    expect(state.balances).toHaveLength(2);
    expect(state.balances.find((row) => row.participantId === alice.id)?.netCents).toBe(2000);
    expect(state.balances.find((row) => row.participantId === bruno.id)?.netCents).toBe(-2000);
  });

  it("replays the same group and expense when create_expense_with_group races itself", async () => {
    const clientId = crypto.randomUUID();
    const chave = receiptKey();
    const groupName = `Grupo corrida ${crypto.randomUUID()}`;
    const args = {
      p_client_id: clientId,
      p_group_name: groupName,
      p_member_ids: [bruno.id],
      p_occurred_on: "2026-02-01",
      p_title: "Compartilhado",
      p_merchant_name: null,
      p_expense_type: "single_amount",
      p_total_cents: 5000,
      p_service_fee_bps: 0,
      p_fixed_fee_cents: 0,
      p_chave_acesso: chave,
      p_payload: equalSplitPayload([alice.id, bruno.id], 5000),
    };

    // Both retries share the client-supplied replay identity (client_id +
    // chave_acesso). The advisory xact lock inside create_expense is the
    // contention point: whoever loses must observe the winner's committed
    // client_id row and replay instead of writing a second group.
    const { result, contention } = await forceLockContentionRace(
      databaseUrl,
      {
        lockSql: LOCK_RECEIPT_KEY_SQL,
        lockParams: [alice.id, chave],
        queryContains: ["create_expense_with_group"],
        expectedRacers: 2,
      },
      () =>
        Promise.allSettled([
          aliceClient.rpc("create_expense_with_group", args),
          aliceClient.rpc("create_expense_with_group", args),
        ]),
    );

    expect(contention.observed).toBe(true);
    const outcomes = summarize(result);
    expectNoLeakedInternals(outcomes);
    expect(outcomes.filter((outcome) => !outcome.ok).map((outcome) => outcome.message)).toEqual([]);
    const acks = outcomes.map((outcome) => {
      const ack = outcome.value;
      if (typeof ack !== "object" || ack === null || !("expenseId" in ack) || !("groupId" in ack)) {
        throw new Error(`expected an expense ack, got ${JSON.stringify(ack)}`);
      }
      return ack as { expenseId: string; groupId: string; eventId: number | null };
    });
    expect(new Set(acks.map((ack) => ack.expenseId)).size).toBe(1);
    expect(new Set(acks.map((ack) => ack.groupId)).size).toBe(1);
    // Only the call that actually wrote carries an event id; the replay
    // returns eventId NULL.
    expect(acks.filter((ack) => ack.eventId !== null)).toHaveLength(1);

    const groupId = acks[0].groupId;
    const state = await withPg(async (client) => {
      const expenses = await client.query<{ id: string; group_id: string }>(
        "select id, group_id from public.expenses where client_id = $1",
        [clientId],
      );
      const groups = await client.query<{ id: string }>(
        "select id from public.groups where creator_id = $1 and name = $2",
        [alice.id, groupName],
      );
      const members = await client.query<{ user_id: string; status: string }>(
        "select user_id, status from public.group_members where group_id = $1",
        [groupId],
      );
      return {
        expenses: expenses.rows,
        groups: groups.rows,
        members: members.rows,
      };
    });

    expect(state.expenses).toHaveLength(1);
    expect(state.expenses[0].group_id).toBe(groupId);
    expect(state.groups).toHaveLength(1);
    expect(state.groups[0].id).toBe(groupId);
    expect(state.members).toHaveLength(2);
    expect(state.members.find((row) => row.user_id === alice.id)?.status).toBe("accepted");
    expect(state.members.find((row) => row.user_id === bruno.id)?.status).toBe("invited");
  });

  it("opens one dm when both sides call get_or_create_dm at the same time", async () => {
    // get_or_create_dm locks no pre-existing row: its atomicity comes from
    // the UNIQUE (dm_user_a, dm_user_b) constraint via ON CONFLICT DO
    // NOTHING, so plain concurrent execution of both pair orders plus the
    // deterministic uniqueness outcome is the proof here.
    const settled = await Promise.allSettled([
      aliceClient.rpc("get_or_create_dm", { p_user_id: bruno.id }),
      brunoClient.rpc("get_or_create_dm", { p_user_id: alice.id }),
    ]);

    const outcomes = summarize(settled);
    expectNoLeakedInternals(outcomes);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    const acks = outcomes.map((outcome) => {
      const ack = outcome.value;
      if (typeof ack !== "object" || ack === null || !("groupId" in ack) || !("created" in ack)) {
        throw new Error(`expected a dm ack, got ${JSON.stringify(ack)}`);
      }
      return ack as { groupId: string; created: boolean };
    });
    expect(new Set(acks.map((ack) => ack.groupId)).size).toBe(1);
    expect(acks.filter((ack) => ack.created)).toHaveLength(1);

    const groupId = acks[0].groupId;
    const state = await withPg(async (client) => {
      const groups = await client.query<{ id: string; dm_user_a: string; dm_user_b: string }>(
        "select id, dm_user_a, dm_user_b from public.groups " +
          "where kind = 'dm' " +
          "and (dm_user_a = $1 or dm_user_b = $1) " +
          "and (dm_user_a = $2 or dm_user_b = $2)",
        [alice.id, bruno.id],
      );
      const members = await client.query<{ user_id: string; status: string }>(
        "select user_id, status from public.group_members where group_id = $1",
        [groupId],
      );
      return {
        groups: groups.rows,
        members: members.rows,
      };
    });

    expect(state.groups).toHaveLength(1);
    expect(state.groups[0].id).toBe(groupId);
    expect([state.groups[0].dm_user_a, state.groups[0].dm_user_b].sort()).toEqual(
      [alice.id, bruno.id].sort(),
    );
    expect(state.members).toHaveLength(2);
    const accepted = state.members.filter((row) => row.status === "accepted");
    const invited = state.members.filter((row) => row.status === "invited");
    expect(accepted).toHaveLength(1);
    expect(invited).toHaveLength(1);
    // The RPC inserts its caller accepted and its target invited, so the
    // winner's caller joins immediately and the other side still has to
    // accept explicitly.
    const winnerActor = acks[0].created ? alice.id : bruno.id;
    expect(accepted[0].user_id).toBe(winnerActor);
    expect(invited[0].user_id).toBe(winnerActor === alice.id ? bruno.id : alice.id);
  });
});
