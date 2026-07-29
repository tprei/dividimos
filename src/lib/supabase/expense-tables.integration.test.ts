import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import {
  createTestUsers,
  createTestGroupWithMembers,
  authenticateAs,
  createAndActivateExpense,
  deleteTestExpenses,
  type TestUser,
} from "@/test/integration-helpers";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";

const databaseUrl = process.env.SUPABASE_DB_URL;

/**
 * Issue #477: creates a genuinely-new draft expense through the real
 * save_expense_draft_graph RPC (the only path allowed to INSERT a new
 * `expenses` row -- the guard's `expenses` INSERT branch requires a
 * 'new'-sourced token, which only that RPC can open). Returns the id and
 * starting graph_revision so callers can open their own 'direct' token
 * afterward for raw child-table / UPDATE / DELETE work against this row.
 */
async function createDraftExpense(
  creator: TestUser,
  fields: { group_id: string; title: string; total_amount: number; expense_type?: "single_amount" | "itemized" },
): Promise<{ id: string; graph_revision: number; updated_at: string }> {
  const client = authenticateAs(creator);
  const { data, error } = await client.rpc("save_expense_draft_graph", {
    p_expense: {
      group_id: fields.group_id,
      title: fields.title,
      merchant_name: null,
      expense_type: fields.expense_type ?? "single_amount",
      total_amount: fields.total_amount,
      service_fee_basis_points: 0,
      fixed_fees: 0,
    },
    p_items: [],
    p_shares: [],
    p_payers: [],
    p_guests: [],
    p_guest_shares: [],
    p_participant_order: [],
    p_expected_graph_revision: 0,
    p_save_operation_id: crypto.randomUUID(),
  });

  if (error || !data) {
    throw new Error(`Failed to create draft expense: ${error?.message}`);
  }
  const result = data as { id: string; graph_revision: number };
  const { data: row } = await adminClient!
    .from("expenses")
    .select("updated_at")
    .eq("id", result.id)
    .single();
  return { id: result.id, graph_revision: result.graph_revision, updated_at: row!.updated_at };
}

