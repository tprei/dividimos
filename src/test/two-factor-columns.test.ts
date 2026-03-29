import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("20260329210000_add_two_factor_columns migration", () => {
  const migrationPath = join(
    __dirname,
    "../../supabase/migrations/20260329210000_add_two_factor_columns.sql",
  );
  const sql = readFileSync(migrationPath, "utf-8");

  it("adds two_factor_enabled column with NOT NULL DEFAULT false", () => {
    expect(sql).toContain("two_factor_enabled BOOLEAN NOT NULL DEFAULT false");
  });

  it("adds two_factor_phone column (nullable TEXT)", () => {
    expect(sql).toContain("two_factor_phone TEXT");
  });

  it("adds two_factor_code_hash column (nullable TEXT)", () => {
    expect(sql).toContain("two_factor_code_hash TEXT");
  });

  it("adds two_factor_code_created_at column (nullable TIMESTAMPTZ)", () => {
    expect(sql).toContain("two_factor_code_created_at TIMESTAMPTZ");
  });

  it("creates partial index on two_factor_enabled", () => {
    expect(sql).toContain("idx_users_two_factor_enabled");
    expect(sql).toContain("WHERE two_factor_enabled = true");
  });

  it("uses IF NOT EXISTS for idempotent column additions", () => {
    const addColumnStatements = sql.match(/ADD COLUMN IF NOT EXISTS/g);
    expect(addColumnStatements).not.toBeNull();
    expect(addColumnStatements!.length).toBe(4);
  });

  it("targets the users table", () => {
    const alterStatements = sql.match(/ALTER TABLE users/g);
    expect(alterStatements).not.toBeNull();
    expect(alterStatements!.length).toBeGreaterThanOrEqual(4);
  });
});
