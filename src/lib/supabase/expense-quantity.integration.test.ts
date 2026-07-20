import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  computeExpenseLineTotalCents,
  parseExpenseQuantity,
} from "@/lib/expense-quantity";
import { parseExpenseCents } from "@/lib/expense-money";

const databaseUrl = process.env.SUPABASE_DB_URL;
const canRun = isIntegrationTestReady && typeof databaseUrl === "string";

describe.skipIf(!canRun)("compute_expense_line_total_cents (SQL)", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client(databaseUrl!);
    await client.connect();
  });

  afterAll(async () => {
    if (client) await client.end();
  });

  // Each case: [quantity text, unit price cents, expected total cents].
  const cases: Array<[string, number, number]> = [
    ["0,5", 101, 51], // #578 canonical: 0,5 x R$ 1,01 = 0,505 -> 51
    ["0,001", 100, 0], // 0,001 x R$ 1,00 -> rounds to 0
    ["2", 333, 666], // 2 x R$ 3,33 = 666
    ["1,333", 100, 133], // 1,333 x R$ 1,00 -> 133
    ["3", 250, 750], // 3 x R$ 2,50 = 750
    ["1,5", 99, 149], // 1,5 x R$ 0,99 = 1,485 -> 149
  ];

  for (const [quantityText, unitCents, expected] of cases) {
    it(`matches the half-up rule for ${quantityText} x ${unitCents}c = ${expected}c`, async () => {
      const quantity = parseExpenseQuantity(quantityText);
      expect(quantity.ok).toBe(true);
      const unit = parseExpenseCents(unitCents, "allow");
      expect(unit.ok).toBe(true);
      if (!quantity.ok || !unit.ok) return;

      const tsResult = computeExpenseLineTotalCents(quantity.value, unit.value);
      expect(tsResult).toEqual({ ok: true, value: expected });

      const { rows } = await client.query(
        "select compute_expense_line_total_cents($1, $2) as total",
        [quantity.value as number, unitCents],
      );
      expect(Number(rows[0].total)).toBe(expected);
    });
  }

  it("SQL and TS agree on a range of in-bounds inputs", async () => {
    for (const [qText, unitCents] of [
      ["1", 1],
      ["9", 12345],
      ["0,25", 400],
      ["12,5", 79],
    ] as Array<[string, number]>) {
      const quantity = parseExpenseQuantity(qText);
      const unit = parseExpenseCents(unitCents, "allow");
      if (!quantity.ok || !unit.ok) continue;
      const tsResult = computeExpenseLineTotalCents(quantity.value, unit.value);
      const { rows } = await client.query(
        "select compute_expense_line_total_cents($1, $2) as total",
        [quantity.value as number, unitCents],
      );
      expect(tsResult.ok && (tsResult.value as number)).toBe(Number(rows[0].total));
    }
  });
});
