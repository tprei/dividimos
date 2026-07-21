import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { adminClient, isIntegrationTestReady } from "@/test/integration-setup";
import { createTestGroup, createTestUser } from "@/test/integration-helpers";

const databaseUrl = process.env.SUPABASE_DB_URL;
const canRun = isIntegrationTestReady && typeof databaseUrl === "string";

describe.skipIf(!canRun)("cents-cap constraints (#477)", () => {
  let pg: Client;
  let expenseId: string;
  let groupId: string;
  let creatorId: string;

  beforeAll(async () => {
    pg = new Client(databaseUrl!);
    await pg.connect();
    const creator = await createTestUser();
    const group = await createTestGroup(creator.id);
    groupId = group.id;
    creatorId = creator.id;
    const ins = await pg.query<{ id: string }>(
      "insert into expenses(group_id, creator_id, title, expense_type, total_amount, status) values ($1, $2, 'cap-fixture', 'itemized', 0, 'draft') returning id",
      [groupId, creatorId],
    );
    expenseId = ins.rows[0].id;
  });

  afterAll(async () => {
    if (expenseId) await pg.query("delete from expenses where id = $1", [expenseId]);
    if (pg) await pg.end();
  });

  it("rejects an over-cap total on a new write (NOT VALID only skips existing rows)", async () => {
    await expect(
      pg.query("update expenses set total_amount = 100000000 where id = $1", [expenseId]),
    ).rejects.toThrow();
  });

  it("rejects an over-cap item unit price and line total", async () => {
    await expect(
      pg.query(
        "insert into expense_items(expense_id, description, quantity, unit_price_cents, total_price_cents) values ($1,'x',1,100000000,100000000)",
        [expenseId],
      ),
    ).rejects.toThrow();
  });

  it("rejects a zero/over-cap payer amount (payers must be strictly positive)", async () => {
    await expect(
      pg.query(
        "insert into expense_payers(expense_id, user_id, amount_cents) values ($1, (select creator_id from expenses where id=$1), 0)",
        [expenseId],
      ),
    ).rejects.toThrow();
    await expect(
      pg.query(
        "insert into expense_payers(expense_id, user_id, amount_cents) values ($1, (select creator_id from expenses where id=$1), 100000000)",
        [expenseId],
      ),
    ).rejects.toThrow();
  });

  it("accepts an in-range item + share + payer", async () => {
    const uid = (await pg.query("select creator_id from expenses where id=$1", [expenseId])).rows[0].creator_id;
    await pg.query(
      "insert into expense_items(expense_id, description, quantity, unit_price_cents, total_price_cents) values ($1,'in-range',1,100,100)",
      [expenseId],
    );
    await pg.query(
      "insert into expense_shares(expense_id, user_id, share_amount_cents) values ($1,$2,100)",
      [expenseId, uid],
    );
    await pg.query(
      "insert into expense_payers(expense_id, user_id, amount_cents) values ($1,$2,100)",
      [expenseId, uid],
    );
    // cleanup the inserted children (cascade handles them on expense delete)
  });

  it("allows an in-range service-role write and rejects an over-cap write", async () => {
    const { data: validExpense, error: validError } = await adminClient!
      .from("expenses")
      .insert({
        group_id: groupId,
        creator_id: creatorId,
        title: "service-role cap write",
        expense_type: "single_amount",
        total_amount: 100,
        service_fee_percent: 0,
        fixed_fees: 0,
        status: "draft",
      })
      .select("id")
      .single();

    expect(validError).toBeNull();
    if (!validExpense) {
      throw new Error("Service-role in-range expense insert returned no row");
    }

    try {
      const { error: overCapError } = await adminClient!.from("expenses").insert({
        group_id: groupId,
        creator_id: creatorId,
        title: "service-role over-cap write",
        expense_type: "single_amount",
        total_amount: 100000000,
        service_fee_percent: 0,
        fixed_fees: 0,
        status: "draft",
      });

      expect(overCapError).not.toBeNull();
      if (!overCapError) {
        throw new Error("Service-role over-cap expense insert unexpectedly succeeded");
      }
      expect(overCapError.message).toMatch(/expenses_total_amount_cap_check/);
    } finally {
      const { error: deleteError } = await adminClient!
        .from("expenses")
        .delete()
        .eq("id", validExpense.id);

      expect(deleteError).toBeNull();
    }
  });
});