/** Opens a 'direct' mutation token for `expenseId` and runs `fn` inside that transaction. */
async function withDirectToken<T>(pg: Client, expenseId: string, fn: () => Promise<T>): Promise<T> {
  await pg.query("BEGIN");
  try {
    await pg.query("select public.begin_expense_graph_direct_mutation($1::uuid[])", [[expenseId]]);
    const result = await fn();
    await pg.query("COMMIT");
    return result;
  } catch (e) {
    await pg.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

describe.skipIf(!isIntegrationTestReady)("expense tables schema", () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let groupId: string;
  let pg: Client;

  beforeAll(async () => {
    if (!databaseUrl) return;
    pg = new Client(databaseUrl);
    await pg.connect();
  });

  afterAll(async () => {
    if (pg) await pg.end();
  });

  beforeEach(async () => {
    [alice, bob, carol] = await createTestUsers(3);
    const group = await createTestGroupWithMembers(alice, [bob, carol]);
    groupId = group.id;
  });

  describe("expenses", () => {
    it("rejects a direct authenticated INSERT into expenses (issue #477 guard: only the RPCs may write)", async () => {
      // #477's expense-graph mutation-token guard rejects every direct
      // write to this table regardless of RLS -- an ordinary
      // authenticated client has no path to open the required token. A
      // separate, pre-existing, unrelated local-environment gap (the
      // `authenticated` role's base table grants) independently blocks
      // the same write even earlier; either way the write must fail, so
      // this only asserts rejection, not which layer produced it.
      // This inverts the pre-#477 assertion on purpose: the capability
      // this test used to prove ("creator can insert directly via RLS")
      // is now intentionally, permanently removed.
      const client = authenticateAs(alice);
      const { data, error } = await client
        .from("expenses")
        .insert({
          group_id: groupId,
          creator_id: alice.id,
          title: "Dinner",
          expense_type: "single_amount",
          total_amount: 10000,
        })
        .select()
        .single();

      expect(data).toBeNull();
      expect(error).not.toBeNull();
    });

    it("rejects negative total_amount", async () => {
      const client = authenticateAs(alice);
      const { data, error } = await client.rpc("save_expense_draft_graph", {
        p_expense: {
          group_id: groupId,
          title: "Bad expense",
          merchant_name: null,
          expense_type: "single_amount",
          total_amount: -100,
          service_fee_basis_points: 0,
          fixed_fees: 0,
        },
        p_items: [],
        p_shares: [],
        p_payers: [],
        p_guests: [],
        p_guest_shares: [],
        p_participant_order: [],
        p_expected_graph_revision: 0,
        p_save_operation_id: crypto.randomUUID(),
      });

      expect(data).toBeNull();
      expect(error).not.toBeNull();
    });

    it("auto-updates updated_at on change", async () => {
      const expense = await createDraftExpense(alice, {
        group_id: groupId,
        title: "Original",
        total_amount: 1000,
      });
      const originalUpdatedAt = expense.updated_at;

      // Small delay to ensure timestamp differs
      await new Promise((r) => setTimeout(r, 50));

      await withDirectToken(pg, expense.id, () =>
        pg.query("update public.expenses set title = 'Updated' where id = $1", [expense.id]),
      );

      const { rows: updated } = await pg.query<{ updated_at: string }>(
        "select updated_at from public.expenses where id = $1",
        [expense.id],
      );

      expect(updated[0].updated_at).not.toBe(originalUpdatedAt);
      await deleteTestExpenses(pg, [expense.id]);
    });
  });

  describe("expense_items", () => {
    it("can insert items linked to an expense", async () => {
      const expense = await createDraftExpense(alice, {
        group_id: groupId,
        title: "Grocery",
        expense_type: "itemized",
        total_amount: 3000,
      });

      const rows = await withDirectToken(pg, expense.id, async () => {
        const { rows } = await pg.query<{ description: string; total_price_cents: number }>(
          `insert into public.expense_items (expense_id, description, quantity, unit_price_cents, total_price_cents)
           values ($1, 'Rice', 2000, 500, 1000) returning description, total_price_cents`,
          [expense.id],
        );
        return rows;
      });

      expect(rows[0].description).toBe("Rice");
      expect(rows[0].total_price_cents).toBe(1000);
      await deleteTestExpenses(pg, [expense.id]);
    });

    it("cascades delete when expense is deleted", async () => {
      const expense = await createDraftExpense(alice, {
        group_id: groupId,
        title: "To delete",
        total_amount: 1000,
      });

      await withDirectToken(pg, expense.id, () =>
        pg.query(
          `insert into public.expense_items (expense_id, description, unit_price_cents, total_price_cents)
           values ($1, 'Item', 500, 500)`,
          [expense.id],
        ),
      );

      await deleteTestExpenses(pg, [expense.id]);

      const { data } = await adminClient!
        .from("expense_items")
        .select("*")
        .eq("expense_id", expense.id);

      expect(data).toHaveLength(0);
    });
  });

  describe("expense_shares", () => {
    it("can insert shares for users", async () => {
      const expense = await createDraftExpense(alice, {
        group_id: groupId,
        title: "Split dinner",
        total_amount: 9000,
      });

      await withDirectToken(pg, expense.id, () =>
        pg.query(
          `insert into public.expense_shares (expense_id, user_id, share_amount_cents) values
           ($1, $2, 3000), ($1, $3, 3000), ($1, $4, 3000)`,
          [expense.id, alice.id, bob.id, carol.id],
        ),
      );

      const { data: shares, error } = await adminClient!
        .from("expense_shares")
        .select("id")
        .eq("expense_id", expense.id);
      expect(error).toBeNull();
      expect(shares).toHaveLength(3);
      await deleteTestExpenses(pg, [expense.id]);
    });

    it("enforces unique (expense_id, user_id)", async () => {
      const expense = await createDraftExpense(alice, {
        group_id: groupId,
        title: "Dupe test",
        total_amount: 1000,
      });

      await pg.query("BEGIN");
      await pg.query("select public.begin_expense_graph_direct_mutation($1::uuid[])", [[expense.id]]);
      await pg.query(
        "insert into public.expense_shares (expense_id, user_id, share_amount_cents) values ($1, $2, 500)",
        [expense.id, alice.id],
      );

      await expect(
        pg.query(
          "insert into public.expense_shares (expense_id, user_id, share_amount_cents) values ($1, $2, 500)",
          [expense.id, alice.id],
        ),
      ).rejects.toThrow();
      await pg.query("ROLLBACK").catch(() => {});
      await deleteTestExpenses(pg, [expense.id]);
    });
  });

  describe("expense_payers", () => {
    it("can insert payers with amounts", async () => {
      const expense = await createDraftExpense(alice, {
        group_id: groupId,
        title: "Paid dinner",
        total_amount: 10000,
      });

      await withDirectToken(pg, expense.id, async () => {
        await pg.query(
          `insert into public.expense_shares (expense_id, user_id, share_amount_cents) values ($1, $2, 5000), ($1, $3, 5000)`,
          [expense.id, alice.id, bob.id],
        );
        await pg.query(
          `insert into public.expense_payers (expense_id, user_id, amount_cents) values ($1, $2, 7000), ($1, $3, 3000)`,
          [expense.id, alice.id, bob.id],
        );
      });

      const { data: payers, error } = await adminClient!
        .from("expense_payers")
        .select("user_id")
        .eq("expense_id", expense.id);
      expect(error).toBeNull();
      expect(payers).toHaveLength(2);
      await deleteTestExpenses(pg, [expense.id]);
    });

    it("rejects zero or negative amount_cents", async () => {
      const expense = await createDraftExpense(alice, {
        group_id: groupId,
        title: "Bad payer",
        total_amount: 1000,
      });

      await pg.query("BEGIN");
      await pg.query("select public.begin_expense_graph_direct_mutation($1::uuid[])", [[expense.id]]);
      await expect(
        pg.query(
          "insert into public.expense_payers (expense_id, user_id, amount_cents) values ($1, $2, 0)",
          [expense.id, alice.id],
        ),
      ).rejects.toThrow();
      await pg.query("ROLLBACK").catch(() => {});
      await deleteTestExpenses(pg, [expense.id]);
    });
  });

  describe("balances", () => {
    it("can insert a balance with canonical user ordering", async () => {
      const [userA, userB] =
        alice.id < bob.id ? [alice.id, bob.id] : [bob.id, alice.id];

      const { data, error } = await adminClient!
        .from("balances")
        .insert({
          group_id: groupId,
          user_a: userA,
          user_b: userB,
          amount_cents: 5000,
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data!.amount_cents).toBe(5000);
    });

    it("rejects non-canonical user ordering (user_a >= user_b)", async () => {
      const [userA, userB] =
        alice.id < bob.id ? [bob.id, alice.id] : [alice.id, bob.id];

      const { error } = await adminClient!.from("balances").insert({
        group_id: groupId,
        user_a: userA,
        user_b: userB,
        amount_cents: 1000,
      });

      expect(error).not.toBeNull();
    });

    it("allows negative amount_cents (reverse debt direction)", async () => {
      const [userA, userB] =
        alice.id < bob.id ? [alice.id, bob.id] : [bob.id, alice.id];

      const { data, error } = await adminClient!
        .from("balances")
        .insert({
          group_id: groupId,
          user_a: userA,
          user_b: userB,
          amount_cents: -3000,
        })
        .select()
        .single();

      expect(error).toBeNull();
      expect(data!.amount_cents).toBe(-3000);
    });

    it("group member can read balances", async () => {
      const [userA, userB] =
        alice.id < bob.id ? [alice.id, bob.id] : [bob.id, alice.id];

      await adminClient!.from("balances").insert({
        group_id: groupId,
        user_a: userA,
        user_b: userB,
        amount_cents: 2000,
      });

      const bobClient = authenticateAs(bob);
      const { data } = await bobClient
        .from("balances")
        .select("*")
        .eq("group_id", groupId);

      expect(data!.length).toBeGreaterThanOrEqual(1);
    });

    it("non-member cannot read balances", async () => {
      const [outsider] = await createTestUsers(1);
      const [userA, userB] =
        alice.id < bob.id ? [alice.id, bob.id] : [bob.id, alice.id];

      await adminClient!.from("balances").insert({
        group_id: groupId,
        user_a: userA,
        user_b: userB,
        amount_cents: 2000,
      });

      const outsiderClient = authenticateAs(outsider);
      const { data } = await outsiderClient
        .from("balances")
        .select("*")
        .eq("group_id", groupId);

      expect(data).toHaveLength(0);
    });
  });

  describe("expense child-table draft guards (Chain C)", () => {
    it("rejects UPDATE on expense_shares of an active expense", async () => {
      const [alice2, bob2] = await createTestUsers(2);
      const group2 = await createTestGroupWithMembers(alice2, [bob2]);

      const expenseId = await createAndActivateExpense({
        creator: alice2,
        groupId: group2.id,
        shares: [
          { userId: alice2.id, amount: 5000 },
          { userId: bob2.id, amount: 5000 },
        ],
        payers: [{ userId: alice2.id, amount: 10000 }],
      });

      const aliceClient = authenticateAs(alice2);
      const { error } = await aliceClient
        .from("expense_shares")
        .update({ share_amount_cents: 1 })
        .eq("expense_id", expenseId)
        .select();

      expect(error).toBeTruthy();
    });

    it("rejects DELETE on expense_shares of an active expense", async () => {
      const [alice3, bob3] = await createTestUsers(2);
      const group3 = await createTestGroupWithMembers(alice3, [bob3]);

      const expenseId = await createAndActivateExpense({
        creator: alice3,
        groupId: group3.id,
        shares: [
          { userId: alice3.id, amount: 5000 },
          { userId: bob3.id, amount: 5000 },
        ],
        payers: [{ userId: alice3.id, amount: 10000 }],
      });

      const aliceClient = authenticateAs(alice3);
      const { error } = await aliceClient
        .from("expense_shares")
        .delete()
        .eq("expense_id", expenseId)
        .select();

      expect(error).toBeTruthy();
    });

    it("rejects UPDATE on expense_payers of an active expense", async () => {
      const [alice4, bob4] = await createTestUsers(2);
      const group4 = await createTestGroupWithMembers(alice4, [bob4]);

      const expenseId = await createAndActivateExpense({
        creator: alice4,
        groupId: group4.id,
        shares: [
          { userId: alice4.id, amount: 5000 },
          { userId: bob4.id, amount: 5000 },
        ],
        payers: [{ userId: alice4.id, amount: 10000 }],
      });

      const aliceClient = authenticateAs(alice4);
      const { error } = await aliceClient
        .from("expense_payers")
        .update({ amount_cents: 1 })
        .eq("expense_id", expenseId)
        .select();

      expect(error).toBeTruthy();
    });

    it("rejects INSERT on expense_items of an active expense", async () => {
      const [alice5, bob5] = await createTestUsers(2);
      const group5 = await createTestGroupWithMembers(alice5, [bob5]);

      const expenseId = await createAndActivateExpense({
        creator: alice5,
        groupId: group5.id,
        shares: [
          { userId: alice5.id, amount: 5000 },
          { userId: bob5.id, amount: 5000 },
        ],
        payers: [{ userId: alice5.id, amount: 10000 }],
      });

      const aliceClient = authenticateAs(alice5);
      const { error } = await aliceClient.from("expense_items").insert({
        expense_id: expenseId,
        description: "Forged item",
        unit_price_cents: 100,
        total_price_cents: 100,
      });

      expect(error).toBeTruthy();
    });
  });

  describe("settlements", () => {
    it("denies authenticated settlement inserts", async () => {
      const client = authenticateAs(alice);
      const { error } = await client
        .from("settlements")
        .insert({
          group_id: groupId,
          from_user_id: alice.id,
          to_user_id: bob.id,
          amount_cents: 5000,
        })
        .select()
        .single();

      expect(error).not.toBeNull();
    });

    it("cannot insert settlement as someone else", async () => {
      const bobClient = authenticateAs(bob);
      const { error } = await bobClient.from("settlements").insert({
        group_id: groupId,
        from_user_id: alice.id, // Bob trying to create as Alice
        to_user_id: carol.id,
        amount_cents: 1000,
      });

      expect(error).not.toBeNull();
    });

    it("group member can read group settlements", async () => {
      await adminClient!.from("settlements").insert({
        group_id: groupId,
        from_user_id: alice.id,
        to_user_id: bob.id,
        amount_cents: 3000,
      });

      const carolClient = authenticateAs(carol);
      const { data } = await carolClient
        .from("settlements")
        .select("*")
        .eq("group_id", groupId);

      expect(data!.length).toBeGreaterThanOrEqual(1);
    });

    it("rejects zero or negative amount_cents", async () => {
      const { error } = await adminClient!.from("settlements").insert({
        group_id: groupId,
        from_user_id: alice.id,
        to_user_id: bob.id,
        amount_cents: 0,
      });

      expect(error).not.toBeNull();
    });
  });
});
