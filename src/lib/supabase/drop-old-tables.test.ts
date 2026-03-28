import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("drop old bill tables migration", () => {
  const migrationPath = join(
    __dirname,
    "../../../supabase/migrations/20260328190000_drop_old_bill_tables.sql",
  );
  const sql = readFileSync(migrationPath, "utf-8");

  // Extract just the "section 3" table drops (standalone DROP TABLE lines)
  const tableDropLines = sql
    .split("\n")
    .filter((line) => /^DROP TABLE IF EXISTS/.test(line.trim()));

  const oldTables = [
    "payments",
    "item_splits",
    "bill_splits",
    "bill_payers",
    "bill_participants",
    "bill_items",
    "ledger",
    "group_settlements",
    "bills",
  ];

  const oldEnums = [
    "payment_status",
    "bill_participant_status",
    "split_type",
    "bill_status",
    "debt_status",
    "ledger_entry_type",
  ];

  const oldFunctions = [
    "update_ledger_on_payment",
    "update_group_settlement_on_payment",
    "cascade_group_settlement",
    "update_updated_at",
    "my_bill_ids",
    "sync_group_settlements",
  ];

  it("drops all old tables", () => {
    for (const table of oldTables) {
      expect(sql).toContain(`DROP TABLE IF EXISTS ${table}`);
    }
  });

  it("drops all old enums", () => {
    for (const enumType of oldEnums) {
      expect(sql).toContain(`DROP TYPE IF EXISTS ${enumType}`);
    }
  });

  it("drops all old functions", () => {
    for (const func of oldFunctions) {
      expect(sql).toContain(`DROP FUNCTION IF EXISTS ${func}`);
    }
  });

  it("drops tables before enums to respect dependencies", () => {
    // Use standalone DROP TABLE lines, not inline ones in DO blocks
    const firstTableDropLine = tableDropLines[0];
    expect(firstTableDropLine).toBeDefined();
    const firstTableDrop = sql.indexOf(firstTableDropLine!);
    const firstEnumDrop = sql.indexOf("DROP TYPE IF EXISTS");
    expect(firstTableDrop).toBeLessThan(firstEnumDrop);
  });

  it("drops triggers before standalone table drops", () => {
    const firstTriggerDrop = sql.indexOf("DROP TRIGGER IF EXISTS");
    const firstTableDropLine = tableDropLines[0];
    expect(firstTableDropLine).toBeDefined();
    const firstTableDrop = sql.indexOf(firstTableDropLine!);
    expect(firstTriggerDrop).toBeLessThan(firstTableDrop);
  });

  it("drops payments before ledger (dependency order)", () => {
    const paymentsLine = tableDropLines.findIndex((l) =>
      l.includes("payments"),
    );
    const ledgerLine = tableDropLines.findIndex((l) =>
      l.includes("ledger"),
    );
    expect(paymentsLine).toBeLessThan(ledgerLine);
  });

  it("drops bills last among standalone table drops", () => {
    const billsLine = tableDropLines.findIndex((l) =>
      l.includes(" bills"),
    );
    for (const table of oldTables.filter((t) => t !== "bills")) {
      const tableLineIdx = tableDropLines.findIndex((l) =>
        l.includes(table),
      );
      expect(
        tableLineIdx,
        `${table} should be dropped before bills`,
      ).toBeLessThan(billsLine);
    }
  });

  it("does not drop new expense tables", () => {
    const newTables = [
      "expenses",
      "expense_items",
      "expense_shares",
      "expense_payers",
      "balances",
      "settlements",
    ];
    for (const table of newTables) {
      expect(sql).not.toContain(`DROP TABLE IF EXISTS ${table}`);
    }
  });

  it("does not drop my_group_ids function", () => {
    expect(sql).not.toContain("DROP FUNCTION IF EXISTS my_group_ids");
  });

  it("recreates users_read_visible policy without bill references", () => {
    expect(sql).toContain('DROP POLICY IF EXISTS "users_read_visible"');
    expect(sql).toContain('CREATE POLICY "users_read_visible"');
    const policySection = sql.slice(
      sql.indexOf('CREATE POLICY "users_read_visible"'),
    );
    expect(policySection).toContain("group_members");
    expect(policySection).toContain("my_group_ids()");
    expect(policySection).not.toContain("bill_participants");
    expect(policySection).not.toContain("my_bill_ids");
  });

  it("removes old tables from realtime publication", () => {
    expect(sql).toContain("supabase_realtime DROP TABLE IF EXISTS payments");
    expect(sql).toContain("supabase_realtime DROP TABLE IF EXISTS bills");
  });
});
