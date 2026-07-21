import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { isIntegrationTestReady } from "@/test/integration-setup";
import { computeServiceFeeCents, parseExpenseCents } from "@/lib/expense-money";

const databaseUrl = process.env.SUPABASE_DB_URL;
const canRun = isIntegrationTestReady && typeof databaseUrl === "string";

describe.skipIf(!canRun)("calculate_service_fee_cents + expense_money_max_cents (#477)", () => {
  let pg: Client;

  beforeAll(async () => {
    pg = new Client(databaseUrl!);
    await pg.connect();
  });
  afterAll(async () => {
    if (pg) await pg.end();
  });

  const cases: Array<[number, number, number]> = [
    // subtotal cents, basis points, expected fee cents — half-up.
    [1, 5000, 1], // 1 cent @ 50% -> floor((1*5000+5000)/10000)=1
    [1, 1, 0], // 1 cent @ 0.01% -> floor((1+5000)/10000)=0
    [12345, 1000, 1235], // R$123,45 @ 10% -> 1235
    [10000, 0, 0], // zero rate
    [0, 1000, 0], // zero subtotal
    [99, 1055, 10], // 99 @ 10.55% -> floor((99*1055+5000)/10000)=floor(109445/10000)=10
  ];

  for (const [subtotal, bps, expected] of cases) {
    it(`SQL fee == TS fee for ${subtotal}c @ ${bps}bps = ${expected}c`, async () => {
      const parsed = parseExpenseCents(subtotal, "allow");
      if (!parsed.ok) throw new Error(`fixture: invalid subtotal ${subtotal}`);
      const ts = computeServiceFeeCents(parsed.value, bps);
      expect(ts).toEqual({ ok: true, value: expected });
      const { rows } = await pg.query(
        "select calculate_service_fee_cents($1, $2) as fee",
        [subtotal, bps],
      );
      expect(Number(rows[0].fee)).toBe(expected);
    });
  }

  it("expense_money_max_cents() returns the product cap", async () => {
    const { rows } = await pg.query("select expense_money_max_cents() as cap");
    expect(Number(rows[0].cap)).toBe(99_999_999);
  });
});
