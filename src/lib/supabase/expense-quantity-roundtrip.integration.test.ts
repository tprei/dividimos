import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createTestGroup,
  createTestUser,
  type TestUser,
} from "@/test/integration-helpers";
import {
  computeExpenseLineTotalCents,
  parseExpenseQuantity,
} from "@/lib/expense-quantity";
import { parseExpenseCents } from "@/lib/expense-money";

/**
 * #578 app-layer quantity cutover: the client persists `expense_items.quantity`
 * as integer MILLIUNITS, so "0,5 of an item" is stored as 500. This test drives
 * the real `save_expense_draft` RPC with an item whose app-computed line total
 * is 0,5 x R$1,01 = R$0,51 (exact bigint half-up), reloads the row, and asserts
 * the persisted quantity is 500 milliunits and the line total is 51 centavos.
 * It also re-checks the DB's own `compute_expense_line_total_cents(500, 101)`
 * so client and server arithmetic agree (round-trip parity).
 */
const databaseUrl = process.env.SUPABASE_DB_URL;
const canRun = isIntegrationTestReady && typeof databaseUrl === "string";

describe.skipIf(!canRun)("expense quantity milliunits round-trip (#578)", () => {
  let pg: Client;
  let creator: TestUser;
  let groupId: string;

  beforeAll(async () => {
    pg = new Client(databaseUrl!);
    await pg.connect();
    creator = await createTestUser();
    const group = await createTestGroup(creator.id);
    groupId = group.id;
  });

  afterAll(async () => {
    if (pg) await pg.end();
  });

  it("persists 0,5 x R$1,01 as 500 milliunits and a 51-centavo line total", async () => {
    // App-side exact computation: 500 milliunits x 101 centavos = 51 (half-up).
    const quantity = parseExpenseQuantity("0,5");
    const unit = parseExpenseCents(101, "allow");
    expect(quantity.ok).toBe(true);
    expect(unit.ok).toBe(true);
    if (!quantity.ok || !unit.ok) return;
    const lineTotal = computeExpenseLineTotalCents(quantity.value, unit.value);
    expect(lineTotal).toEqual({ ok: true, value: 51 });

    // Drive the real draft-save RPC as the creator; the client sends milliunits.
    const client = authenticateAs(creator);
    const { data, error } = await client.rpc("save_expense_draft", {
      p_expense: {
        group_id: groupId,
        title: "Quantity round-trip",
        merchant_name: "",
        expense_type: "itemized",
        total_amount: 51,
        service_fee_percent: 0,
        fixed_fees: 0,
      },
      p_items: [
        {
          description: "Meia porcao",
          quantity: 500,
          unit_price_cents: 101,
          total_price_cents: 51,
        },
      ],
      p_shares: [],
      p_payers: [],
      p_guests: [],
      p_guest_shares: [],
    });
    expect(error).toBeNull();
    const expenseId = (data as { id: string } | null)?.id;
    expect(expenseId).toBeTruthy();

    // Reload the persisted item row directly from the database.
    const { rows } = await pg.query(
      "SELECT quantity, unit_price_cents, total_price_cents FROM public.expense_items WHERE expense_id = $1",
      [expenseId],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].quantity)).toBe(500);
    expect(Number(rows[0].unit_price_cents)).toBe(101);
    expect(Number(rows[0].total_price_cents)).toBe(51);

    // Parity: the DB's own half-up line-total function agrees with the stored total.
    const parity = await pg.query(
      "SELECT compute_expense_line_total_cents($1, $2) AS total",
      [500, 101],
    );
    expect(Number(parity.rows[0].total)).toBe(51);
  });
});
