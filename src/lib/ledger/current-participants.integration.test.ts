import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  createTestUsers,
  createGroupWithMembers,
  createExpense,
  equalSplitPayload,
  authenticateAs,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";
import { isIntegrationTestReady } from "@/test/integration-setup";
import { assertLedgerInvariantsAfterEach } from "@/test/ledger-invariants";

assertLedgerInvariantsAfterEach();

interface ParticipantRow {
  participant_index: number;
  kind: string;
  user_id: string | null;
  guest_id: string | null;
  share_cents: number;
  paid_cents: number;
}

interface QueryPlanRow {
  "QUERY PLAN": string;
}

interface TokenAck {
  token: string;
}

async function callRpc<T>(
  client: SupabaseClient<Database>,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(fn as never, args as never);
  if (error) {
    throw new Error(error.message);
  }
  return data as T;
}

async function fetchTableRows(expenseId: string): Promise<ParticipantRow[]> {
  return withPg(async (pg) => {
    const res = await pg.query<ParticipantRow>(
      `SELECT participant_index, kind, user_id, guest_id, share_cents, paid_cents
       FROM public.expense_participants
       WHERE expense_id = $1
       ORDER BY participant_index`,
      [expenseId],
    );
    return res.rows;
  });
}

async function fetchViewRows(expenseId: string): Promise<ParticipantRow[]> {
  return withPg(async (pg) => {
    const res = await pg.query<ParticipantRow>(
      `SELECT participant_index, kind, user_id, guest_id, share_cents, paid_cents
       FROM public.current_expense_participants
       WHERE expense_id = $1
       ORDER BY participant_index`,
      [expenseId],
    );
    return res.rows;
  });
}

async function assertViewMatchesTable(expenseId: string): Promise<void> {
  const tableRows = await fetchTableRows(expenseId);
  const viewRows = await fetchViewRows(expenseId);
  expect(viewRows).toEqual(tableRows);
}

