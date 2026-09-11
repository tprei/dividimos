import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { forceLockContentionRace } from "@/test/db-race-barrier";
import {
  authenticateAs,
  createExpense,
  createGroupWithMembers,
  createTestUsers,
  equalSplitPayload,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";
import { isIntegrationTestReady } from "@/test/integration-setup";
import { assertLedgerInvariantsAfterEach } from "@/test/ledger-invariants";

assertLedgerInvariantsAfterEach();

const LOCK_GROUP_SQL = "select id from public.groups where id = $1 for update";

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
      const rows = await client.query<{ guest_id: string }>(
        "select guest_id from public.expense_participants " +
          "where expense_id = $1 and guest_id is not null",
        [created.expenseId],
      );
      return rows.rows[0].guest_id;
    });
    const token = await rpcOk<string>(aliceClient, "issue_guest_claim_token", {
      p_guest_id: guestId,
    });

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
      const participants = await client.query<{ kind: string; user_id: string | null }>(
        "select kind, user_id from public.expense_participants where expense_id = $1",
        [created.expenseId],
      );
      return {
        claimedBy: guest.rows[0]?.claimed_by ?? null,
        membership: member.rows[0]?.status ?? null,
        participants: participants.rows,
      };
    });

    expect(state.participants).toHaveLength(2);
    expect(state.participants.every((row) => row.kind === "user")).toBe(true);
    if (claim.ok) {
      expect(state.claimedBy).toBe(carla.id);
      expect(state.membership).toBe("accepted");
    } else {
      expect(claim.message).toBe("invalid_token");
      expect(state.claimedBy).toBeNull();
      expect(state.membership).toBeNull();
    }
  });
});
