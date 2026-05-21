import { describe, it, expect } from "vitest";
import { validateRealtimeRow } from "./realtime-payload";

describe("validateRealtimeRow", () => {
  it("returns null for null / undefined / non-object payloads", () => {
    expect(validateRealtimeRow(null, ["id"])).toBeNull();
    expect(validateRealtimeRow(undefined, ["id"])).toBeNull();
    expect(validateRealtimeRow("a string", ["id"])).toBeNull();
    expect(validateRealtimeRow(42, ["id"])).toBeNull();
  });

  it("returns null when a required string key is missing or wrong type", () => {
    expect(validateRealtimeRow({ id: 123 }, ["id"])).toBeNull();
    expect(validateRealtimeRow({ other: "x" }, ["id"])).toBeNull();
    expect(validateRealtimeRow({ id: null }, ["id"])).toBeNull();
  });

  it("returns null when a required number key is missing or wrong type", () => {
    expect(validateRealtimeRow({ id: "x", amount_cents: "100" }, ["id"], ["amount_cents"])).toBeNull();
    expect(validateRealtimeRow({ id: "x" }, ["id"], ["amount_cents"])).toBeNull();
  });

  it("returns the row when all required keys are present and correctly typed", () => {
    const row = { id: "x", group_id: "g", amount_cents: 100, extra: true };
    expect(validateRealtimeRow(row, ["id", "group_id"], ["amount_cents"])).toBe(row);
  });

  it("treats amount_cents of 0 as valid (not falsy-rejected)", () => {
    const row = { id: "x", amount_cents: 0 };
    expect(validateRealtimeRow(row, ["id"], ["amount_cents"])).toBe(row);
  });
});