describe.skipIf(!isIntegrationTestReady)("current_expense_participants", () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let outsider: TestUser;
  let groupId: string;

  beforeAll(async () => {
    [alice, bob, carol, outsider] = await createTestUsers(4);
    groupId = await createGroupWithMembers(alice, [bob, carol], "Parity Group");
  });

  it("matches materialized table for single-payer user expense", async () => {
    const created = await createExpense(alice, {
      groupId,
      title: "Aluguel",
      totalCents: 9000,
      payload: equalSplitPayload([alice.id, bob.id, carol.id], 9000),
    });

    const viewRows = await fetchViewRows(created.expenseId);
    expect(viewRows).toHaveLength(3);
    await assertViewMatchesTable(created.expenseId);
  });

  it("matches materialized table for multi-payer expense", async () => {
    const created = await createExpense(alice, {
      groupId,
      title: "Mercado",
      totalCents: 10000,
      payload: {
        items: [],
        participants: [
          { kind: "user", userId: alice.id },
          { kind: "user", userId: bob.id },
          { kind: "user", userId: carol.id },
        ],
        shares: [3000, 3000, 4000],
        payers: [
          { participantIndex: 0, amountCents: 6000 },
          { participantIndex: 1, amountCents: 4000 },
        ],
        itemAssignments: null,
      },
    });

    const viewRows = await fetchViewRows(created.expenseId);
    expect(viewRows).toHaveLength(3);
    expect(viewRows[0].paid_cents).toBe(6000);
    expect(viewRows[1].paid_cents).toBe(4000);
    expect(viewRows[2].paid_cents).toBe(0);
    await assertViewMatchesTable(created.expenseId);
  });

  it("matches materialized table for unclaimed guest expense", async () => {
    const created = await createExpense(alice, {
      groupId,
      title: "Padaria",
      totalCents: 6000,
      payload: {
        items: [],
        participants: [
          { kind: "user", userId: alice.id },
          { kind: "user", userId: bob.id },
          { kind: "guest", guestId: null, displayName: "Convidado 1" },
        ],
        shares: [2000, 2000, 2000],
        payers: [{ participantIndex: 0, amountCents: 6000 }],
        itemAssignments: null,
      },
    });

    const viewRows = await fetchViewRows(created.expenseId);
    expect(viewRows).toHaveLength(3);
    const guestRow = viewRows[2];
    expect(guestRow.kind).toBe("guest");
    expect(guestRow.guest_id).toBeTruthy();
    expect(guestRow.user_id).toBeNull();
    await assertViewMatchesTable(created.expenseId);
  });

  it("matches materialized table across guest claim and subsequent edits", async () => {
    const created = await createExpense(alice, {
      groupId,
      title: "Churrasco",
      totalCents: 6000,
      payload: {
        items: [],
        participants: [
          { kind: "user", userId: alice.id },
          { kind: "user", userId: bob.id },
          { kind: "guest", guestId: null, displayName: "Visitante" },
        ],
        shares: [2000, 2000, 2000],
        payers: [{ participantIndex: 0, amountCents: 6000 }],
        itemAssignments: null,
      },
    });

    const guestId = await withPg(async (pg) => {
      const res = await pg.query<{ id: string }>(
        "SELECT id FROM public.guests WHERE expense_id = $1",
        [created.expenseId],
      );
      return res.rows[0]?.id;
    });

    if (!guestId) {
      throw new Error("Guest ID not found in database for created expense");
    }

    await assertViewMatchesTable(created.expenseId);

    const aliceClient = authenticateAs(alice);
    const tokenAck = await callRpc<TokenAck>(aliceClient, "create_guest_claim_token", {
      p_guest_id: guestId,
    });
    const token = tokenAck.token;

    const outsiderClient = authenticateAs(outsider);
    await callRpc(outsiderClient, "claim_guest", {
      p_token: token,
    });

    const afterClaimRows = await fetchViewRows(created.expenseId);
    expect(afterClaimRows[2].kind).toBe("user");
    expect(afterClaimRows[2].user_id).toBe(outsider.id);
    expect(afterClaimRows[2].guest_id).toBeNull();
    await assertViewMatchesTable(created.expenseId);

    await callRpc(aliceClient, "edit_expense", {
      p_expense_id: created.expenseId,
      p_expected_version_no: 1,
      p_occurred_on: new Date().toISOString().slice(0, 10),
      p_title: "Churrasco Atualizado",
      p_merchant_name: null,
      p_expense_type: "single_amount",
      p_total_cents: 9000,
      p_service_fee_bps: 0,
      p_fixed_fee_cents: 0,
      p_payload: {
        items: [],
        participants: [
          { kind: "user", userId: alice.id },
          { kind: "user", userId: bob.id },
          { kind: "user", userId: outsider.id },
        ],
        shares: [3000, 3000, 3000],
        payers: [{ participantIndex: 0, amountCents: 9000 }],
        itemAssignments: null,
      },
    });

    await assertViewMatchesTable(created.expenseId);

    await callRpc(aliceClient, "edit_expense", {
      p_expense_id: created.expenseId,
      p_expected_version_no: 2,
      p_occurred_on: new Date().toISOString().slice(0, 10),
      p_title: "Churrasco Sem Visitante",
      p_merchant_name: null,
      p_expense_type: "single_amount",
      p_total_cents: 6000,
      p_service_fee_bps: 0,
      p_fixed_fee_cents: 0,
      p_payload: {
        items: [],
        participants: [
          { kind: "user", userId: alice.id },
          { kind: "user", userId: bob.id },
        ],
        shares: [3000, 3000],
        payers: [{ participantIndex: 0, amountCents: 6000 }],
        itemAssignments: null,
      },
    });

    const removedClaimantRows = await fetchViewRows(created.expenseId);
    expect(removedClaimantRows).toHaveLength(2);
    expect(removedClaimantRows.some((r) => r.user_id === outsider.id)).toBe(false);
    await assertViewMatchesTable(created.expenseId);
  });

  it("produces zero rows for deleted expenses in both view and table", async () => {
    const created = await createExpense(alice, {
      groupId,
      title: "Para deletar",
      totalCents: 3000,
      payload: equalSplitPayload([alice.id, bob.id], 3000),
    });

    await assertViewMatchesTable(created.expenseId);

    const aliceClient = authenticateAs(alice);
    await callRpc(aliceClient, "delete_expense", {
      p_expense_id: created.expenseId,
    });

    const viewRows = await fetchViewRows(created.expenseId);
    const tableRows = await fetchTableRows(created.expenseId);
    expect(viewRows).toEqual([]);
    expect(tableRows).toEqual([]);
  });

  it("pushes group and expense predicates into indexed scans without full payload expansion", async () => {
    await withPg(async (pg) => {
      await pg.query("SET enable_seqscan = off");
      const result = await pg.query<QueryPlanRow>(
        `EXPLAIN (COSTS OFF)
         SELECT *
         FROM public.current_expense_participants cep
         JOIN public.expenses e ON e.id = cep.expense_id
         WHERE e.group_id = $1`,
        [groupId],
      );
      const planText = result.rows.map((r) => r["QUERY PLAN"]).join("\n");

      expect(planText).not.toMatch(/Seq Scan on expense_versions/);
      expect(planText).toMatch(/Index Scan.*expenses/);
      expect(planText).toMatch(/Index Scan.*expense_versions/);
    });
  });
});
